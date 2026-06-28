# trading-wiki 技术架构 v2 设计方案

> 基于 Pi / TradingAgents / cc-haha 对比分析，在不破坏现有功能的前提下渐进式演进。

---

## 一、整体架构图

### 当前架构（四层）

```
页面层（app/**/page.tsx）
  ↓
API 路由层（app/api/**/route.ts）   ← Zod 入参校验
  ↓
业务逻辑层（lib/**/*.ts）          ← 纯函数
  ↓
数据存储层（data/ + rag/）          ← 本地文件
```

### v2 架构（六层）

新增 **基础设施层**（纯接口定义）和 **编排层**（Agent DAG），原有四层不变但内部实现迁移至新抽象。

```
┌─────────────────────────────────────────────────────────────┐
│                       入口层（Entry）                          │
│  Web (Next.js App Router) │ CLI (可选) │ Bridge (未来扩展)    │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│                     API 路由层（现有）                         │
│  app/api/**/route.ts  ← 业务入口编排，无 LLM 直接调用           │
│  变更：所有 AI 调用通过 Provider 抽象，工具调用通过 Registry    │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│                  Agent 编排层（新增）                          │
│                                                              │
│  SimpleGraph (DAG Executor)                                  │
│  ├─ Nodes: PlanNode / RetrieveNode / DebateNode / Synthesize │
│  ├─ Multi-round Debate Engine                                │
│  ├─ Fallback Chain Manager                                   │
│  └─ Trace / Event Emitter                                    │
│                                                              │
│  EventBus (SSE stream events)                                │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│                    业务逻辑层（重构）                          │
│                                                              │
│  ┌──────────────────────┐   ┌───────────────────────────┐    │
│  │  LLM Provider 抽象层   │   │  Skills / Tool Registry    │    │
│  │  （新增）              │   │  （新增）                   │    │
│  │                      │   │                           │    │
│  │  LLMProvider         │   │  ToolRegistry              │    │
│  │  ├─ DeepSeekProvider │   │  ├─ register(name, def)    │    │
│  │  ├─ KimiProvider     │   │  ├─ getAll()               │    │
│  │  └─ ClaudeProvider   │   │  ├─ beforeCall hooks       │    │
│  │                      │   │  └─ afterCall hooks        │    │
│  └──────────────────────┘   └───────────────────────────┘    │
│                                                              │
│  ┌──────────────────────┐   ┌───────────────────────────┐    │
│  │  现有业务模块（迁移）   │   │  RAG 管线（增强）           │    │
│  │  extract-viewpoint   │   │  source-router            │    │
│  │  generate-review     │   │  retrieve                 │    │
│  │  generate-theme      │   │  rerank                   │    │
│  │  generate-stock      │   │  embed                    │    │
│  │  research-agent      │   │  + fallback chain         │    │
│  └──────────────────────┘   └───────────────────────────┘    │
│                                                              │
│  ┌──────────────────────┐   ┌───────────────────────────┐    │
│  │  Memory System（新增） │   │  Skills 插件              │    │
│  │  memdir extract      │   │  markdown-based skills    │    │
│  │  relevant检索        │   │  conditional activation   │    │
│  │  prompt injection    │   │                           │    │
│  └──────────────────────┘   └───────────────────────────┘    │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│                   数据存储层（不变）                           │
│  data/ (Markdown + YAML frontmatter)                        │
│  rag/ (JSONL chunks/embeddings)                             │
│  lib/storage/ (paths, frontmatter, md-store, index, facts)  │
└─────────────────────────────────────────────────────────────┘
```

### 依赖关系

```
入口层 → API路由层 → 编排层 → 业务逻辑层
                                  ├── Provider 抽象层（所有AI调用经此）
                                  ├── Skills Registry（所有工具经此）
                                  ├── 现有业务模块（各模块独立）
                                  ├── RAG 管线（无外部依赖）
                                  └── Memory 系统（可选）
                                      ↓
                                 数据存储层（仅依赖 fs 和 gray-matter）
```

**关键约束**：
- 新增层只能依赖其下层，不能反向引用
- `lib/` 目录下的所有模块不得依赖 Next.js（保持 CLI 兼容性）
- 现有 `callDeepSeekStructuredOutput` 等函数保留但不推荐在新代码中使用

---

## 二、LLM Provider 抽象层

### 设计原则

1. **接口优先**：定义 `LLMProvider` 接口，所有 AI 调用通过接口进行
2. **注册表模式**：Provider 实例在 `lib/ai/provider-registry.ts` 中注册，调用方按名称或任务类型获取
3. **降级链**：每个任务类型可配置主模型和回退模型
4. **零成本切换**：切换模型只需新增 Provider 实现 + 配置行，不修改业务代码

### 核心接口

