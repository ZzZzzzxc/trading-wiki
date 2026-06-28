# Agent 系统深度分析

> 基于源码的全量分析，覆盖 A 股投研助手 Agent 子系统的每一行核心代码。

---

## 一、系统架构总览

### 1.1 层次图

```
┌──────────────────────────────────────────────────────────┐
│                     页面层 (Pages)                        │
│  /agent-debug         /agent-debug/[runId]               │
│  (调试列表)           (单次执行详情)                      │
├──────────────┬───────────────────────────────────────────┤
│   API 路由层  │  app/api/ai/research/route.ts             │
│              │  app/api/agent-debug/runs/route.ts        │
│              │  app/api/agent-debug/runs/[runId]/route.ts│
│              │  app/api/agent-debug/feedback/route.ts    │
├──────────────┼───────────────────────────────────────────┤
│   编排层      │  researchAgent AsyncGenerator (三阶段)    │
│  (Orchestration)│  SimpleGraph DAG 引擎                   │
│              │  GraphNode plan/debate/synthesize          │
├──────────────┼───────────────────────────────────────────┤
│   业务逻辑层   │  ToolRegistry (工具注册/生命周期)         │
│  (Business)  │  LLMProvider 接口 + ProviderRegistry       │
│              │  RunRecorder (调试埋点)                    │
├──────────────┼───────────────────────────────────────────┤
│   基础设施层   │  DeepSeekProvider / KimiProvider          │
│  (Infra)     │  OpenAI-Compatible SDK                     │
│              │  streamText (Vercel AI SDK)                │
├──────────────┼───────────────────────────────────────────┤
│   数据存储层   │  data/agent-traces/runs.jsonl (运行摘要)  │
│  (Storage)   │  data/agent-traces/events/*.jsonl (事件)   │
│              │  data/agent-traces/feedback.jsonl (反馈)   │
└──────────────┴───────────────────────────────────────────┘
```

### 1.2 核心模块依赖关系

```
research-agent.ts (入口 AsyncGenerator)
  ├── SimpleGraph (graph.ts)              ← DAG 编排引擎
  │   ├── planNode (plan-node.ts)         ← 规划阶段
  │   ├── createDebateNode (debate-node.ts) ← 辩论阶段
  │   └── synthesizeNode (synthesize-node.ts) ← 合成阶段
  ├── ToolRegistry (skills/registry.ts)   ← 工具系统
  │   └── search_knowledge_base / read_document / get_facts
  ├── RunRecorder (agent-debug/)          ← 调试埋点
  ├── ProviderRegistry (provider-registry.ts) ← LLM 提供者
  │   ├── DeepSeekProvider                ← 主模型 (chat/structured/stream)
  │   └── KimiProvider                    ← 视觉模型 (vision)
  └── Vercel AI SDK (streamText)          ← 流式研究核心
```

### 1.3 数据流

```
用户请求 (HTTP POST /api/ai/research)
  │
  ├─① 解析 → Zod schema → { question, depth, focus, debate }
  │
  ├─② researchAgent(question, config) → AsyncGenerator<AgentEvent>
  │   │
  │   ├── Phase 1: 规划
  │   │   ├── planNode.execute(ctx)       → LLM 拆解子问题
  │   │   └── yield agent_plan             → 前端展示研究方案
  │   │
  │   ├── Phase 2: 研究 (streamText loop)
  │   │   ├── systemPrompt + tools → Vercel AI SDK
  │   │   ├── LLM ↔ 工具 (search/read/facts) 循环
  │   │   ├── yield agent_tool_call / agent_tool_result
  │   │   └── yield report_chunk (流式文本)
  │   │
  │   └── Phase 3: 辩论合成 (可选)
  │       ├── debateNode.execute(ctx)     → 多轮 Bull ↔ Bear 对抗
  │       ├── synthesizeNode.execute(ctx) → 综合报告
  │       └── yield agent_debate_start / agent_debate_result / report_done
  │
  ├─③ SSE 事件 → ReadableStream → text/event-stream
  │
  └─④ RunRecorder.finish() → 写入 data/agent-traces/
```

---

## 二、Agent 循环详解

`researchAgent` 定义在 `lib/ai/research-agent.ts`，是一个 `AsyncGenerator<AgentEvent>`，分三阶段执行。

### 2.1 阶段 1：规划阶段 (planNode + Graph)

**输入**: `question: string`, `config: ResearchConfig`

