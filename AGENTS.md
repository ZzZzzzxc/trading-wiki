# Repository Guidelines

## 项目结构与模块组织

本仓库是本地优先的 A 股投研助理，基于 Next.js 15 App Router、React 19 和 TypeScript。页面与 API 路由放在 `app/`，客户端组件放在 `components/`，核心业务逻辑放在 `lib/`。保持四层分工清晰：`app/**/page.tsx` 负责页面，`app/api/**/route.ts` 负责 Zod 校验与编排，`lib/**/*.ts` 负责 AI、RAG、Markdown 与存储逻辑，`data/` 与 `rag/` 负责本地文件数据和索引。

重点目录：`lib/ai/` 存放 DeepSeek/Kimi 调用与 prompt，`lib/rag/` 存放分块、嵌入、检索、rerank、MMR 和 trace，`lib/storage/` 存放 Markdown/JSONL 读写，`lib/crawler/xueqiu/` 存放雪球采集逻辑。8 类文档为 `material`、`daily_review`、`viewpoint`、`theme_research`、`stock_profile`、`note`、`raw`、`qa`。

## 构建、测试与开发命令

- `npm run dev`：启动开发服务器，默认 `http://localhost:3000`。
- `npm run build` / `npm run start`：生产构建与启动。
- `npm run lint`：运行 Next.js ESLint 检查。
- `npm run test`：运行全部 Vitest 测试。
- `npm run build-index`：从 `data/` 重建 `data/index.json`。
- `npm run rag`：全量重建 RAG chunks 与 embeddings。
- `npm run eval`：使用 `data/rag-eval/queries.jsonl` 评测 RAG；可加 `-- --no-rerank` 或 `-- --no-mmr`。
- `npm run seed`：写入样本数据。

## 编码风格与命名约定

使用 TypeScript ESM 与 `@/` 根路径别名。沿用现有风格：2 空格缩进、单引号、分号、共享工具优先使用具名导出。React 组件使用 PascalCase；Next.js 文件遵循 `page.tsx`、`layout.tsx`、`route.ts`。领域 Markdown 渲染与解析应放在 `lib/reviews/markdown.ts`、`lib/stocks/markdown.ts`、`lib/themes/markdown.ts` 等专门模块，避免在 UI 中重复拼字符串。

## 测试指南

Vitest 配置在 `vitest.config.ts`，只匹配 `tests/**/*.test.ts`，运行环境为 Node。测试目录按模块对齐：`tests/ai/`、`tests/rag/`、`tests/storage/`、`tests/utils/`，复用输入放在 `tests/fixtures/`。修改 RAG 检索、Markdown 序列化、frontmatter、AI 输出归一化或存储逻辑时，必须补充或更新对应测试，并运行 `npm run test`。

## 数据、AI 与 RAG 约束

不要引入数据库、ORM、Redis 或向量数据库；本项目约束是 Markdown、JSONL、JSON 本地存储。`material` 和 `raw` 是原始证据层，创建后应保持不可变；雪球帖子先写入原始归档，用户审核后再调用 AI 提取。所有 AI 生成内容必须允许人工编辑后保存，并明确区分事实、观点、推理、风险和来源。禁止编造行情、财务数据或新闻；不要输出确定性买卖建议或收益承诺。Q&A 回答必须遵循六段式格式。

## 安全与配置

密钥只放在 `.env.local`，`.env.example` 只保留占位示例。DeepSeek 用于文本生成，Kimi 用于图片/PDF 分析；本地嵌入模型缓存位于 `models/Xenova/bge-small-zh-v1.5/`，首次运行会下载。不要提交私钥、浏览器登录态、模型缓存或运行时临时文件。

## 提交与 PR 规范

历史提交使用简短主题，已有 `feat: init A股个人投研助理系统` 这类 Conventional Commit 风格；新提交优先使用 `feat:`、`fix:`、`test:`、`chore:`。PR 需说明用户可见变化、列出验证命令、标明是否重建 `data/index.json` 或 `rag/`，UI 变更附截图，涉及投研输出的变更说明数据来源和证伪边界。