```typescript
// lib/ai/provider.ts

/** 通用调用选项 */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** response_format 约束 */
  responseFormat?: 'json_object' | 'text';
  /** 流式模式 */
  stream?: boolean;
  /** 思考/推理参数 */
  reasoning?: { effort: 'low' | 'medium' | 'high' | 'max' };
  /** 中止信号 */
  signal?: AbortSignal;
  /** 自定义头部（某些 provider 需要） */
  headers?: Record<string, string>;
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 工具定义（与具体 Provider 无关的内部表示） */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  execute: (args: unknown) => Promise<unknown>;
}

/** 流式输出块 */
export interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done';
  delta?: string;
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
}

/** Provider 接口：所有 LLM 提供者必须实现 */
export interface LLMProvider {
  /** Provider 唯一标识 */
  readonly name: string;

  /** 非流式文本生成 */
  chat(
    system: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<string>;

  /** 流式文本生成 */
  streamChat(
    system: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk>;

  /** 结构化输出（JSON mode） */
  structuredOutput<T>(
    schema: z.ZodType<T>,
    system: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<T>;

  /** 带工具调用的生成 */
  chatWithTools(
    system: string,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions & { maxSteps?: number },
  ): AsyncGenerator<StreamChunk>;
}
```

### Provider 实现

```typescript
// lib/ai/providers/deepseek.ts
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';

  constructor(config: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
  }) { /* ... */ }

  // 实现所有接口方法
  // 将现有的 callDeepSeekStructuredOutput 和 streamDeepSeekResponse 逻辑迁移至此
}

// lib/ai/providers/kimi.ts
export class KimiProvider implements LLMProvider {
  readonly name = 'kimi';
  // 仅支持 vision 场景，不支持 tool calls
  // 实现必要的方法，不支持的方法抛 NotSupportedError
}

// lib/ai/providers/index.ts
export { DeepSeekProvider } from './deepseek';
export { KimiProvider } from './kimi';
// 未来可添加 ClaudeProvider, GeminiProvider 等
```

### 注册表与模型路由

```typescript
// lib/ai/provider-registry.ts

/** 任务类型 → 所需模型能力 */
export type TaskCapability =
  | 'generation'    // 通用文本生成
  | 'structured'    // JSON 结构化输出
  | 'vision'        // 图像理解
  | 'rerank'        // Rerank 打分
  | 'embedding'     // 文本嵌入
  | 'debate';       // 多轮辩论（需高推理能力）

/** 注册表中的 Provider 条目 */
interface ProviderEntry {
  provider: LLMProvider;
  priority: number;  // 数字越大优先级越高
  capabilities: TaskCapability[];
}

/** 模型路由：任务 → Provider + 降级链 */
export interface ModelRoute {
  primary: string;         // Provider name
  fallback?: string;       // 降级 provider name
  lastResort?: string;     // 最终降级
}

class ProviderRegistry {
  private providers = new Map<string, ProviderEntry>();

  /** 注册 Provider */
  register(provider: LLMProvider, capabilities: TaskCapability[], priority = 0): void;

  /** 按任务类型获取最优 Provider（含降级） */
  getProvider(task: TaskCapability): LLMProvider;

  /** 按名称获取特定 Provider */
  getByName(name: string): LLMProvider | undefined;

  /** 配置模型路由 */
  configureRoute(task: TaskCapability, route: ModelRoute): void;
}

// 全局单例
export const providerRegistry = new ProviderRegistry();
```

### 配置方式

```typescript
// lib/ai/provider-config.ts

export interface ProviderConfig {
  deepseek?: {
    apiKey?: string;      // 默认从 DEEPSEEK_API_KEY 读取
    baseUrl?: string;
    model?: string;
  };
  kimi?: {
    apiKey?: string;      // 默认从 MOONSHOT_API_KEY 读取
    baseUrl?: string;
    model?: string;
  };
  /** 任务 → 模型路由 */
  routing?: Partial<Record<TaskCapability, ModelRoute>>;
}

/** 默认配置（从环境变量读取）*/
export const defaultProviderConfig: ProviderConfig = {
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro',
  },
  routing: {
    generation:   { primary: 'deepseek' },
    structured:   { primary: 'deepseek' },
    vision:       { primary: 'kimi' },
    rerank:       { primary: 'deepseek' },
    embedding:    { primary: 'deepseek' },   // 仅用于 rerank，实际 embedding 不经过此
    debate:       { primary: 'deepseek' },
  },
};

/** 初始化注册表 */
export function initializeProviders(config?: ProviderConfig): void;

/** 获取 provider（快捷方式） */
export function getLLM(task: TaskCapability = 'generation'): LLMProvider;
```

### 迁移路径

1. 创建 `lib/ai/provider.ts`（接口定义）
2. 创建 `lib/ai/providers/deepseek.ts`（将 `callDeepSeekStructuredOutput` 和 `streamDeepSeekResponse` 合并为 `DeepSeekProvider`）
3. 创建 `lib/ai/providers/kimi.ts`（包装 `getKimiConfig` 的场景）
4. 创建 `lib/ai/provider-registry.ts`（注册表）
5. 创建 `lib/ai/provider-config.ts`（配置初始化）
6. 修改 `lib/ai/model.ts`：将 `callDeepSeekStructuredOutput` 改写成 `providerRegistry.getProvider('structured').structuredOutput(...)` 的代理
7. 修改 `lib/ai/stream.ts`：改为调用 `providerRegistry.getProvider('generation').streamChat(...)`
8. 修改 `lib/ai/research-agent.ts`：用 `provider.chatWithTools()` 替换直接 fetch
9. 验证：`npm run test` + 端到端测试

### 向后兼容