**流程**:
```
planNode.execute(ctx)
  ├── 从 ctx 读取 question 和 config
  ├── 通过 providerRegistry.getForTask('structured') 调用 LLM
  ├── prompt: "将研究问题拆解为 2-5 个可搜索的子问题"
  ├── 输出 JSON: { title, subQuestions }
  └── 存入 ctx: subQuestions, planTitle, planPrompt, planResponse
```

**事件发射**: `{ type: 'agent_plan', data: PlanOutput }`

**异常处理**: 正则提取 JSON 失败时抛出 `"plan: LLM 输出格式错误"`；空问题时抛出 `"plan: question 不能为空"`。

**调试记录**: 通过 `recorder.step('拆解研究方案', 'planning', fn, stepId)` 包裹，之后用 `recorder.recordLlmCall()` 记录 prompt/response。

```
关键类型:

interface PlanOutput {
  title: string;         // 研究标题，如 "京东方A 2025年业绩预测分析"
  subQuestions: string[]; // 2-5 个子问题
}

interface ResearchConfig {
  depth: 'quick' | 'standard' | 'deep';
  focus: 'comprehensive' | 'technical' | 'fundamental' | 'news';
  debate: boolean;
}

interface AgentEvent {
  type:
    | 'agent_plan'       // 规划输出
    | 'agent_step'       // 步骤
    | 'agent_tool_call'  // 工具调用开始
    | 'agent_tool_result'// 工具调用结果
    | 'agent_evidence'   // 证据
    | 'agent_debate_start'
    | 'agent_debate_result'
    | 'report_chunk'     // 流式文本块
    | 'report_done'      // 报告完成
    | 'error';
  data: unknown;
}
```

**注意**: 虽然 `SimpleGraph` 引擎支持完整的 DAG 执行（拓扑排序 + 并行），但在 `researchAgent` 中并未直接使用 `graph.execute()`, 而是手动依次调用 `planNode.execute()` → `streamText` → `debateNode.execute()` → `synthesizeNode.execute()`。Graph 在 `researchAgent` 中仅作为节点容器注册，真正的编排逻辑在 `researchAgent` 函数体内硬编码。而 `lib/agents/run.ts` 提供了 `runResearchGraph()` 和 `runDebateAndSynthesis()` 两个辅助函数，其中前者会调用 `graph.execute()` 做完整的图编排。

### 2.2 阶段 2：研究阶段 (streamText + Vercel AI SDK + Tools)

**输入**: 规划结果 + 系统提示词

**流程**:

```
1. 构造 systemPrompt (约 20 行)
   - 包含用户原问题和子问题列表
   - 规定工作方式：search → read → accumulate → report
   - 规定报告格式：六段式（结论/证据链/分歧/验证/交易含义/引用）

2. 初始化 DeepSeek provider (通过 @ai-sdk/openai-compatible)
   const deepseekProvider = createOpenAICompatible({ baseURL, name, apiKey });
   const model = deepseekProvider.languageModel(deepseekConfig.model);

3. 计算 maxSteps
   quick → 3, standard → 6, deep → 10

4. 调用 streamText()
   const result = streamText({
     model,                              // DeepSeek
     messages: [{ role: 'user', content }],
     system: systemPrompt,
     tools: toolRegistry.toAISdkTools({ question }),
     stopWhen: isStepCount(maxSteps),    // 限制最大工具调用轮次
   });

5. 消费 result.fullStream (AsyncIterable)
   for await (const event of result.fullStream) {
     'text-delta'  → fullReport += text, yield report_chunk
     'tool-call'   → recordToolCall(), yield agent_tool_call
     'tool-result' → recordToolCall(), yield agent_tool_result
   }
```

**工具绑定机制**: `toolRegistry.toAISdkTools({ question })` 将 SkillTool 数组转换为 Vercel AI SDK 的 `ToolSet` 格式。转换时会为每个工具注入 `beforeCall` 和 `afterCall` 生命周期钩子。

**停止条件**: `stopWhen: isStepCount(maxSteps)` – 当工具调用轮次达到上限时自动停止，避免无限循环。

**调试勘误**: 研究阶段的 `recorder.startStep(researchStepId, '多步工具研究', 'tool_call')` startStep 在 yield 之前执行，而 `recorder.finishStep()` 在循环之后。中间每个 tool-call 和 tool-result 的 `recordToolCall()` 调用不会写入 `AgentRun.steps[]` 数组，而是写入内部的 events 日志。

**异常处理**: 如果 `streamText` 抛出异常，由外围的 `try/catch` 捕获，yield `{ type: 'error' }` 并调用 `recorder.finish(undefined, error)`。

