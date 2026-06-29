# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 项目概述

A 股个人投研助理 —— 一个本地优先的 A 股投研辅助系统。所有数据以本地 Markdown 文件（YAML frontmatter）存储，不使用数据库。通过 DeepSeek 大模型进行 AI 生成（观点蒸馏、每日复盘、产业链研究、个股档案）。自研本地 RAG 系统，默认使用 Xenova/bge-small-zh-v1.5 语义嵌入模型，回退到多分辨率特征哈希。

系统包含 8 种文档类型：`material`（原始素材）、`daily_review`（每日复盘）、`viewpoint`（观点蒸馏）、`theme_research`（产业链研究）、`stock_profile`（个股档案）、`note`（个人笔记）、`raw`（原始资料归档）、`qa`（知识库问答）。

核心子系统：**素材库（Material）**——不可变原始证据层；**可验证断言（Facts）**——多窗口验证管线；**知识库问答（QA）**——多轮对话 + RAG 检索 + 六段式回答；**雪球采集**——Playwright 自动化抓取。

## 常用命令

```bash
npm run dev          # 启动 Next.js 开发服务器 http://localhost:3000
npm run build        # 生产构建
npm run test         # 运行全部 Vitest 测试
npm run eval         # RAG 检索质量评测
npm run rag          # 全量重建 RAG 索引
npm run build-index  # 重建 data/index.json
npm run seed         # 填充样本数据
npm run lint         # ESLint 检查
```

## 架构

Next.js 15 App Router 项目，六层横向分层：

```
页面层（app/**/page.tsx）              → 服务端组件取数据、客户端组件管交互
API 路由层（app/api/**/route.ts）      → Zod 入参校验，编排 AI / Agent / RAG
Agent 编排层（lib/ai/ + lib/agents/）  → ResearchAgent (三阶段) + SimpleGraph DAG
业务逻辑层（lib/**/*.ts）              → AI 调用、RAG 检索、ToolRegistry、Provider
基础设施层（lib/ai/providers/）        → LLM Provider 接口 + 统一抽象
数据存储层（data/ + rag/）             → 本地文件：Markdown、JSONL、JSON
```

### 存储层（`lib/storage/`）

所有文档以 Markdown 文件存储在 `data/` 下，文件头包含 YAML frontmatter。`data/index.json` 是轻量索引。

- **`paths.ts`** — 目录常量，含 `DATA_DIR` 和 `DATA_DIRECTORIES`、`RAG_FILES`
- **`frontmatter.ts`** — `parseFrontmatter()` / `stringifyFrontmatter()`，基于 `gray-matter`
- **`md-store.ts`** — Markdown 文档读写：`listMarkdownDocuments()`, `readMarkdownDocument()`, `writeMarkdownDocument()`
- **`index-store.ts`** — `data/index.json` 读写
- **`build-index.ts`** — 全量重建索引
- **`fact-store.ts`** — 断言 CRUD（JSONL 存储）
- **`raw-archive.ts`** — 原始输入不可变快照
- **`slug.ts`** — 中文友好 slug 生成

### AI 层（`lib/ai/`）

#### Provider 抽象层
- **`provider.ts`** — `LLMProvider` 接口（chat / structuredOutput / streamChat）
- **`provider-registry.ts`** — `ProviderRegistry` + 全局单例，按任务类型路由（generation / structured / vision / stream）
- **`providers/deepseek.ts`** — `DeepSeekProvider`（JSON mode + SSE 流式）
- **`providers/kimi.ts`** — `KimiProvider`（vision 场景 + 手动 JSON 解析）
- **`model.ts`** — 向后兼容：`callDeepSeekStructuredOutput<T>()` 内部调用 Provider，函数签名不变

#### Agent 工具系统
- **`skills/types.ts`** — `SkillTool` 接口（name / description / inputSchema / execute）
- **`skills/registry.ts`** — `ToolRegistry`：注册、条件激活、生命周期钩子、Vercel AI SDK 转换
- **`skills/research/index.ts`** — 3 个研究工具（search_knowledge_base / read_document / get_facts）

#### 传统 AI 模块
- **`prompts.ts`** — 所有 system/user prompt 构造器（4 个模块各一对）
- **`normalize.ts`** — AI 输出归一化
- **`stream.ts`** — SSE 流式工具
- **`extract-viewpoint.ts`**, **`generate-review.ts`**, **`generate-stock-profile.ts`** — 各模块的 AI 调用封装
- **`generate-theme-research.ts`** — 产业链研究 AI 调用