```typescript
// lib/ai/model.ts（修改后）
import { providerRegistry } from './provider-registry';

// 保留原有函数签名，但内部实现改为通过 Provider 抽象
export async function callDeepSeekStructuredOutput<T>(
  schema: z.ZodType<T>,
  prompts: { system: string; user: string },
): Promise<T> {
  const provider = providerRegistry.getProvider('structured');
  return provider.structuredOutput(
    schema,
    prompts.system,
    [{ role: 'user', content: prompts.user }],
    { temperature: 0.2, reasoning: { effort: 'max' }, maxTokens: 393216 },
  );
}
```

---

## 三、Skills / Tool Registry 系统

### 设计原则

1. **声明式注册**：每个工具是一个独立文件，export `name/description/schema/execute`
2. **生命周期钩子**：`beforeToolCall` / `afterToolCall` 提供拦截、审计、阻断能力
3. **按需加载**：按技能包分组，Agent 自动发现所需技能包并激活
4. **条件激活**：工具可根据当前 Agent 上下文自动启用/禁用

### ToolRegistry 核心

```typescript
// lib/ai/skills/registry.ts

export interface ToolHookContext {
  toolName: string;
  agentId?: string;
  query?: string;
  config: ResearchConfig;
}

/** 工具注册定义 */
export interface SkillTool {
  /** 唯一标识，如 'search_knowledge_base' */
  name: string;
  /** 给 LLM 看的描述 */
  description: string;
  /** Zod 输入 schema */
  inputSchema: z.ZodType<unknown>;
  /** 执行体 */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** 执行前钩子（可阻断或修改参数） */
  beforeCall?: (
    args: Record<string, unknown>,
    ctx: ToolHookContext,
  ) => Promise<{ block?: boolean; reason?: string; modifiedArgs?: Record<string, unknown> }>;
  /** 执行后钩子（可截断或修改结果） */
  afterCall?: (
    result: unknown,
    ctx: ToolHookContext,
  ) => Promise<{ terminate?: boolean; modified?: unknown }>;
  /** 该工具属于哪个技能包 */
  skillPack?: string;
  /** 条件激活函数（返回 false 则此工具对 LLM 不可见） */
  isActive?: (ctx: ToolHookContext) => boolean;
}

export class ToolRegistry {
  private tools = new Map<string, SkillTool>();

  /** 注册一个工具 */
  register(tool: SkillTool): void;

  /** 注册一组工具（从模块加载） */
  registerPack(packName: string, tools: SkillTool[]): void;

  /** 获取某工具 */
  get(name: string): SkillTool | undefined;

  /** 获取所有工具（按当前上下文过滤激活状态） */
  getActive(ctx?: ToolHookContext): SkillTool[];

  /** 转换为 Vercel AI SDK 的 tool() 格式 */
  toAISdkTools(ctx?: ToolHookContext): Record<string, ReturnType<typeof tool>>;

  /** 执行工具（自动触发 hooks） */
  execute(name: string, args: Record<string, unknown>, ctx: ToolHookContext): Promise<unknown>;
}

export const toolRegistry = new ToolRegistry();
```

### 技能包结构

```typescript
// lib/ai/skills/research/  ← 研究技能包
//   ├── index.ts           ← export function registerResearchSkills(registry)
//   ├── search-kb.ts       ← search_knowledge_base 工具
//   ├── read-doc.ts        ← read_document 工具
//   └── get-facts.ts       ← get_facts 工具

// lib/ai/skills/review/    ← 复盘技能包（未来）
// lib/ai/skills/crawl/     ← 采集技能包（未来）
// lib/ai/skills/user/      ← 用户自定义技能包（Markdown 式）

// skills/                  ← 用户自定义 Skill（根目录）
//   ├── quarterly-check.md
//   └── custom-analysis.ts
```

### 技能包注册示例

```typescript
// lib/ai/skills/research/search-kb.ts
import { z } from 'zod';
import type { SkillTool } from '../registry';

export const searchKnowledgeBase: SkillTool = {
  name: 'search_knowledge_base',
  description: '在本地投研知识库中搜索与问题相关的内容。用于查找股票、产业链、观点、复盘等资料。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词，使用中文，尽可能具体'),
    topK: z.number().default(5).describe('返回结果数量，默认5'),
  }),
  execute: async ({ query, topK }) => {
    const { retrieveRelevantChunks } = await import('@/lib/rag/retrieve');
    const hits = await retrieveRelevantChunks({ query, topK: Math.min(topK as number, 10) });
    return hits.map((h) => ({
      id: h.chunk.id,
      docId: h.chunk.docId,
      title: h.chunk.title,
      docType: h.chunk.docType,
      content: h.chunk.content.slice(0, 600),
      score: h.finalScore,
      date: h.chunk.date,
      heading: h.chunk.headingPath.join(' > '),
    }));
  },
  skillPack: 'research',
};
```

### 生命周期钩子用例

