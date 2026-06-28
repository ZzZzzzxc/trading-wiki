import { z } from 'zod';
import type { SkillTool } from '../types';
import { registerSkills } from '../loader';
import { readMarkdownDocument } from '@/lib/storage/md-store';
import { readFacts } from '@/lib/storage/fact-store';
import { readDocumentIndex } from '@/lib/storage/index-store';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DATA_DIRECTORIES, RAG_FILES } from '@/lib/storage/paths';

const searchKnowledgeBase: SkillTool = {
  name: 'search_knowledge_base',
  description: '在本地投研知识库中搜索与问题相关的资料。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词，使用中文，尽可能具体'),
    topK: z.number().default(5).describe('返回结果数量'),
  }),
  skill: 'research',
  execute: async (args: unknown) => {
    const raw = args as Record<string, unknown>;
    const query = (raw.query || raw.query_text || '') as string;
    if (!query || !query.trim()) return [];

    try {
      const source = readFileSync(RAG_FILES.chunks, 'utf-8');
      const firstSpace = query.indexOf(' ');
      const searchKey = firstSpace > 0 ? query.slice(0, firstSpace) : query;
      let start = 0;
      while (start < source.length) {
        const nl = source.indexOf('\n', start);
        if (nl < 0) break;
        const line = source.slice(start, nl).trim();
        start = nl + 1;
        if (!line) continue;
        try {
          const chunk = JSON.parse(line);
          const title = (chunk.title || '') as string;
          if (title.indexOf(searchKey) >= 0) {
            return [{
              id: (chunk.id as string) || '', docId: (chunk.docId as string) || '',
              title: (chunk.title as string) || '', docType: (chunk.docType as string) || '',
              content: ((chunk.content as string) || '').slice(0, 600),
              score: 1, date: (chunk.date as string) || '',
              heading: ((chunk.headingPath as string[]) || []).join(' > '),
            }];
          }
        } catch { continue; }
      }
    } catch { /* ignore */ }
    return [];
  },
};

const readDocument: SkillTool = {
  name: 'read_document',
  description: '根据文档ID读取某篇文档的完整内容。',
  inputSchema: z.object({
    docId: z.string().describe('文档ID（驼峰命名）'),
    doc_id: z.string().optional().describe('文档ID（下划线命名，兼容）'),
  }),
  skill: 'research',
  execute: async (args: unknown) => {
    const raw = args as Record<string, unknown>;
    const docId = (raw.docId || raw.doc_id || '') as string;
    if (!docId) return { error: '缺少文档ID' };

    try {
      const index = await readDocumentIndex();
      const entry = index.find((item) => item.id === docId || item.path.includes(docId));
      if (entry) {
        const doc = await readMarkdownDocument(path.resolve(entry.path));
        return { id: docId, title: doc.title, content: doc.content, frontmatter: doc.frontmatter as unknown as Record<string, unknown> };
      }
    } catch { /* ignore */ }

    for (const dir of Object.values(DATA_DIRECTORIES)) {
      try {
        const files = await readdir(dir);
        const file = files.find((f) => f.startsWith(docId) || f.includes(docId));
        if (file) {
          const doc = await readMarkdownDocument(path.join(dir, file));
          return { id: docId, title: doc.title, content: doc.content, frontmatter: doc.frontmatter as unknown as Record<string, unknown> };
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