### RAG 层（`lib/rag/`）

完整管线：意图识别 → 实体提取 → 检索计划 → 混合检索 → Rerank → MMR → LLM

**新增：**
- **`bm25.ts`** — BM25 中文分词+关键词评分（词典正向最大匹配）
- **`multi-query.ts`** — 多角度查询生成（基本面/技术面/产业链）
- **`fallback-chain.ts`** — 数据源降级链（primary → fallback → lastResort）

**Rerank**（`rerank.ts`）：优先本地 cross-encoder（onnx-community/bge-reranker-v2-m3），回退 DeepSeek API。LRU 缓存（200 条，60s TTL），候选集 30 个（可配）。

**分块**（`chunk-md.ts`）：
- 按 `##` 标题切分，headingPath 保留结构
- 段落贪心合并到 300-500 字，接缝处 50 字重叠
- 超长段落在句尾（。！？）断开
- 过滤无意义内容（"资料不足"、短文本无中文等）

**嵌入**（`embed.ts`）：
- 首选：`Xenova/bge-small-zh-v1.5`（~33MB，ONNX，CPU 运行）
- 回退：多分辨率特征哈希（FNV-1a 哈希，512 维，IDF 加权）
- query 时加前缀 `"为这个句子生成表示以用于检索相关文章："`
- 输出均值池化 + L2 归一化的 512 维向量

**意图识别**（`source-router.ts`）：
- 双层架构：LLM 优先（3s 超时）→ 正则评分回退
- 9 种意图：`recency / verification / chain / stock_deep / market_review / value_analysis / policy_impact / risk_alert / general`
- 正则评分制：每个意图独立算分（关键词长度加权 + 密集度加成）
- 高置信度（2x 领先）跳过 LLM，零延迟
- 输出 `RetrievalPlan`：`{ targetDocTypes, filters, topK, answerMode }`

**检索**（`retrieve.ts`）：
- 每日志评分公式：`vectorScore×w.v + keywordScore×w.k + metadataScore×w.m + freshnessScore×w.f`
- 每种意图有独立的权重配比（如 stock_deep 强调 vector，recency 强调 freshness）
- Multi-Query 扩展：多条查询分别检索后合并去重取最大分
- MMR 多样性重排（λ=0.7）

**Rerank**（`rerank.ts`）：DeepSeek 对 top30 候选打分 (0-10)，按分降序取 top8

**索引管理**（`rebuild.ts`）：
- `rebuildRagIndex()` — 全量重建
- `upsertRagDocument()` — 编辑文档时增量更新
- `removeRagDocument()` — 删除文档时清除
- embedding 分批处理（每批 5 个）避免 OOM

**调试**（`trace.ts` / `dictionary.ts`）：
- 每次问答写检索 trace 到 `data/rag-traces/traces.jsonl`
- 实体词典从 `data/index.json` 自动构建（股票名→代码+主题映射）

### 文档类型（`lib/types/`）

```typescript
DocumentType = 'daily_review' | 'viewpoint' | 'theme_research' | 'stock_profile'
             | 'note' | 'raw' | 'qa' | 'material'
```

核心接口：
- `DocumentFrontmatter` — 所有文档共享的 frontmatter 字段
- `DocumentIndexItem` — 索引项（id, type, title, path, date, themes, stocks, tags, summary）
- `SourcedItem` — 带来源标注的结构化条目（source: original|opinion|inferred|market|rag|personal|unknown）
- `VerifiableClaim` — 可验证声明（claim, verify_by, suggested_window）

### Agent 编排层（`lib/agents/`）

- **`graph.ts`** — `SimpleGraph` DAG 引擎（拓扑排序 + 并行执行 + 死锁检测）
- **`run.ts`** — 编排辅助函数（`runResearchGraph` / `runDebateAndSynthesis`）
- **`nodes/plan-node.ts`** — `planNode`：LLM 拆解研究问题 → { title, subQuestions }（含 few-shot 示例，temperature=0.2）
- **`nodes/research-node.ts`** — `researchNode`：占位节点
- **`nodes/debate-node.ts`** — `createDebateNode()`：多轮 Bull↔Bear 对抗辩论 + Neutral 综合（Bull/Bear temperature=0.7, Neutral=0.5, 要求引用数据, 输出共识/分歧）
- **`nodes/synthesize-node.ts`** — `synthesizeNode`：合并报告 + 辩论 → 综合报告（含「多空共识与分歧」章节）