```typescript
// 在 Agent 启动时注册钩子

// 审计日志钩子（全局）
toolRegistry.register({
  name: '__audit_hook',
  beforeCall: async (args, ctx) => {
    console.log(`[AUDIT] tool=${ctx.toolName} agent=${ctx.agentId}`);
    return {}; // 不阻断
  },
  afterCall: async (result, ctx) => {
    if (typeof result === 'object' && result !== null) {
      const size = JSON.stringify(result).length;
      console.log(`[AUDIT] tool=${ctx.toolName} result_size=${size}`);
    }
    return {};
  },
  // 注意：这是伪注册，实际不作为一个独立工具暴露给 LLM
  // hooks 需要通过 Registry 的 beforeCall/afterCall 机制附加到工具调用上
});

// 风险规则钩子：阻断含特定关键词的工具调用
const riskHook = {
  beforeCall: async (args: Record<string, unknown>, ctx: ToolHookContext) => {
    const queryStr = JSON.stringify(args);
    const blockedTerms = ['实时行情', '涨停', '跌停', '代码'];
    const found = blockedTerms.find((t) => queryStr.includes(t));
    if (found) {
      return {
        block: true,
        reason: `检测到敏感搜索词"${found}"，投研系统不提供实时行情查询`,
      };
    }
    return {};
  },
};
```

### 条件激活示例

```typescript
// research 技能包中的 get_facts 工具，只在配置了 debate=true 时才激活
export const getFacts: SkillTool = {
  name: 'get_facts',
  description: '查询可验证断言',
  // ...
  isActive: (ctx) => ctx.config?.debate !== false, // 默认激活，只有显式关闭时才隐藏
};
```

### 动态加载与自动发现

```typescript
// lib/ai/skills/loader.ts

export async function loadAllSkillPacks(): Promise<void> {
  // 1. 内置技能包自动加载
  const { registerResearchSkills } = await import('@/lib/ai/skills/research');
  registerResearchSkills(toolRegistry);

  const { registerReviewSkills } = await import('@/lib/ai/skills/review');
  registerReviewSkills(toolRegistry);

  // 2. 扫描 skills/ 目录加载用户自定义 Skill
  //    （Markdown 格式 → 解析 frontmatter → 注册为 prompt 注入式 Skill）
  const userSkills = await loadUserSkills();
  for (const skill of userSkills) {
    toolRegistry.register(skill);
  }
}

// 初始化时调用
await loadAllSkillPacks();
```

### 现有代码迁移

**修改 research-tools.ts**：
```typescript
// lib/ai/research-tools.ts（重写为注册方式）
import { toolRegistry } from './skills/registry';
import { searchKnowledgeBase } from './skills/research/search-kb';
import { readDocument } from './skills/research/read-doc';
import { getFacts } from './skills/research/get-facts';

// 注册所有研究工具
export function registerResearchTools(): void {
  toolRegistry.register(searchKnowledgeBase);
  toolRegistry.register(readDocument);
  toolRegistry.register(getFacts);
}

// 保留 researchTools 向后兼容（供现有代码使用）
import { tool as aiSdkTool } from 'ai';

export const researchTools = { /* ... 通过 toolRegistry.toAISdkTools() 构建 */ };
```

---

## 四、Agent 编排层

### 设计原则

1. **轻量 DAG**：自研 SimpleGraph，不引入 LangGraph，与「不使用数据库」的设计哲学一致
2. **事件驱动**：所有节点产出 `AgentEvent`，通过 AsyncGenerator 流式输出
3. **多轮对抗辩论**：可配置轮次（1-3轮），每轮 Bull/Bear 依次回应对手论据
4. **可组合性**：节点可复用（PlanNode 可在多个 Agent 流程中使用）

### SimpleGraph 引擎

```typescript
// lib/agents/graph.ts

export type NodeState = 'idle' | 'running' | 'done' | 'failed';

export interface GraphNode {
  id: string;
  /** 依赖的节点 ID 列表 */
  deps: string[];
  /** 执行体 */
  execute: (ctx: GraphContext) => Promise<unknown>;
  /** 超时（毫秒） */
  timeout?: number;
  /** 最多重试次数 */
  maxRetries?: number;
  /** 条件分支（返回 true 才执行本节点） */
  condition?: (ctx: GraphContext) => boolean;
}

export interface GraphContext {
  /** 共享数据平面 */
  data: Map<string, unknown>;
  /** 初始输入 */
  input: unknown;
  /** 获取上游节点结果 */
  getOutput(nodeId: string): unknown;
  /** 设置本节点输出 */
  setOutput(value: unknown): void;
  /** 事件发射 */
  emit(event: AgentEvent): void;
}

export class SimpleGraph {
  private nodes = new Map<string, GraphNode>();
  private sorted: string[] = [];

  addNode(node: GraphNode): void;
  removeNode(id: string): void;

  /** 拓扑排序 */
  private topologicalSort(): string[];

  /** 执行整个图 */
  async *execute(input: unknown): AsyncGenerator<AgentEvent>;
}
```

### 预定义节点类型

