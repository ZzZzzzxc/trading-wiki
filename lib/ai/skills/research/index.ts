import { z } from 'zod';
import type { SkillTool } from '../types';
import { registerSkills } from '../loader';
import { readMarkdownDocument } from '@/lib/storage/md-store';
import { readFacts } from '@/lib/storage/fact-store';
import { readDocumentIndex } from '@/lib/storage/index-store';
import { runRagRetrieval } from '@/lib/rag/pipeline';
import { FOCUS_RAG_OPTIONS, normalizeSnippet, type ResearchFocus } from '@/lib/ai/research-protocol';
import type { DocumentType } from '@/lib/types/document';
import type { RagChunk } from '@/lib/rag/types';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { DATA_DIRECTORIES, RAG_FILES } from '@/lib/storage/paths';

const documentTypeSchema = z.enum([
  'daily_review',
  'viewpoint',
  'theme_research',
  'stock_profile',
  'note',
  'raw',
  'qa',
  'material',
]);

async function readRagChunks(): Promise<RagChunk[]> {
  try {
    const source = await readFile(RAG_FILES.chunks, 'utf8');
    return source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RagChunk);
  } catch {
    return [];
  }
}

function clampMaxChars(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 2500;
  return Math.min(Math.max(Math.floor(n), 600), 8000);
}

function resolveFocus(raw: Record<string, unknown>, ctxFocus: unknown): ResearchFocus {
  const focus = (raw.focus || ctxFocus || 'comprehensive') as ResearchFocus;
  if (['comprehensive', 'technical', 'fundamental', 'news'].includes(focus)) return focus;
  return 'comprehensive';
}

const searchKnowledgeBase: SkillTool = {
  name: 'search_knowledge_base',
  description: '在本地投研知识库中用RAG搜索与研究问题相关的资料，返回可引用的chunk、分数和traceId。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词，使用中文，尽可能具体'),
    topK: z.number().default(5).describe('返回结果数量'),
    focus: z.enum(['comprehensive', 'technical', 'fundamental', 'news']).optional().describe('研究聚焦方向'),
    subQuestion: z.string().optional().describe('当前研究子问题'),
    docTypes: z.array(documentTypeSchema).optional().describe('限定文档类型'),
  }),
  skill: 'research',
  execute: async (args: unknown, ctx) => {
    const raw = args as Record<string, unknown>;
    const query = (raw.query || raw.query_text || '') as string;
    if (!query || !query.trim()) return { traceId: '', searchQuery: '', hits: [], error: '缺少搜索关键词' };

    const focus = resolveFocus(raw, ctx.focus);
    const topK = Math.min(Math.max(Number(raw.topK ?? 5) || 5, 1), 12);
    const traceId = `${ctx.runId || 'research'}_tool_${crypto.randomUUID().slice(0, 8)}`;
    const focusOptions = FOCUS_RAG_OPTIONS[focus];
    const docTypes = Array.isArray(raw.docTypes) ? raw.docTypes as DocumentType[] : undefined;

    try {
      const rag = await runRagRetrieval(query, {
        traceId,
        topK,
        contextTopK: topK,
        maxChunksPerDoc: 2,
        docTypes,
        sourceBoosts: focusOptions.sourceBoosts,
        weights: focusOptions.weights,
      });

      return {
        traceId,
        route: {
          intent: rag.route.intent,
          method: rag.route.method,
          targetDocTypes: rag.route.retrievalPlan.targetDocTypes,
          expandedQueries: rag.route.expandedQueries,
        },
        searchQuery: rag.searchQuery,
        subQuestion: (raw.subQuestion as string | undefined) || query,
        hits: rag.contextHits.map((hit) => {
          const snippet = normalizeSnippet(hit.chunk.content);
          return {
            chunkId: hit.chunk.id,
            id: hit.chunk.id,
            docId: hit.chunk.docId,
            title: hit.chunk.title,
            docType: hit.chunk.docType,
            heading: hit.chunk.headingPath.join(' > ') || '正文',
            date: hit.chunk.date,
            score: Number(hit.finalScore.toFixed(4)),
            snippet,
            content: snippet,
          };
        }),
      };
    } catch (error) {
      return {
        traceId,
        searchQuery: query,
        subQuestion: (raw.subQuestion as string | undefined) || query,
        hits: [],
        error: error instanceof Error ? error.message : 'RAG检索失败',
      };
    }
  },
};