### 2.3 阶段 3：辩论合成阶段 (debateNode + synthesizeNode)

条件触发：`config.debate === true && fullReport !== ''`

#### 辩论节点 (debate-node.ts)

```
createDebateNode({ rounds }): GraphNode
  id: 'debate'
  deps: ['research']
```

**多轮辩论的对抗机制**:

```
for (r = 0; r < rounds; r++) {
  1. Bull（乐观方）发言
     prompt: 研究报告 + 上一轮 Bear 论点（如果有）
     output: { title, points[], conclusion }

  2. Bear（悲观方）发言
     prompt: 研究报告 + 本轮 Bull 论点
     output: { title, points[], conclusion }

  3. 上下文注入: bullContext / bearContext 在轮次间传递
}

最后：Neutral（中立方）综合
  prompt: 所有轮次的 Bull/Bear 结论
  output: { title, keyVariables[] }
```

**对抗机制**:
- Round 1: Bull 先发言，Bear 针对 Bull 进行反驳
- Round 2+: Bull 参考上一轮 Bear 的反驳进行再反驳，Bear 针对新的 Bull 再反驳
- 形成正反螺旋对抗，每轮的 context 都在累积

**Provider**: 使用 `providerRegistry.getForTask('generation')`，temperature=0.5 (比规划阶段更高，鼓励多样性)

**输出类型**:
```typescript
interface DebateResult {
  rounds: Array<{
    round: number;
    bull: { title: string; points: string[]; conclusion: string };
    bear: { title: string; points: string[]; conclusion: string };
  }>;
  neutral: { title: string; keyVariables: string[] };
}
```

**异常处理**: 如果 `report` 为空，抛出 `"debate: 缺少研究报告"`。JSON 解析失败时使用空对象 `{}` 兜底。

**调试记录**: 通过 `recorder.step('多角色辩论', 'debate', fn)` 包裹。

#### 合成节点 (synthesize-node.ts)

```
synthesizeNode: GraphNode
  id: 'synthesize'
  deps: ['debate']
```

**职责**: 将原始报告 + 辩论记录合并为综合报告。

**prompt**: 包含原始报告 (前 3000 字) + 各轮辩论结论 + 中立关键变量。

**输出格式**: 六段式 Markdown：

```
## 核心结论
## 证据链
## 多视角分析 (乐观/悲观/平衡)
## 关键验证变量
## 交易含义
```

**Provider**: `providerRegistry.getForTask('generation')`, temperature=0.3。

**异常处理**: 缺乏 `report` 时抛出。缺乏 `debate` 时类型为 `DebateResult`，不会抛异常（因为 `ctx.get('debate')` 返回 `undefined` 时访问 `.rounds` 会触底）。

**失败回退**: 在 `researchAgent` 中，如果辩论合成阶段抛出异常，捕获后 `yield { type: 'report_done', data: { report: fullReport } }` — 回退到原始未经辩论的报告。

**最终事件**: `{ type: 'report_done', data: { report: finalReport, debate: debateResult } }`

---

## 三、工具系统原理

### 3.1 ToolRegistry 设计

定义在 `lib/ai/skills/registry.ts`，全局单例 `export const toolRegistry = new ToolRegistry()`。

#### 注册机制

```typescript
class ToolRegistry {
  private tools = new Map<string, SkillTool>();

  register(tool: SkillTool): void {
    // 同名工具覆盖（带警告）
  }

  registerPackage(tools: SkillTool[]): void {
    // 批量注册，遍历调用 register
  }
}
```

#### SkillTool 接口

```typescript
interface SkillTool {
  name: string;             // 工具名称，如 'search_knowledge_base'
  description: string;      // 向 LLM 展示的描述
  inputSchema: z.ZodType;   // 参数模型（Zod）
  skill: string;            // 所属技能包，如 'research'
  execute: (args, ctx) => Promise<unknown>;

  // 生命周期钩子
  isActive?: (ctx: SkillContext) => boolean;      // 条件激活
  beforeCall?: (args, ctx) => Promise<{ block?: boolean; reason?: string } | void>;
  afterCall?: (result, ctx) => Promise<unknown>;
}
```

#### 生命周期钩子

调用链（在 `toAISdkTools` 的封装中）：

```
call tool.execute(args)
  ├── beforeCall(args, ctx)
  │     └── 返回 { block: true, reason } → 抛出 "工具调用被阻断"
  ├── tool.execute(args, ctx)
  └── afterCall(result, ctx)
        └── 返回修改后的 result
```

