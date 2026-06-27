import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { getDeepSeekConfig } from '@/lib/ai/model';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';
import { routeQuerySource } from '@/lib/rag/source-router';
import { getDocumentTypeLabel } from '@/lib/utils/display';
import { DATA_DIR } from '@/lib/storage/paths';
import { slugify } from '@/lib/storage/slug';
import { buildLocalDocumentIndex } from '@/lib/storage/build-index';
import { upsertRagDocument } from '@/lib/rag/rebuild';
import { readMarkdownDocument } from '@/lib/storage/md-store';
import type { TraceCandidate } from '@/lib/rag/trace';

const QA_DIR = path.join(DATA_DIR, 'qa');

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const requestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  topK: z.coerce.number().min(1).max(20).default(8),
  /** 会话线程 ID，传入则追加到已有会话 */
  threadId: z.string().optional(),
});

const SYSTEM_PROMPT = `你是 A 股个人投研知识库助手。你的回答必须严格按照以下六段式结构组织：

---
## 结论
（直接回答用户问题，1-3 句话概括核心判断）

## 证据链
（每个结论对应哪个来源的哪条证据，如 [1] 京东方公告、[3] 半导体设备产业链研究。**必须引用编号**）

## 分歧与反证
（有没有相反的证据或观点？知识库中是否存在矛盾信息？如果没有明确反证，写「当前知识库中未发现明确反证」）

## 后续验证
（什么条件、事件或数据出现时，上述结论需要修正？给出具体可观测的验证条件）

## 交易含义
（对投资决策的实际影响——不是买卖建议，而是信息对理解市场/行业/个股的增量价值）

## 引用来源
（完整列出所有引用的来源：[编号] 文档标题 · 文档类型 · 章节）

---

基础要求：
- 基于参考资料，不编造事实
- 区分事实和推断，推断必须标注「推断」
- 资料不足时在相应段落明确说明
- 不提供确定性买卖建议，不承诺收益
- 如果用户追问，结合对话历史理解上下文`;

/** 解析已有的对话线程文件，返回轮次数 */
function parseThreadRounds(content: string): number {
  const matches = content.match(/## 第 (\d+) 轮/g);
  if (!matches?.length) return 0;
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, '')));
  return Math.max(...nums);
}