```typescript
// lib/agents/nodes/plan-node.ts
export class PlanNode implements GraphNode {
  id = 'plan';
  deps = [];

  async execute(ctx: GraphContext): Promise<ResearchPlan> {
    const question = ctx.input as string;
    const provider = providerRegistry.getProvider('structured');
    const plan = await provider.structuredOutput(researchPlanSchema,
      '你是一个A股投研专家。请分析用户的研究问题，将其拆解为2-5个具体可搜索的子问题。',
      [{ role: 'user', content: question }],
    );
    ctx.emit({ type: 'agent_plan', data: plan });
    return plan;
  }
}

// lib/agents/nodes/research-node.ts
export class ResearchNode implements GraphNode {
  id = 'research';
  deps = ['plan'];

  async execute(ctx: GraphContext): Promise<string> {
    const plan = ctx.getOutput('plan') as ResearchPlan;
    // 使用 toolRegistry.toAISdkTools() 获取工具
    // 使用 provider.chatWithTools(...) 执行多步研究
    // 流式输出 report_chunk 事件
    // 返回完整报告
  }
}

// lib/agents/nodes/debate-node.ts
export class DebateNode implements GraphNode {
  id = 'debate';
  deps = ['research'];

  constructor(private rounds: number = 2) {}

  async execute(ctx: GraphContext): Promise<DebateResult> {
    const report = ctx.getOutput('research') as string;

    for (let round = 0; round < this.rounds; round++) {
      // Bull 回应 Bear 上一轮观点
      const bullish = await this.debateRound('bullish', /* previous context */);
      // Bear 回应 Bull 上一轮观点
      const bearish = await this.debateRound('bearish', /* previous context */);
      ctx.emit({ type: 'agent_debate_round', data: { round, bullish, bearish } });
    }

    // 最终中立视角合成
    return this.finalSynthesis(bullish, bearish, report);
  }
}

// lib/agents/nodes/synthesize-node.ts
export class SynthesizeNode implements GraphNode {
  id = 'synthesize';
  deps = ['debate']; // 如果 debate 未启用则 deps = ['research']

  async execute(ctx: GraphContext): Promise<string> {
    const report = ctx.getOutput('research') as string;
    const debate = ctx.getOutput('debate') as DebateResult | undefined;
    // 综合多视角输出最终报告
  }
}
```

### 标准研究 Agent 流程图

```
                    ┌──────────┐
                    │   Plan   │
                    │   Node   │
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ Research │
                    │   Node   │  ← 多步工具调用（skills: search/read/facts）
                    └────┬─────┘
                         │
              ┌──────────▼──────────┐
              │  DebateEnabled?     │
              │  (条件分支)          │
              └────┬──────────┬─────┘
                   │ No       │ Yes
                   │     ┌────▼──────┐
                   │     │  Debate   │
                   │     │  Nodes    │  ← 多轮对抗（可配置 rounds）
                   │     │ (Bull→Bear)│
                   │     └────┬──────┘
                   │          │
              ┌────▼──────────▼─────┐
              │   Synthesize Node    │
              └──────────┬───────────┘
                         │
                    ┌────▼─────┐
                    │  Done    │
                    │ (report) │
                    └──────────┘
```

### 与现有 research-agent.ts 的兼容

```typescript
// lib/ai/research-agent.ts（重写）

export async function* researchAgent(
  question: string,
  config: ResearchConfig = { depth: 'standard', focus: 'comprehensive', debate: true },
): AsyncGenerator<AgentEvent> {
  const graph = new SimpleGraph();

  graph.addNode(new PlanNode());
  graph.addNode(new ResearchNode(config));

  if (config.debate) {
    const debateRounds = config.depth === 'deep' ? 3 : 2;
    graph.addNode(new DebateNode(debateRounds));
  }

  graph.addNode(new SynthesizeNode());
  yield* graph.execute(question);
}
```

---

## 五、数据源降级链

### 设计

```typescript
// lib/rag/fallback-chain.ts（新增）

/** 各意图的降级链配置 */
const FALLBACK_CHAINS: Record<string, FallbackChain> = {
  recency: {
    primary: ['raw', 'material', 'viewpoint'],
    fallback: ['daily_review', 'note'],          // 降级一级
    lastResort: ['qa', 'stock_profile'],          // 最终降级
  },
  chain: {
    primary: ['theme_research', 'material', 'stock_profile'],
    fallback: ['viewpoint', 'note'],
    lastResort: ['daily_review', 'qa'],
  },
  // ... 其他意图类似
};

/** 在 retrieve.ts 中集成降级链 */
export async function retrieveWithFallback(
  options: RetrieveOptions,
  chain?: FallbackChain,
): Promise<RagSearchHit[]> {
  if (!chain) return retrieveRelevantChunks(options);

  // 1. 主文档类型检索
  const primaryHits = await retrieveRelevantChunks({
    ...options,
    docTypes: chain.primary,
  });

  if (primaryHits.length >= (options.topK ?? 8)) {
    return primaryHits;
  }

  // 2. 数量不足 → 降级检索（排除已命中文档）
  const existingIds = new Set(primaryHits.map(h => h.chunk.id));
  const fallbackHits = await retrieveRelevantChunks({
    ...options,
    docTypes: chain.fallback,
  });
  const merged = mergeWithPriority(primaryHits, fallbackHits, existingIds);

  if (merged.length >= (options.topK ?? 8)) {
    return merged.slice(0, options.topK);
  }

  // 3. 最终降级
  const lastHits = await retrieveRelevantChunks({
    ...options,
    docTypes: chain.lastResort,
  });
  return mergeWithPriority(merged, lastHits, existingIds).slice(0, options.topK ?? 8);
}
```

---

## 六、Entity-Aware Multi-Query 增强