当前实现中，三个工具的 `beforeCall` 和 `afterCall` 均为 `undefined`，钩子处于预留状态。

#### 条件激活（isActive）

`getActive(ctx)` 遍历所有工具，只有当 `isActive` 返回 true（或不定义）时才会包含在结果中。当前三个工具均未设置 `isActive`，始终可见。

#### 与 Vercel AI SDK 的集成

```typescript
toAISdkTools(ctx: SkillContext): ToolSet {
  const tools: ToolSet = {};
  for (const tool of this.getActive(ctx)) {
    tools[tool.name] = {
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (args) => {
        await tool.beforeCall?.(args, ctx);
        let result = await tool.execute(args, ctx);
        result = await tool.afterCall?.(result, ctx) ?? result;
        return result;
      },
    };
  }
  return tools;
}
```

输出格式直接符合 `ToolSet` 类型，可无缝传入 `streamText({ tools })`。

### 3.2 三个工具的详细实现

所有工具定义在 `lib/ai/skills/research/index.ts`，通过 `registerSkills([...])` 批量注册。

#### 工具 1: search_knowledge_base

| 字段 | 内容 |
|------|------|
| name | `search_knowledge_base` |
| description | 在本地投研知识库中搜索与问题相关的资料 |
| inputSchema | `{ query: string, topK?: number (default 5) }` |
| skill | `research` |

**注意**: 这个工具没有使用完整的 RAG 管线（向量检索 + Rerank + MMR），而是使用一个极简的 `simpleSearch` 函数。见下文 3.3 分析。

#### 工具 2: read_document

| 字段 | 内容 |
|------|------|
| name | `read_document` |
| description | 根据文档 ID 读取某篇文档的完整内容 |
| inputSchema | `{ docId: string }` |
| skill | `research` |

**执行逻辑**:
1. 从 `data/index.json` 中查找匹配的文档
2. 如果找到，通过 `readMarkdownDocument()` 读取完整 Markdown
3. 回退：遍历所有 `DATA_DIRECTORIES` 目录，按文件名匹配
4. 返回 `{ id, title, content, frontmatter }`

#### 工具 3: get_facts

| 字段 | 内容 |
|------|------|
| name | `get_facts` |
| description | 查询股票或主题相关的可验证断言 |
| inputSchema | `{ stock?: string, theme?: string }` |
| skill | `research` |

**执行逻辑**:
1. 从 `data/facts.jsonl` 读取所有断言
2. 按 `stock` 或 `theme` 过滤（字符串包含匹配）
3. 取前 20 条，返回 `{ claim, state, evidenceLevel, stocks, themes }`

### 3.3 simpleSearch 的工作原理

`simpleSearch` 是 `search_knowledge_base` 使用的搜索实现，定义在 `lib/ai/skills/research/index.ts:12-32`。

```typescript
async function simpleSearch(query: string, topK: number) {
  const source = await readFile(RAG_FILES.chunks, 'utf8');
  const lines = source.split('\n').filter(Boolean);
  const kw = query.slice(0, 2);          // ← 只取前两个字符！
  const results = [];
  for (const line of lines) {
    const chunk = JSON.parse(line);
    const title = chunk.title || '';
    if (title.includes(kw)) {             // ← 标题包含匹配（2 字前缀）
      results.push({ chunk, score: 1 });
      if (results.length >= topK) break;
    }
  }
  return results;
}
```

**为什么绕过标准 RAG 管线？**

标准 RAG 管线（在 `lib/rag/` 中）包含完整的向量嵌入 → 混合评分 → Rerank → MMR 流程，但：

1. **延迟要求**: RAG 管线涉及 ONNX 模型推理（Xenova/bge-small-zh-v1.5）和 DeepSeek Rerank 调用，单次检索可能耗时 2-5 秒。在 LLM agent 的 tool-use 循环中，每个工具调用都必须等待返回，延迟会成倍放大。

2. **简单场景足够**: 研究 Agent 的搜索需求通常是精确查询（如"京东方业绩"、"CPO 产业链"），前 2 个字符的标题匹配在测试集中有不错的召回。

3. **无索引依赖**: 标准 RAG 需要重建索引（`npm run rag`），而 `simpleSearch` 直接读取 chunks JSONL 文件，始终反映最新数据。

4. **可并行**: 不依赖外部运行时，纯 Node.js 文件操作，适合 Serverless/ApiRoute。

**局限性**: 对语义相似但字面不匹配的查询（如"面板龙头"搜索"京东方"）无法召回。未来可能增加 `isActive` 条件——当标准 RAG 索引就绪时自动切换到完整管线。