const readDocument: SkillTool = {
  name: 'read_document',
  description: '根据文档ID或chunkId读取知识库内容。默认限长返回，不读取超长全文。',
  inputSchema: z.object({
    docId: z.string().optional().describe('文档ID（驼峰命名）'),
    doc_id: z.string().optional().describe('文档ID（下划线命名，兼容）'),
    chunkId: z.string().optional().describe('RAG chunk ID'),
    chunk_id: z.string().optional().describe('RAG chunk ID（下划线命名，兼容）'),
    maxChars: z.number().default(2500).describe('最大返回字符数，默认2500，上限8000'),
  }),
  skill: 'research',
  execute: async (args: unknown) => {
    const raw = args as Record<string, unknown>;
    const docId = (raw.docId || raw.doc_id || '') as string;
    const chunkId = (raw.chunkId || raw.chunk_id || '') as string;
    const maxChars = clampMaxChars(raw.maxChars);
    if (!docId && !chunkId) return { error: '缺少文档ID或chunkId' };

    if (chunkId) {
      const chunks = await readRagChunks();
      const chunk = chunks.find((item) => item.id === chunkId);
      if (!chunk) return { chunkId, error: '未找到chunk' };

      const content = chunk.content.slice(0, maxChars);
      return {
        id: chunk.docId,
        docId: chunk.docId,
        chunkId: chunk.id,
        title: chunk.title,
        heading: chunk.headingPath.join(' > ') || '正文',
        docType: chunk.docType,
        content,
        truncated: chunk.content.length > content.length,
        maxChars,
      };
    }

    try {
      const index = await readDocumentIndex();
      const entry = index.find((item) => item.id === docId || item.path.includes(docId));
      if (entry) {
        const doc = await readMarkdownDocument(path.resolve(entry.path));
        const content = doc.content.slice(0, maxChars);
        return {
          id: docId,
          title: doc.title,
          content,
          truncated: doc.content.length > content.length,
          maxChars,
          frontmatter: doc.frontmatter as unknown as Record<string, unknown>,
        };
      }
    } catch { /* ignore */ }

    for (const dir of Object.values(DATA_DIRECTORIES)) {
      try {
        const files = await readdir(dir);
        const file = files.find((f) => f.startsWith(docId) || f.includes(docId));
        if (file) {
          const doc = await readMarkdownDocument(path.join(dir, file));
          const content = doc.content.slice(0, maxChars);
          return {
            id: docId,
            title: doc.title,
            content,
            truncated: doc.content.length > content.length,
            maxChars,
            frontmatter: doc.frontmatter as unknown as Record<string, unknown>,
          };
        }
      } catch { continue; }
    }
    return { id: docId, error: '未找到文档' };
  },
};

const getFacts: SkillTool = {
  name: 'get_facts',
  description: '查询股票或主题相关的可验证断言。',
  inputSchema: z.object({
    stock: z.string().optional().describe('股票名称或代码'),
    theme: z.string().optional().describe('主题名称'),
  }),
  skill: 'research',
  execute: async (args: unknown) => {
    const raw = args as Record<string, unknown>;
    const stock = (raw.stock || raw.ticker || '') as string;
    const theme = (raw.theme || raw.industry || '') as string;
    if (!stock && !theme) return [];

    const allFacts = await readFacts();
    let filtered = allFacts;
    if (stock) {
      const kw = stock.toLowerCase();
      filtered = filtered.filter((f) => f.stocks?.some((s) => s.includes(kw) || kw.includes(s)));
    }
    if (theme) {
      filtered = filtered.filter((f) => f.themes?.some((t) => t.includes(theme)));
    }
    return filtered.slice(0, 20).map((f) => ({
      claim: f.claim, state: f.state, evidenceLevel: f.evidenceLevel,
      stocks: f.stocks, themes: f.themes,
    }));
  },
};

registerSkills([searchKnowledgeBase, readDocument, getFacts]);