```typescript
// lib/rag/multi-query.ts（新增）

/** 按意图生成多角度查询（比当前 recencyExpansion 更通用） */
export function generateMultiAngleQueries(
  baseQuery: string,
  intent: string,
  entities?: ParsedEntities,
): string[] {
  const queries = [baseQuery];

  switch (intent) {
    case 'stock_deep':
      // 基本面、技术面、产业链条三个角度
      queries.push(baseQuery + ' 业绩 财务 估值');
      queries.push(baseQuery + ' 技术 产品 产能 订单');
      if (entities?.themes?.length) {
        queries.push(entities.themes[0] + ' ' + baseQuery + ' 供应链');
      }
      break;
    case 'chain':
      // 下游需求、中游制造、上游供给
      queries.push(baseQuery + ' 需求 下游 应用');
      queries.push(baseQuery + ' 供给 上游 材料');
      queries.push(baseQuery + ' 格局 竞争 集中度');
      break;
    case 'recency':
      // 事件、业绩、技术、供应链
      queries.push(baseQuery + ' 催化 事件 订单');
      queries.push(baseQuery + ' 业绩 公告 财报');
      queries.push(baseQuery + ' 技术 突破 量产');
      break;
  }

  return [...new Set(queries)].slice(0, 4);
}
```

在 `source-router.ts` 的 `enrichRoute` 中集成：

```typescript
// 在原有的 recency/verification 扩展之后，统一调用
if (!route.expandedQueries || route.expandedQueries.length === 0) {
  route.expandedQueries = generateMultiAngleQueries(
    route.rewrittenQuery || query,
    route.intent,
    route.entities,
  );
}
```

---

## 七、跨会话记忆系统

### 设计（初步阶段）

```typescript
// lib/memory/memdir.ts

export interface MemoryEntry {
  id: string;
  type: 'fact' | 'preference' | 'topic' | 'pattern';
  content: string;
  entities: { stocks?: string[]; themes?: string[] };
  created_at: string;
  updated_at: string;
  /** 置信度：confirmed / inferred / tentative */
  confidence: 'confirmed' | 'inferred' | 'tentative';
}

// data/memory/ 目录
//   facts/          ← 已确认事实（自动从 facts 和 verifiable_claims 提取）
//   topics/         ← 高频研究主题
//   patterns.md     ← 重复出现的分析模式

export class Memdir {
  /** 每次会话后从内容中提取可记忆信息 */
  async extract(sessionContent: string): Promise<MemoryEntry[]>;

  /** 检索与当前查询相关的记忆 */
  async findRelevant(query: string, entities?: ParsedEntities): Promise<MemoryEntry[]>;

  /** 将相关记忆注入 system prompt */
  injectIntoPrompt(memories: MemoryEntry[], originalPrompt: string): string;
}
```

**第一阶段实现范围**：
- 仅自动提取已确认的事实（从 `verifiable_claims` 和 `facts` 中取 `state=verified` 的记录）
- 每条记忆写入 `data/memory/facts/{slug}.md`
- 在 QA 会话开始时，注入与当前问题相关的记忆到 system prompt

---

## 八、多入口支持（Bridge 层设计思路）

### 架构解耦原则

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│  Web     │   │  CLI     │   │  API     │  ← 入口
└────┬─────┘   └────┬─────┘   └────┬─────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
            ┌───────▼───────┐
            │   Bridge 层    │
            │  (请求/响应)   │
            └───────┬───────┘
                    │
            ┌───────▼───────┐
            │   lib/ 核心    │
            │ (无 Next.js 依赖)│
            └───────────────┘
```

**当前状态**：
- `lib/rag/` 无 Next.js 依赖，可直接复用
- `lib/rag/embed.ts` 使用了 dynamic import (`@huggingface/transformers`)，在 CLI 环境可用
- `lib/ai/model.ts` 的 `getDeepSeekConfig` 依赖 `process.env`，已独立
- `lib/storage/` 仅依赖 `fs` 和 `gray-matter`

**CLI 入口示例**：
```typescript
// packages/cli/index.ts
import { routeQuerySource } from '../lib/rag/source-router';
import { retrieveRelevantChunks } from '../lib/rag/retrieve';
import { getLLM } from '../lib/ai/provider-registry';

async function main() {
  const question = process.argv.slice(2).join(' ');
  const route = await routeQuerySource(question);
  const hits = await retrieveRelevantChunks(route.retrievalPlan);
  const provider = getLLM('generation');
  const answer = await provider.chat(
    '你是一个A股投研助手...',
    [{ role: 'user', content: question }],
    { stream: false },
  );
  console.log(answer);
}
```

**Bridge 层定义**：
```typescript
// lib/bridge/types.ts
export interface BridgeRequest {
  type: 'ask' | 'search' | 'extract' | 'review' | 'profile' | 'theme' | 'research';
  payload: unknown;
  options?: {
    stream?: boolean;
    config?: Partial<ResearchConfig>;
  };
}