export async function POST(request: Request) {
  try {
    const { messages, topK, threadId } = requestSchema.parse(await request.json());

    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const question = lastUserMsg?.content || '';

    // RAG 检索 + 源路由
    const route = await routeQuerySource(question);
    const searchQuery = route.rewrittenQuery || question;
    const traceId = `rag_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const rp = route.retrievalPlan;
    const hits = await retrieveRelevantChunks({
      query: searchQuery,
      topK: rp.topK,
      traceId,
      originalQuery: question,
      rewrittenQuery: route.rewrittenQuery,
      expandedQueries: route.expandedQueries,
      intent: route.intent,
      routeMethod: route.method,
      intentScores: route.intentScores,
      docTypes: rp.targetDocTypes.length > 0 ? rp.targetDocTypes : undefined,
      stocks: rp.filters.stocks?.length ? rp.filters.stocks : undefined,
      themes: rp.filters.themes?.length ? rp.filters.themes : undefined,
      dateFrom: rp.filters.dateFrom,
      dateTo: rp.filters.dateTo,
      sourceBoosts: Object.keys(route.docTypeBoosts).length > 0
        ? route.docTypeBoosts
        : undefined,
      weights: route.weights,
      mmrLambda: 0.7,
    });

    // 检测 stance 冲突
    const stances = hits.map((h) => h.chunk.stance).filter(Boolean);
    const hasConflict = stances.length > 1 && new Set(stances).size > 1;

    let ragContext = hits.length
      ? hits
          .map((hit, i) => {
            const type = getDocumentTypeLabel(hit.chunk.docType);
            const heading = hit.chunk.headingPath.join(' > ') || '正文';
            const date = hit.chunk.date ? ` (${hit.chunk.date})` : '';
            return `[${i + 1}] ${hit.chunk.title} [${type}${date}] [${heading}]\n${hit.chunk.content}`;
          })
          .join('\n\n')
      : '暂无相关资料';

    // 如果有 stance 冲突，在 context 末尾追加反证标记段落
    if (hasConflict) {
      const conflictNote = [
        '',
        '注意：以下检索结果中存在 stance 冲突（看多/看空/中性观点并存）：',
        ...hits
          .filter((h) => h.chunk.stance)
          .map((h, i) => `- [${i + 1}] ${h.chunk.title}: ${h.chunk.stance}`),
        '请在「分歧与反证」段落中分析这些不同立场。',
      ].join('\n');
      ragContext += '\n\n' + conflictNote;
    }

    // 确定使用的消息（只传当前轮给 AI，避免上下文过长；历史已在 thread 文件中）
    const aiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: 'user',
        content: `参考资料:\n${ragContext}\n\n问题: ${question}`,
      },
    ];

    // 流式调用 AI
    const config = getDeepSeekConfig();
    const aiRes = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        reasoning_effort: 'max',
        max_tokens: 393216,
        stream: true,
        messages: aiMessages,
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`AI 请求失败: ${aiRes.status}`);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        function emit(type: string, data: unknown) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        }

        const reader = aiRes.body?.getReader();
        if (!reader) { controller.close(); return; }

        const decoder = new TextDecoder();
        let fullAnswer = '';
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
                const delta = parsed.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  fullAnswer += delta;
                  emit('chunk', { delta, content: fullAnswer });
                }
              } catch { /* skip */ }
            }
          }

          const timestamp = new Date().toISOString();
          const sourcesMeta = hits.slice(0, 8).map((h) => ({
            id: h.chunk.docId,
            title: h.chunk.title,
            docType: h.chunk.docType,
            heading: h.chunk.headingPath.join(' > '),
            date: h.chunk.date,
            snippet: h.chunk.content.slice(0, 200),
            score: Math.round(h.finalScore * 100),
          }));

          const sourcesLine = sourcesMeta
            .map((s, i) => `[${i + 1}] ${s.title}`)
            .join(' · ');

          const sourcesBlock = sourcesMeta.length
            ? [
                `引用来源: ${sourcesLine}`,
                '',
                '```sources',
                JSON.stringify(sourcesMeta),
                '```',
              ].join('\n')
            : '';

          await mkdir(QA_DIR, { recursive: true });

          let fileName = '';
          let qaFilePath = '';
          let roundNumber = 1;
          let isNewThread = true;

          if (threadId) {
            // 追加到已有线程
            fileName = `${threadId}.md`;
            qaFilePath = path.join(QA_DIR, fileName);
            try {
              const existing = await readFile(qaFilePath, 'utf8');
              roundNumber = parseThreadRounds(existing) + 1;

              // 追加新轮次
              const newRound = [
                '',
                '---',
                '',
                `## 第 ${roundNumber} 轮 · ${timestamp.slice(0, 16).replace('T', ' ')}`,
                '',
                `**🙋 用户**: ${question}`,
                '',
                `**🤖 助手**: ${fullAnswer.trim()}`,
                '',
                sourcesBlock,
              ].join('\n');

              // 更新 frontmatter 的 updated_at
              const updated = existing.replace(
                /^updated_at:.*$/m,
                `updated_at: ${timestamp}`,
              );

              await writeFile(qaFilePath, updated + newRound, 'utf8');
              isNewThread = false;
            } catch {
              // 文件不存在，按新线程处理
              isNewThread = true;
            }
          }

          if (isNewThread) {
            const fileSlug = slugify(question).slice(0, 50);
            fileName = `${fileSlug}-${Date.now().toString(36)}.md`;
            qaFilePath = path.join(QA_DIR, fileName);
            roundNumber = 1;

            const frontmatter = [
              '---',
              `type: qa`,
              `thread_id: ${fileName.replace('.md', '')}`,
              `title: ${question.slice(0, 80)}`,
              `date: ${timestamp.slice(0, 10)}`,
              `created_at: ${timestamp}`,
              `updated_at: ${timestamp}`,
              `themes: []`,
              `stocks: []`,
              `tags: [知识库问答]`,
              '---',
              '',
            ].join('\n');

            const mdContent = [
              `# ${question.slice(0, 60)}`,
              '',
              `> 创建: ${timestamp.slice(0, 16).replace('T', ' ')}`,
              '',
              `## 第 1 轮 · ${timestamp.slice(0, 16).replace('T', ' ')}`,
              '',
              `**🙋 用户**: ${question}`,
              '',
              `**🤖 助手**: ${fullAnswer.trim()}`,
              '',
              sourcesBlock,
            ].join('\n');

            await writeFile(qaFilePath, frontmatter + mdContent, 'utf8');
          }

          // 返回的 threadId 使用文件名（不含扩展名）
          const resultThreadId = fileName.replace('.md', '');

          // 后台重建索引 + 增量更新 RAG
          buildLocalDocumentIndex()
            .then(() => readMarkdownDocument(qaFilePath))
            .then((doc) => upsertRagDocument(doc))
            .catch((err) => { console.error('[ask] QA 后索引更新失败:', err); });

          emit('done', {
            answer: fullAnswer,
            sources: sourcesMeta,
            threadId: resultThreadId,
            round: roundNumber,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '流式生成失败';
          emit('error', { message: msg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: '问答失败' }, { status: 500 });
  }
}