### Agent 调试（`lib/agent-debug/`）

- **`types.ts`** — `AgentRun` / `AgentStep` / `AgentError` / `AgentFeedback` 类型
- **`run-recorder.ts`** — `RunRecorder`：事件记录 + step 管理 + JSONL 持久化 + 错误分类
  - 数据存储：`data/agent-traces/runs.jsonl` + `events/{runId}.jsonl` + `feedback.jsonl`

### 其他库目录

- **`lib/crawler/xueqiu/`** — 雪球爬虫（Playwright 浏览器管理、DOM 抓取、去重存储）
- **`lib/hooks/use-stream-ai.ts`** — SSE 流式 AI 调用的 React Hook
- **`lib/utils/`** — 通用工具（`display.ts`, `markdown.ts`, `strings.ts`）
- **`lib/server/documents.ts`** — 服务端文档工具
- **`lib/reviews/markdown.ts`**, **`lib/stocks/markdown.ts`**, **`lib/themes/markdown.ts`**, **`lib/viewpoints/markdown.ts`** — 各文档类型的 Markdown 渲染

### 测试（`tests/`）

按模块分目录，与 `lib/` 结构对齐：

```text
tests/
├── ai/          model.test.ts, normalize.test.ts, review-markdown.test.ts, viewpoint-markdown.test.ts, viewpoint-schema.test.ts
├── rag/         chunk-md.test.ts, bm25.test.ts, bm25-integration.test.ts, intent-classification.test.ts, retrieve.test.ts, source-router.test.ts
├── storage/     build-index.test.ts, frontmatter.test.ts, md-store.test.ts
├── utils/       markdown.test.ts
└── fixtures/    intent-cases.json
```

### 脚本（`scripts/`）

| 文件 | 用途 |
|------|------|
| `build-index.ts` | 重建 `data/index.json` |
| `build-rag-index.ts` | 全量重建 RAG 索引 |
| `eval-rag.ts` | RAG 检索评估（支持 `--no-rerank`、`--no-mmr`） |
| `seed-sample-data.ts` | 种子样本数据 |
| `download-reranker-model.sh` | 下载本地 cross-encoder 模型（~544MB） |

### 配置（`config/`）

- `config/xueqiu-watchlist.json` — 雪球关注列表（用户 ID、每用户最大帖子数）

### 文档（`docs/`）

- `docs/Trading Review Wiki 业务设计分析.md` — 业务设计分析
- `docs/竞品分析与优化方案.md` — 竞品分析与优化方案

### 雪球采集（`lib/crawler/xueqiu/`）

通过 Playwright 调用系统 Chrome，持久化登录态。

- **`browser.ts`** — 单例浏览器管理
- **`scraper.ts`** — 用户主页帖子抓取 + 无限滚动 + DOM 提取 + 原发过滤
- **`raw-store.ts`** — 写入 `data/raw/xueqiu/{userId}/{postId}.md` + 游标去重
- **`config.ts`** — 读取 `config/xueqiu-watchlist.json`