export interface BridgeResponse {
  type: string;
  data: unknown;
  stream?: AsyncIterable<unknown>;
}
```

---

## 九、文件结构设计

### 新增文件清单

```
lib/
├── ai/
│   ├── provider.ts                  ← [新] LLMProvider 接口定义
│   ├── provider-registry.ts         ← [新] Provider 注册表
│   ├── provider-config.ts           ← [新] 配置初始化
│   ├── providers/
│   │   ├── index.ts                 ← [新] barrel export
│   │   ├── deepseek.ts              ← [新] DeepSeekProvider 实现
│   │   └── kimi.ts                  ← [新] KimiProvider 实现
│   ├── model.ts                     ← [修] 改为调用 provider 的代理
│   ├── stream.ts                    ← [修] 改为调用 provider 的流式接口
│   ├── skills/
│   │   ├── registry.ts              ← [新] ToolRegistry 核心
│   │   ├── loader.ts                ← [新] 自动发现和加载所有技能包
│   │   ├── research/
│   │   │   ├── index.ts             ← [新] registerResearchSkills()
│   │   │   ├── search-kb.ts         ← [移] 从 research-tools.ts 拆分
│   │   │   ├── read-doc.ts          ← [移] 从 research-tools.ts 拆分
│   │   │   └── get-facts.ts         ← [移] 从 research-tools.ts 拆分
│   │   ├── review/                  ← [新] 复盘技能包（未来）
│   │   │   └── index.ts
│   │   └── crawl/                   ← [新] 采集技能包（未来）
│   │       └── index.ts
│   ├── research-tools.ts            ← [修] 向后兼容，内部改为注册方式
│   ├── research-agent.ts            ← [修] 改为使用 SimpleGraph
│   ├── extract-viewpoint.ts         ← [修] 改为通过 provider 调用
│   ├── generate-review.ts           ← [修] 同上
│   ├── generate-theme-research.ts   ← [修] 同上
│   ├── generate-stock-profile.ts    ← [修] 同上
│   └── normalize.ts                 ← [不] 保持现状
│
├── agents/
│   ├── graph.ts                     ← [新] SimpleGraph DAG 引擎
│   ├── nodes/
│   │   ├── plan-node.ts             ← [新] 规划节点
│   │   ├── research-node.ts         ← [新] 研究执行节点
│   │   ├── debate-node.ts           ← [新] 多轮辩论节点
│   │   └── synthesize-node.ts       ← [新] 综合合成节点
│   └── types.ts                     ← [新] Agent 相关类型定义
│
├── rag/
│   ├── multi-query.ts               ← [新] 多角度查询生成
│   ├── fallback-chain.ts            ← [新] 数据源降级链
│   ├── source-router.ts             ← [修] 集成 multi-query + fallback
│   ├── retrieve.ts                  ← [修] 集成 fallback chain
│   └── (其余文件不变)
│
├── memory/
│   ├── memdir.ts                    ← [新] 记忆系统（第一阶段）
│   └── types.ts                     ← [新] MemoryEntry 等类型
│
├── bridge/
│   └── types.ts                     ← [新] 多入口 Bridge 层定义
│
└── (其他现有目录不变)
```

### 修改文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `lib/ai/model.ts` | 修改 | 改为 provider 注册表的代理，保留函数签名用于向后兼容 |
| `lib/ai/stream.ts` | 修改 | 改为调用 provider 流式接口 |
| `lib/ai/research-tools.ts` | 重写 | 改为通过 ToolRegistry 注册 + 向后兼容导出 |
| `lib/ai/research-agent.ts` | 重写 | 改用 SimpleGraph + 多轮辩论 |
| `lib/ai/extract-viewpoint.ts` | 修改 | 调用 provider 代替直接 fetch |
| `lib/ai/generate-review.ts` | 修改 | 同上 |
| `lib/ai/generate-theme-research.ts` | 修改 | 同上 |
| `lib/ai/generate-stock-profile.ts` | 修改 | 同上 |
| `lib/rag/source-router.ts` | 修改 | 集成 multi-query 增强 + fallback chain |
| `lib/rag/retrieve.ts` | 修改 | 集成 fallback chain 逻辑 |

### 保持不变的文件

**约 30 个文件不受影响**：
- `lib/storage/` 全部（`paths.ts`, `md-store.ts`, `frontmatter.ts`, `index-store.ts`, `fact-store.ts`, `raw-archive.ts`, `slug.ts`, `build-index.ts`）
- `lib/rag/chunk-md.ts`, `embed.ts`, `rerank.ts`, `bm25.ts`, `format-context.ts`, `load-docs.ts`, `rebuild.ts`, `trace.ts`, `dictionary.ts`, `types.ts`
- `lib/types/` 全部
- `lib/hooks/` 全部
- `lib/crawler/` 全部
- `lib/reviews/`, `lib/stocks/`, `lib/themes/`, `lib/viewpoints/` 全部
- `lib/utils/` 全部
- `rag/` 目录所有 JSONL 文件
- `data/` 目录所有文档文件
- `app/` 目录所有页面和 API 路由（至多是 import 路径微调）

---

## 十、实施计划与验收标准

### 第一阶段（本周）—— Provider 抽象 + 数据源降级链

| 步骤 | 文件 | 工作量 | 验收 |
|------|------|--------|------|
| 1.1 定义 `LLMProvider` 接口 | `lib/ai/provider.ts` | ~40 行 | 类型检查通过 |
| 1.2 实现 `DeepSeekProvider` | `lib/ai/providers/deepseek.ts` | ~120 行 | 6 个 generate 模块测试通过 |
| 1.3 实现 `ProviderRegistry` | `lib/ai/provider-registry.ts` | ~60 行 | 注册/获取/降级逻辑正确 |
| 1.4 配置初始化 | `lib/ai/provider-config.ts` | ~50 行 | 从环境变量正确读取 |
| 1.5 修改 `model.ts` 为代理 | `lib/ai/model.ts` | ~20 行 | `callDeepSeekStructuredOutput` 行为不变 |
| 1.6 修改 `stream.ts` 为代理 | `lib/ai/stream.ts` | ~30 行 | 流式输出行为不变 |
| 1.7 落 chain 设计 | `lib/rag/fallback-chain.ts` + `retrieve.ts` | ~50 行 | 数量不足时自动降级 |
| 1.8 修改 generate-* 模块 | 4 个文件 | 各 ~5 行 | 生成结果与之前一致 |

**验收**：`npm run test` 全部通过 + 手动测试 3 个生成场景 + 1 个 RAG 检索场景

### 第二阶段（下周）—— ToolRegistry + Multi-Query

| 步骤 | 文件 | 工作量 | 验收 |
|------|------|--------|------|
| 2.1 ToolRegistry 核心 | `lib/ai/skills/registry.ts` | ~80 行 | 注册/获取/hook 链正确 |
| 2.2 拆分 3 个研究工具 | `lib/ai/skills/research/*` | 每个 ~30 行 | 功能与之前一致 |
| 2.3 向后兼容层 | `lib/ai/research-tools.ts` | ~15 行 | research-agent 不报错 |
| 2.4 Multi-Query 增强 | `lib/rag/multi-query.ts` | ~60 行 | 新检索公式覆盖更多角度 |
| 2.5 Source Router 集成 | `lib/rag/source-router.ts` | ~20 行 | 意图识别正确触发 multi-angle |

**验收**：`npm run test` 通过 + RAG 检索覆盖率不变或提升

### 第三阶段（第三周）—— 多轮辩论 + SimpleGraph

| 步骤 | 文件 | 工作量 | 验收 |
|------|------|--------|------|
| 3.1 SimpleGraph 引擎 | `lib/agents/graph.ts` | ~80 行 | 拓扑排序 + DAG 执行 |
| 3.2 4 个 Agent 节点 | `lib/agents/nodes/*` | 各 ~50 行 | 节点可独立测试 |
| 3.3 多轮 DebateNode | `lib/agents/nodes/debate-node.ts` | ~100 行 | 较深研究结论质量提升 |
| 3.4 重写 research-agent | `lib/ai/research-agent.ts` | ~60 行 | API 兼容，输出格式不变 |

**验收**：`/api/ai/research` 端点可用，深度研究启用多轮辩论

### 第四阶段（第四周）—— Memory + CLI 入口

| 步骤 | 文件 | 工作量 | 验收 |
|------|------|--------|------|
| 4.1 Memdir 基础 | `lib/memory/memdir.ts` | ~100 行 | 从 QA 会话提取可验证事实 |
| 4.2 Memory 注入 | <同上> | ~40 行 | QA 回答能引用历史事实 |
| 4.3 CLI 原型 | `packages/cli/index.ts` | ~50 行 | `npx trading-wiki ask` 可用 |

**验收**：CLI 可完成一轮问答 + Memory 在第二次问答中生效

---

## 十一、Api 兼容性保证

所有新设计确保以下 API 端点行为不变：

| 端点 | 保证 |
|------|------|
| `POST /api/ai/extract-viewpoint` | 返回 schema 不变 |
| `POST /api/ai/generate-review` | 字段和格式不变 |
| `POST /api/ai/generate-theme-research` | 同上 |
| `POST /api/ai/generate-stock-profile` | 同上 |
| `POST /api/ai/research` | AgentEvent 事件类型不变 |
| `POST /api/ai/stream` | StreamChunk 格式不变 |
| `POST /api/rag/search` | 检索结果格式不变 |
| `GET /api/rag/traces` | Trace 结构不变 |

唯一可能新增的是 `POST /api/ai/ask` 的回答中会多出 `memory_sourced` 字段（第三阶段后），但该字段为可选，不破坏现有解析。

---

## 十二、设计决策说明

### 为什么不用 LangGraph

1. LangGraph 的完整 SDK 体积 ~200KB+，与 `trading-wiki` 定位冲突
2. 当前 Agent 拓扑简单（线性 + 一个条件分支），80 行 SimpleGraph 完全够用
3. LangGraph 对 Next.js App Router 的兼容性不确定

### 为什么 Provider 注册表而非工厂模式

1. 注册表允许运行时动态添加 Provider（未来用户本地模型场景）
2. 注册表天然支持降级链查询（按任务类型找最优而非硬编码）
3. 方便单元测试：测试时注册 mock provider 即可

### 为什么 ToolRegistry 和 Provider 分开

1. 职责不同：Provider 管「谁做」，ToolRegistry 管「做什么」
2. 生命周期不同：Provider 全局单例，ToolRegistry 可创建多个 instance（每个 Agent session 一个）
3. 未来可各自独立演进（如工具数量增长不影响 Provider 抽象）

### 为什么 Memory 系统放在第三阶段

1. 记忆质量高度依赖 LLM 提取能力，第一阶段 Provider 抽象是前提
2. 需要 ToolRegistry 的 beforeCall/afterCall 钩子来注入 memory 侧写的检索
3. 过早引入记忆系统可能导致「提取噪声 → 注入垃圾 → 回答降级」的恶性循环