#### 关于 research-tools.ts 的兼容性

`lib/ai/research-tools.ts` 保留了一份基于 Vercel AI SDK `tool()` 的旧定义，使用真正的 `retrieveRelevantChunks` 进行检索。文件末尾注释说明："已迁移至 skills/research/，此文件保留向后兼容"。当前被 `research-agent.ts` 使用的是 `skills/research/index.ts`（通过 `toolRegistry`）。

---

## 四、图编排引擎

定义在 `lib/agents/graph.ts`。

### 4.1 拓扑排序执行算法

```typescript
class SimpleGraph {
  private nodes = new Map<string, GraphNode>();

  async execute(initialCtx = {}): Promise<Map<string, unknown>> {
    const ctx = new Map(Object.entries(initialCtx));
    const completed = new Set<string>();
    const pending = new Set(this.nodes.keys());

    while (pending.size > 0) {
      // 找出所有依赖已满足的节点
      const ready = [];
      for (const id of pending) {
        const node = this.nodes.get(id)!;
        if (node.deps.every(d => completed.has(d))) {
          ready.push(node);
        }
      }

      // 死锁检测
      if (ready.length === 0) {
        throw new Error(`图执行死锁: ...`);
      }

      // 并行执行就绪节点
      await Promise.all(ready.map(async (node) => {
        const output = await node.execute(ctx);
        ctx.set(node.id, output);
        completed.add(node.id);
        pending.delete(node.id);
      }));
    }
    return ctx;
  }
}
```

**算法描述**: 迭代式拓扑排序。每轮找所有入度为零（依赖已满足）的节点，`Promise.all` 并行执行。节点输出通过共享的 `Map<string, unknown>` 上下文传递——这允许设计者控制依赖关系，但 TypeScript 无法在编译期验证类型安全性。

### 4.2 并行执行与死锁检测

- **并行**: 每轮中所有就绪节点通过 `Promise.all` 并行执行。在辩论场景中，plan 和 research 可以并行，但当前依赖关系是链式的。
- **死锁检测**: 如果某轮没有就绪节点且 pending 非空，说明形成了循环依赖或依赖缺失，抛出包含待处理节点和其依赖的详细错误消息。

### 4.3 四个节点的职责与依赖关系

| 节点 | ID | deps | 职责 | 执行位置 |
|------|----|------|------|----------|
| planNode | `plan` | [] | 拆解研究问题为子问题 | researchAgent 阶段 1 |
| researchNode | `research` | ['plan'] | 准备研究上下文（简化：仅标记 ready） | 仅用于 run.ts 的图编排 |
| debateNode | `debate` | ['research'] | 多角色多轮辩论 | researchAgent 阶段 3 |
| synthesizeNode | `synthesize` | ['debate'] | 综合报告 | researchAgent 阶段 3 |

**依赖关系图**:

```
plan → research → debate → synthesize
   ↑         ↑         ↑          ↑
 (根节点)  (占位节点) (对抗辩论)  (综合)
```

注意 `researchNode` 是一个占位节点——它不执行实际检索（实际研究在 `researchAgent` 的 phase 2 中通过 `streamText` 完成），仅返回 `{ subQuestions, status: 'ready' }`。这导致图编排在此场景中没有发挥并行优势，debate 和 synthesize 节点实际上依赖的是 `ctx` 中由 `researchAgent` 注入的 `report` 字段，而非 researchNode 的输出。

### 4.4 多轮辩论的对抗机制

见 2.3 节。核心流程是：

```
Round 1: Bull(标题, 3论点, 结论) → Bear(反驳, 3论点, 结论)
Round 2: Bull(参考Bear_R1) → Bear(参考Bull_R2)
Round N: ... → ...
Final:   Neutral(综合所有轮次)
```

**对抗设计要点**:
- **不对称先手**: Bull 始终先发言，Bear 获得对手论点作为靶子
- **上下文链接**: 每轮的 Bull 都能看到上一轮 Bear 的论点，形成持续性对抗
- **温度设定 0.5**: 比规划(0.2)和合成(0.3)更高，鼓励多样性观点
- **中立仲裁**: 最后一轮由 Neutral 综合，不参与对抗，仅提取关键变量

---

## 五、Provider 抽象层

### 5.1 LLMProvider 接口

定义在 `lib/ai/provider.ts`：

