
# A 股个人投研助理

本地优先的 A 股投研辅助系统。通过 DeepSeek 大模型 + 本地 RAG 知识库，辅助进行观点蒸馏、产业链研究、每日复盘和个股分析。

**不是自动交易系统，不提供买卖建议，不承诺收益。**

---

## 功能

- **观点蒸馏** — 粘贴关注人发言，AI 提取结构化观点（事实/推理/风险/可验证声明）
- **产业链研究** — 输入主题资料，AI 生成价值链全图、证据表、评分卡、证伪条件
- **个股档案** — 输入公司资料和公告，AI 生成结构化研报
- **每日复盘** — 按固定框架生成 A 股复盘，支持 RAG 检索历史资料
- **知识库问答** — 多轮对话 + RAG 检索 + 六段式回答（结论/证据链/分歧/验证/交易含义/来源）
- **可验证断言** — AI 自动提取可验证声明，多窗口追踪判断准确性
- **雪球采集** — 通过 Playwright 自动抓取关注用户的雪球帖子，审核后提取观点
- **本地 RAG** — BGE 语义嵌入模型 + 混合评分检索 + Multi-Query + MMR + Rerank
- **文件上传** — PDF 和图片文字提取（Kimi Vision API + Moonshot OCR）

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Next.js 15 (App Router) + React 19 |
| 语言 | TypeScript |
| 存储 | 本地 Markdown (YAML frontmatter) + JSONL |
| AI 生成 | DeepSeek API（流式 + 结构化输出 + JSON mode） |
| AI 视觉 | Kimi k2.6 API（图片/PDF 分析） |
| 嵌入 | Xenova/bge-small-zh-v1.5（本地 CPU，ONNX）|
| Rerank | 本地 cross-encoder（onnx-community/bge-reranker-v2-m3-ONNX）→ DeepSeek API 回退 |
| 爬虫 | Playwright + 系统 Chrome |
| 校验 | Zod |
| UI | 纯 CSS（无 UI 框架）+ Lucide 图标 |

## 架构

```
页面层 (app/**/page.tsx)        → 服务端组件取数据、客户端组件管交互
API 路由层 (app/api/**/route.ts) → Zod 校验，编排 AI/存储/RAG
业务逻辑层 (lib/**/*.ts)         → 纯函数：AI 调用、RAG 检索、Markdown 读写
数据存储层 (data/ + rag/)        → 本地文件：Markdown、JSONL、JSON
```

### RAG 管线

```
用户提问
  ↓
意图识别 (LLM/正则评分) → 实体提取 → 检索计划
  ↓
Multi-Query 扩展（可选）
  ↓
混合检索: 向量×权重 + 关键词 + 元数据 + 时效
  ↓
Rerank (DeepSeek 打分)
  ↓
MMR 多样化 (λ=0.7)
  ↓
注入 LLM → 六段式回答
```

## 快速开始

### 环境变量

创建 `.env.local`：

```bash
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
MOONSHOT_API_KEY=your-kimi-api-key    # 仅文件上传需要
MOONSHOT_VISION_MODEL=kimi-k2.6
```

### 安装和启动

```bash
npm install
npm run build-index    # 扫描 data/ 生成文档索引
npm run rag            # 全量构建 RAG 索引
npm run dev            # http://localhost:3000
```

### BGE 嵌入模型

RAG 使用 `Xenova/bge-small-zh-v1.5` 作为嵌入模型（~33MB，ONNX 格式）。

- 首次运行 `npm run rag` 时自动从 HuggingFace 下载
- 国内镜像：`HF_ENDPOINT=https://hf-mirror.com npm run rag`
- 模型文件缓存到 `models/Xenova/bge-small-zh-v1.5/`

### Cross-encoder 重排序模型（可选，推荐）

Rerank 优先使用本地 cross-encoder 模型（`onnx-community/bge-reranker-v2-m3-ONNX`），无可用时自动回退到 DeepSeek API。

```bash
# 方式一：下载脚本（推荐）
bash scripts/download-reranker-model.sh

# 方式二：指定国内镜像
HF_ENDPOINT=https://hf-mirror.com bash scripts/download-reranker-model.sh
```

- 模型大小：~544MB（quantized ONNX）
- 下载后重启 dev server 即可生效，控制台输出 `[rerank] 本地 cross-encoder 加载成功` 确认
- 生效后 Rerank 从 API 调用（~2s/次）降为本地推理（~100ms/次）

### 雪球采集

1. 编辑 `config/xueqiu-watchlist.json` 填入关注的雪球用户 ID
2. 确保已安装 Playwright 依赖
3. 打开 `/crawler/xueqiu` 页面
4. 首次使用：点击「抓取最新帖子」，在打开的 Chrome 窗口中登录雪球
5. 勾选帖子 → 点击「AI 提取选中」→ 自动生成观点文档

> Playwright 调用系统已安装的 Chrome，登录态持久化保存在 `.runtime/browser/xueqiu/`。

## 目录结构