### API 端点总览

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/documents` | POST/PUT/DELETE | 文档 CRUD（8 种类型） |
| `/api/facts` | GET/POST/PUT/DELETE | 断言 CRUD |
| `/api/ai/ask` | POST | 知识库问答（SSE 流式） |
| `/api/ai/stream` | POST | 通用 SSE 流式调用 |
| `/api/ai/extract-viewpoint` | POST | 观点蒸馏 |
| `/api/ai/extract-material` | POST | 素材提取 |
| `/api/ai/generate-review` | POST | 每日复盘 |
| `/api/ai/generate-theme-research` | POST | 产业链研究 |
| `/api/ai/generate-stock-profile` | POST | 个股档案 |
| `/api/ai/research` | POST | Research Agent 深度研究（SSE 流式） |
| `/api/upload` | POST | PDF/图片文字提取 |
| `/api/qa` | GET | QA 历史线程列表 |
| `/api/crawler/xueqiu/config` | GET | 雪球采集配置 |
| `/api/crawler/xueqiu/fetch` | POST | 雪球帖子抓取 |
| `/api/crawler/xueqiu/posts` | GET | 已抓取的雪球帖子 |
| `/api/rag/search` | POST | RAG 检索调试 |
| `/api/rag/stats` | GET | RAG 索引健康检查 |
| `/api/rag/traces` | GET | 检索 trace 查询 |
| `/api/rag/chunks` | GET | Chunk 详情 |
| `/api/rag/preview-context` | POST | Prompt 上下文预览 |
| `/api/rag/debug-answer` | POST | 答案追溯（带引用标注） |
| `/api/rag/eval-history` | GET | RAG 评估历史 |
| `/api/agent-debug/runs` | GET | Agent 运行列表 |
| `/api/agent-debug/runs/[runId]` | GET | Agent 运行详情 |
| `/api/agent-debug/feedback` | POST | Agent 反馈提交 |

### 组件层（`components/`）

客户端 React 组件，按功能模块分目录：

- **`layout/`** — 应用布局壳（`app-shell.tsx`）
- **`documents/`** — 通用文档 UI（编辑器、列表、上传、Markdown 预览、文件上传、关联文档等）
- **`viewpoints/`**, **`reviews/`**, **`themes/`**, **`stocks/`** — 各功能模块的工作台组件
- **`facts/`** — 可验证断言工作台
- **`rag/`** — RAG 调试工作台
- **`research/`** — Research Agent 工作台（研究配置 + Agent 过程可视化 + 辩论展示）
- **`crawler/xueqiu/`** — 雪球采集工作台
- **`thinking-panel.tsx`** — AI 思考过程展示面板

### 页面入口

- `/dashboard` — 仪表盘
- `/ask` — 知识库问答
- `/materials` — 素材库
- `/materials/new` — 新建素材
- `/viewpoints` / `/viewpoints/new` / `/viewpoints/[id]` — 观点蒸馏
- `/reviews` / `/reviews/new` / `/reviews/[id]` — 每日复盘
- `/themes` / `/themes/new` / `/themes/[id]` — 产业链研究
- `/stocks` / `/stocks/new` / `/stocks/[id]` — 个股档案
- `/notes` / `/notes/new` / `/notes/[id]` — 个人笔记
- `/facts` — 可验证断言
- `/search` — 知识库搜索
- `/rag-debug` — RAG 调试（检索/追踪/答案追溯）
- `/research` — 深度研究（Research Agent）
- `/agent-debug` — Agent 调试（执行链路追踪）
- `/authors` — 作者/来源管理
- `/crawler/xueqiu` — 雪球采集

## RAG 管线详解

```text
用户提问
  ↓
① 意图识别（source-router.ts）
   LLM 分类 / 正则评分 → intent + weights + retrievalPlan
  ↓
② 实体提取（dictionary.ts）
   本地词典匹配 → stocks / themes 识别
  ↓
③ 检索（retrieve.ts）
   embedText(query) → 混合评分(向量+关键词+元数据+时效) → top30
   可选：Multi-Query 扩展 → 合并去重
  ↓
④ Rerank（rerank.ts）
   DeepSeek 对 top30 打分 → 重排序
  ↓
⑤ MMR（retrieve.ts）
   λ=0.7 多样化 → topK
  ↓
⑥ 注入 LLM → 六段式回答
```

## 评测

```bash
npm run eval                    # 完整评测
npm run eval -- --no-rerank     # 关闭 rerank 对比
npm run eval -- --no-mmr        # 关闭 MMR 对比
```

评测指标：HitRate@5 / HitRate@10 / MRR
测试集：`data/rag-eval/queries.jsonl`（26 条带标注查询）

## 调试

`/rag-debug` 页面提供：
- **单次检索**：检索参数→评分明细→Chunk 详情→Context 预览→索引健康
- **检索 Trace**：生产环境问答的完整链路记录
- **答案追溯**：生成带引用标注的答案，检测无支撑结论

## 重要约束

- 不使用数据库、ORM、Redis、向量数据库
- Vercel AI SDK 工具上下文中 Array 原型方法不可用，工具实现需使用数组字面量和 String 操作
- DeepSeek 通过 @ai-sdk/openai-compatible 对接，工具调用使用 streamText + maxSteps
- 所有 AI 生成内容必须允许用户人工编辑后再保存
- 禁止编造行情数据、财务数据、新闻
- prompt 和输出中必须区分事实、观点、推理
- 不输出确定性买卖建议，不承诺收益
- DeepSeek API Key 存储在 `.env.local`
- Q&A 回答必须遵循六段式格式
- 素材（material）创建后不可编辑
- 雪球采集的帖子先存原始存档，用户审核后再调 AI 提取
- embedding 模型文件在 `models/Xenova/bge-small-zh-v1.5/`，首次运行自动下载