```typescript
interface LLMProvider {
  readonly id: string;                          // 'deepseek' | 'kimi'
  readonly capabilities: readonly Capability[]; // 'chat' | 'structured' | 'stream' | 'vision' | 'tools'

  chat(system, user, opts?): Promise<string>;                         // 普通对话
  structuredOutput<T>(schema, system, user, opts?): Promise<T>;       // 结构化输出 (JSON mode)
  streamChat(system, user, opts?): AsyncIterable<string>;             // 流式对话
}
```

### 5.2 DeepSeekProvider 实现

| 方法 | 实现细节 |
|------|----------|
| `chat` | POST `/chat/completions`, temperature 默认 0.3 |
| `structuredOutput` | POST + `response_format: { type: 'json_object' }`, temperature 默认 0.2, 然后 `schema.parse(JSON.parse(content))` |
| `streamChat` | POST + `stream: true`, 解析 SSE `data:` 行, 支持 `AbortSignal` |

**关键配置**（来自 `model.ts`）:
```
DEEPSEEK_BASE_URL   → https://api.deepseek.com
DEEPSEEK_MODEL      → deepseek-v4-pro
temperature         → chat: 0.3 (默认) / structured: 0.2 (默认) / stream: 0.3 (默认)
max_tokens          → 4096 (各方法统一)
```

**capabilities**: `['chat', 'structured', 'stream']` — 不支持 `vision`。

### 5.3 KimiProvider 实现

| 方法 | 实现细节 |
|------|----------|
| `chat` | POST `/v1/chat/completions`, temperature 默认 1 (kimi-k2.6 限制) |
| `structuredOutput` | 实际调用 `chat()` 后手动 JSON.parse + schema.parse（无原生 JSON mode） |
| `streamChat` | POST + `stream: true`, 解析 SSE, temperature 默认 1 |

**capabilities**: `['chat', 'vision']` — 不支持 `structured` 和 `stream`（其 `structuredOutput` 是模拟的）。

### 5.4 ProviderRegistry 的任务路由

```typescript
class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private taskMap = new Map<TaskType, string[]>();  // task → provider names

  register(name, provider, tasks?): void;           // 注册并绑定任务
  getForTask(task): LLMProvider;                    // 取任务的首选 provider
}
```

**注册逻辑**（在 `model.ts` 启动时执行）:

```typescript
providerRegistry.register('deepseek', new DeepSeekProvider(), ['generation', 'structured', 'stream']);
providerRegistry.register('kimi', new KimiProvider(), ['vision']);
```

**任务映射**:

| 任务类型 | 首选 Provider | 使用场景 |
|----------|---------------|----------|
| `generation` | DeepSeek | 辩论、合成、文章生成 |
| `structured` | DeepSeek | 规划模块 (JSON 输出) |
| `stream` | DeepSeek | 流式思考过程 |
| `vision` | Kimi | 图片/PDF 文字提取 |
| `debate` | (未显式注册) | 回退到无匹配时抛异常 |

**当 `getForTask('debate')` 被调用时**: 由于 `debate` 未在 taskMap 中注册，会抛出 `"没有注册支持任务 'debate' 的 Provider"`。但实际上，debate-node.ts 和 synthesize-node.ts 使用的都是 `getForTask('generation')`，所以正常工作。

### 5.5 降级链设计

当前注册结构只有单层选择（`candidates[0]`），没有真正的降级链：

```typescript
getForTask(task): LLMProvider {
  const candidates = this.taskMap.get(task);
  // 取第一个候选
  const provider = this.providers.get(candidates[0]);
  return provider;
}
```

如果 DeepSeek API 不可用，`getForTask('generation')` 会直接返回 DeepSeek 调用失败的错误。没有自动降级到 Kimi。

**预留的扩展点**: `taskMap` 存储的是 `string[]`（有序列表），说明设计者考虑过多候选降级，但目前并未实现 `try..catch` 回退逻辑。

---

## 六、调试系统

### 6.1 RunRecorder 设计

定义在 `lib/agent-debug/run-recorder.ts`。核心接口：

```typescript
class RunRecorder {
  readonly runId: string;        // agent_{timestamp}_{uuid8}

  constructor(userQuery, config);

  // 通用 step 包装（自动计时、记录输入输出）
  step<T>(name, type, fn, stepId?): Promise<T>;

  // 手动 step 开始/结束（用于 streamText 等异步循环）
  startStep(stepId, name, type);
  finishStep(stepId, status);

  // 特定事件记录
  recordLlmCall(stepId, prompt, response, latencyMs);
  recordToolCall(stepId, toolName, args, result);
  recordRagRetrieve(stepId, query, resultsCount, topK);

  // 结束并持久化
  finish(finalAnswer?, error?): Promise<void>;
}
```

