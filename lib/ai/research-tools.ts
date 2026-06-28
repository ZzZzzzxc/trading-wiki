import { tool } from 'ai';
import { z } from 'zod';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';
import { readMarkdownDocument } from '@/lib/storage/md-store';
import { readFacts } from '@/lib/storage/fact-store';
import { readDocumentIndex } from '@/lib/storage/index-store';
import { DATA_DIRECTORIES } from '@/lib/storage/paths';
import path from 'node:path';
import { readdir } from 'node:fs/promises';

function filterFactsBy(opts: { stock?: string; theme?: string }) {
  const facts = readFacts();
  return facts.then((all) =>
    all.filter((f) => {
      if (opts.stock) {
        const stockMatch = f.stocks.some(
          (s) => s.includes(opts.stock!) || opts.stock!.includes(s),
        );
        if (!stockMatch) return false;
      }
      if (opts.theme) {
        const themeMatch = f.themes.some(
          (t) => t.includes(opts.theme!) || opts.theme!.includes(t),
        );
        if (!themeMatch) return false;
      }
      return true;
    }),
  );
}

async function findDocByDocId(docId: string): Promise<{
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
} | null> {
  // 优先通过索引查找
  try {
    const index = await readDocumentIndex();
    const entry = index.find((item) => item.id === docId || item.path.includes(docId));
    if (entry) {
      const absolutePath = path.resolve(entry.path);
      const doc = await readMarkdownDocument(absolutePath);
      return {
        title: doc.title,
        content: doc.content,
        frontmatter: doc.frontmatter as unknown as Record<string, unknown>,
      };
    }
  } catch {
    // 索引不可用时回退到目录扫描
  }

  // 回退：遍历所有文档目录
  for (const dir of Object.values(DATA_DIRECTORIES)) {
    try {
      const files = await readdir(dir);
      const file = files.find(
        (f) => f.startsWith(docId) || f.includes(docId) || f.replace(/\.md$/, '') === docId,
      );
      if (file) {
        const doc = await readMarkdownDocument(path.join(dir, file));
        return {
          title: doc.title,
          content: doc.content,
          frontmatter: doc.frontmatter as unknown as Record<string, unknown>,
        };
      }
    } catch {
      // 跳过不存在的目录
    }
  }

  return null;
}

const searchKnowledgeBaseSchema = z.object({
  query: z.string().describe('搜索关键词，使用中文，尽可能具体'),
  topK: z.number().default(5).describe('返回结果数量，默认5'),
});

const readDocumentSchema = z.object({
  docId: z.string().describe('文档ID，从 search_knowledge_base 的结果中获取'),
});

const getFactsSchema = z.object({
  stock: z.string().optional().describe('股票名称或代码，如"京东方A"或"000725"'),
  theme: z.string().optional().describe('主题名称，如"光纤光缆"、"CPO"'),
});

export const researchTools = {
  search_knowledge_base: tool({
    description:
      '在本地投研知识库中搜索与问题相关的内容。用于查找股票、产业链、观点、复盘等资料。',
    inputSchema: searchKnowledgeBaseSchema,
    execute: async ({ query, topK }: { query: string; topK: number }) => {
      const hits = await retrieveRelevantChunks({ query, topK: Math.min(topK, 10) });
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
  }),

  read_document: tool({
    description:
      '根据文档ID读取知识库中某篇文档的完整内容。当你找到一篇相关文档后，调用此工具查看全文。',
    inputSchema: readDocumentSchema,
    execute: async ({ docId }: { docId: string }) => {
      const doc = await findDocByDocId(docId);
      if (doc) {
        return { id: docId, title: doc.title, content: doc.content, frontmatter: doc.frontmatter };
      }
      return { id: docId, error: '未找到文档' };
    },
  }),

  get_facts: tool({
    description:
      '查询某只股票或某个主题相关的可验证断言。断言包含预测、验证状态和证据链。',
    inputSchema: getFactsSchema,
    execute: async ({ stock, theme }: { stock?: string; theme?: string }) => {
      const facts = await filterFactsBy({ stock, theme });
      return facts.slice(0, 20).map((f) => ({
        claim: f.claim,
        status: f.state,
        verify_by: f.sourceDocId,
        evidenceLevel: f.evidenceLevel,
        stocks: f.stocks,
        themes: f.themes,
      }));
    },
  }),
};

// 已迁移至 skills/research/，此文件保留向后兼容
export { toolRegistry } from './skills/registry';