```
first-agent/
├── app/                        # Next.js App Router
│   ├── api/ai/                 # AI 生成端点 (ask/stream/extract/generate)
│   ├── api/documents/          # 文档 CRUD
│   ├── api/rag/                # RAG 调试 (search/stats/chunks/traces/preview-context/debug-answer)
│   ├── api/upload/             # 文件上传
│   ├── ask/                    # 知识库问答页面
│   ├── dashboard/              # 仪表盘
│   ├── rag-debug/              # RAG 调试页面
│   ├── themes/stocks/notes/... # 各文档类型的列表/详情/编辑页
│   └── crawler/xueqiu/         # 雪球采集页面
├── components/                 # React 客户端组件
│   ├── documents/              # 通用文档组件
│   ├── themes/                 # 主题研究工作台
│   ├── stocks/                 # 个股档案工作台
│   └── rag/                    # RAG 调试组件
├── lib/
│   ├── ai/                     # AI 调用 + prompts + normalize
│   ├── rag/                    # 完整 RAG 管线
│   │   ├── chunk-md.ts         # 文档分块
│   │   ├── embed.ts            # BGE 嵌入 + 哈希回退
│   │   ├── retrieve.ts         # 混合检索 + MMR
│   │   ├── rerank.ts           # DeepSeek 重排序
│   │   ├── source-router.ts    # 意图识别 + 检索计划
│   │   ├── dictionary.ts       # 本地实体词典
│   │   ├── rebuild.ts          # 索引管理
│   │   ├── trace.ts            # 检索链路追踪
│   │   └── types.ts            # RAG 类型定义
│   ├── storage/                # 文件存储
│   ├── types/                  # 文档类型定义
│   └── utils/                  # Markdown 渲染、显示工具
├── data/                       # 本地数据
│   ├── materials/              # 原始素材（不可变）
│   ├── viewpoints/             # 观点蒸馏
│   ├── daily-reviews/          # 每日复盘
│   ├── themes/                 # 产业链研究
│   ├── stocks/                 # 个股档案
│   ├── notes/                  # 个人笔记
│   ├── raw/                    # 原始资料（雪球帖子等）
│   ├── qa/                     # 问答历史
│   ├── facts/                  # 可验证断言
│   └── index.json              # 文档索引
├── rag/                        # RAG 索引
│   ├── chunks.jsonl            # 文本块
│   ├── embeddings.jsonl        # 512 维向量
│   └── index-meta.json         # 索引元数据
├── scripts/                    # 命令行工具
│   ├── build-rag-index.ts      # 全量重建 RAG
│   ├── build-index.ts          # 重建文档索引
│   └── eval-rag.ts             # RAG 检索评测
├── tests/                      # Vitest 测试
├── config/                     # 配置文件
└── models/                     # 本地模型文件
```

## 数据存储

### 文档类型

| 类型 | 目录 | 说明 | 可编辑 |
|------|------|------|--------|
| `material` | `data/materials/` | 原始素材（公告/新闻/研报） | ❌ 不可变 |
| `viewpoint` | `data/viewpoints/` | 观点蒸馏 | ✅ |
| `daily_review` | `data/daily-reviews/` | 每日复盘 | ✅ |
| `theme_research` | `data/themes/` | 产业链研究 | ✅ |
| `stock_profile` | `data/stocks/` | 个股档案 | ✅ |
| `note` | `data/notes/` | 个人笔记 | ✅ |
| `raw` | `data/raw/` | 原始资料归档（雪球帖子等） | ❌ 只读 |
| `qa` | `data/qa/` | 问答历史线程 | ❌ 只读 |

### 证据强度

- **A 级** — 公告/财报/监管文件
- **B 级** — 券商研报/公司 IR/可靠调研
- **C 级** — 专家会议/媒体报道/纪要
- **D 级** — 群聊/传闻/未确认

## 开发命令

```bash
npm run dev          # 开发服务器 (localhost:3000)
npm run build        # 生产构建
npm run test         # 运行测试
npm run lint         # ESLint 检查
npm run build-index  # 重建 data/index.json
npm run rag          # 全量重建 RAG 索引
npm run eval         # RAG 检索评测
npm run eval -- --no-rerank  # 对比评测：关闭 rerank
npm run eval -- --no-mmr     # 对比评测：关闭 MMR
```

### RAG 评测

`npm run eval` 对 26 条标注查询运行完整检索管线，输出 HitRate@5 / HitRate@10 / MRR，并按意图类别分类统计。测试集在 `data/rag-eval/queries.jsonl`，评测结果追加到 `data/rag-eval/results.jsonl`。

### RAG 调试

打开 `/rag-debug` 页面：

- **单次检索** — 输入 query，查看评分明细、Chunk 详情、Prompt 上下文预览、索引健康状态
- **检索 Trace** — 查看生产环境每次问答的完整检索链路（意图/改写/评分/rerank/MMR）
- **答案追溯** — 生成带引用标注的回答，检测无资料支撑的结论

## 项目约束

- 不使用数据库、ORM、Redis、向量数据库
- 所有 AI 生成内容必须允许用户人工编辑后再保存
- 禁止编造行情数据、财务数据、新闻
- prompt 和输出中必须区分事实、观点、推理
- 不输出确定性买卖建议，不承诺收益
- Q&A 回答必须遵循六段式格式
- 素材（material）创建后不可编辑
- 雪球采集的帖子先存原始存档，用户审核后再调 AI 提取

## 许可证

MIT