**数据模型**:

`AgentRun` (运行级别):
```typescript
interface AgentRun {
  runId; userQuery; status; startedAt; endedAt; latencyMs;
  config; model; totalTokens?;
  steps: AgentStep[];          // 步骤数组（内存中维护）
  finalAnswer?; error?;
}
```

`AgentStep` (步骤级别):
```typescript
interface AgentStep {
  stepId; runId; type; name; status;
  startedAt; endedAt; latencyMs;
  prompt?; response?;
  toolCall?; toolResult?;
  ragRetrieve?; error?;
}
```

### 6.2 事件类型清单

所有事件类型在 `research-agent.ts` 的 `AgentEvent.type` 和 `run-recorder.ts` 的 `AgentDebugEvent.type` 中定义：

**Agent 流事件** (对外 — 通过 SSE 发送到前端):
```
agent_plan          → 研究方案
agent_step          → 步骤进度
agent_tool_call     → 工具调用开始（含参数）
agent_tool_result   → 工具调用结果（含摘要）
agent_evidence      → 证据（预留）
agent_debate_start  → 辩论开始（含视角列表）
agent_debate_result → 辩论结果
report_chunk        → 流式文本块（delta + 累积 content）
report_done         → 报告完成（含完整报告）
error               → 错误
```

**内部调试事件** (对内 — 写入 JSONL，不在 SSE 中暴露):
```
run_started         → 包含 userQuery, config
step_started        → 包含 stepId, name, stepType
step_finished       → 包含 status, latencyMs
llm_call            → 包含 system prompt, user message, response, latencyMs
tool_call           → 包含 toolName, args, result
rag_retrieve        → 包含 query, resultsCount, topK
run_error           → 包含 error type, message
run_finished        → 包含 status, latencyMs
```

当前没有 `rag_retrieve` 在 `researchAgent` 中被调用——该功能为未来 RAG 集成预留。

### 6.3 Step Timeline 的实现

前端 `/agent-debug/[runId]/page.tsx` 展示 Step Timeline：

1. `/api/agent-debug/runs/[runId]` 读取 `events/{runId}.jsonl` 文件
2. 前端过滤 `step_started` 事件作为条目列表
3. 每条找到对应的 `step_finished` 事件获取状态和延迟
4. 展开时显示关联的 `llm_call` 和 `tool_call` 事件
5. 错误诊断区显示 `run_error` 事件详情

**性能**: Step 时间线性树渲染，每个 step 展开时查找其子事件的复杂度为 `O(n)` (遍历 + filter)。

### 6.4 LLM 调用记录的埋点方式

LLM 调用通过两种方式记录：

1. **planNode**: 使用 `recorder.step()` 包裹执行 → `step()` 内部自动记录开始/结束；额外的 `recorder.recordLlmCall()` 在 step 内手动调用，写入 prompt、response

2. **streamText**: 整个循环由 `recorder.startStep()` 开始，`recorder.finishStep()` 结束（按时间跨度记录，非按 LLM 调用）

3. **debateNode / synthesizeNode**: 使用 `recorder.step()` 包裹 → 自动记录

**关键区别**: `recordLlmCall` 直接将 prompt/json 写入事件流，不包含 token 计数（`tokens` 字段在类型中定义了但从未填充）。`streamText` 循环中的每个 tool-call 通过 `recordToolCall` 记录，但 LLM 对工具响应的消费（即第二次 LLM 调用）不单独记录。

### 6.5 数据持久化

```
data/agent-traces/
├── runs.jsonl           # 运行摘要（每行一个 run，取 finalAnswer 前 100 字）
├── feedback.jsonl       # 用户反馈
└── events/
    ├── agent_abc123.jsonl  # 单次运行的所有事件
    └── ...
```

**写入逻辑** (`RunRecorder.finish()`):
1. `runs.jsonl` — append 单行 JSON
2. `events/{runId}.jsonl` — 覆盖写入全部 events（不是 append，使用 `appendFile` 拼接）

当前没有清理机制，events 文件累积不会自动删除。当有大量 research 执行时，`events/*.jsonl` 可能会占用显著磁盘空间。

### 6.6 错误分类

```typescript
classifyError(err): AgentError {
  name === 'AbortError' / msg.includes('timeout') → timeout
  msg.includes('rate') / '429'                    → rate_limited
  msg.includes('parse') / 'JSON'                  → llm_json_parse_failed
  msg.includes('tool')                            → tool_call_failed
  msg.includes('provider') / 'API' / 'fetch'      → provider_unavailable
  msg.includes('rag') / '检索'                    → rag_no_results
  其他                                            → unknown
}
```

---

## 七、关键文件清单

### Agent 核心

| 文件路径 | 功能说明 |
|----------|----------|
| `lib/ai/research-agent.ts` | Agent 主循环：AsyncGenerator 三阶段编排（plan → streamText → debate/synthesize） |
| `lib/agents/run.ts` | 研究 Graph 编排辅助函数 `runResearchGraph()` + `runDebateAndSynthesis()` |
| `lib/agents/graph.ts` | `SimpleGraph` DAG 引擎：拓扑排序执行、并行、死锁检测 |
| `lib/agents/index.ts` | 模块入口，统一导出 |

### 节点

| 文件路径 | 功能说明 |
|----------|----------|
| `lib/agents/nodes/plan-node.ts` | `planNode`：LLM 拆解研究问题 → { title, subQuestions } |
| `lib/agents/nodes/research-node.ts` | `researchNode`：占位节点，标记研究就绪 |
| `lib/agents/nodes/debate-node.ts` | `createDebateNode()`：多轮 Bull ↔ Bear 对抗辩论 + Neutral 综合 |
| `lib/agents/nodes/synthesize-node.ts` | `synthesizeNode`：合并原始报告 + 辩论结果 → 综合报告 |

### 工具系统

| 文件路径 | 功能说明 |
|----------|----------|
| `lib/ai/skills/registry.ts` | `ToolRegistry`：注册、条件激活、生命周期钩子、Vercel AI SDK 转换 |
| `lib/ai/skills/types.ts` | `SkillTool` / `SkillContext` / `SkillPackage` 类型定义 |
| `lib/ai/skills/research/index.ts` | 三个工具实现：`search_knowledge_base` / `read_document` / `get_facts` |
| `lib/ai/skills/loader.ts` | `registerSkills()` / `getResearchTools()` 工具注册入口 |
| `lib/ai/research-tools.ts` | 旧版工具定义（已迁移，保留向后兼容），使用标准 RAG |

### Provider 层

| 文件路径 | 功能说明 |
|----------|----------|
| `lib/ai/provider.ts` | `LLMProvider` 接口定义（chat / structuredOutput / streamChat） |
| `lib/ai/provider-registry.ts` | `ProviderRegistry`：任务 → Provider 路由映射 |
| `lib/ai/providers/deepseek.ts` | `DeepSeekProvider` 实现：原生 JSON mode、SSE 流式 |
| `lib/ai/providers/kimi.ts` | `KimiProvider` 实现：高 temperature、手动 JSON 解析 |
| `lib/ai/model.ts` | 配置读取（`getDeepSeekConfig()`/`getKimiConfig()`）、`callDeepSeekStructuredOutput()`、JSON 提取 `extractJsonObject()`、Provider 自动注册 |
| `lib/ai/stream.ts` | `streamDeepSeekResponse()` / `collectStreamResult()` 流式 HTTP 调用 |

### 调试系统

| 文件路径 | 功能说明 |
|----------|----------|
| `lib/agent-debug/types.ts` | `AgentRun` / `AgentStep` / `AgentError` / `AgentFeedback` 等类型定义 |
| `lib/agent-debug/run-recorder.ts` | `RunRecorder`：事件记录、step 管理、JSONL 持久化、错误分类 |
| `app/agent-debug/page.tsx` | Agent 调试页面：运行列表、状态过滤 |
| `app/agent-debug/[runId]/page.tsx` | 单次运行详情：Step 时间线、LLM 调用查看、工具调用记录、错误诊断、反馈提交 |
| `app/api/agent-debug/runs/route.ts` | GET 最近 50 次运行摘要 |
| `app/api/agent-debug/runs/[runId]/route.ts` | GET 单次运行事件详情 |
| `app/api/agent-debug/feedback/route.ts` | POST 用户反馈（rating + labels + comment） |

### API 路由

| 文件路径 | 功能说明 |
|----------|----------|
| `app/api/ai/research/route.ts` | POST 启动研究：Zod 校验 → `researchAgent()` → SSE 流式输出 |

### 测试与配置

| 文件路径 | 功能说明 |
|----------|----------|
| `tests/` | （尚未针对 agent 模块编写测试） |
| `data/agent-traces/` | 调试数据自动落盘目录（运行时创建） |
| `config/` | 雪球爬虫监控列表等配置 |
