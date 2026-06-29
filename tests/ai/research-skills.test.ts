import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runRagRetrieval: vi.fn(),
  readDocumentIndex: vi.fn(),
  readMarkdownDocument: vi.fn(),
}));

vi.mock('@/lib/rag/pipeline', () => ({
  runRagRetrieval: mocks.runRagRetrieval,
}));

vi.mock('@/lib/storage/index-store', () => ({
  readDocumentIndex: mocks.readDocumentIndex,
}));

vi.mock('@/lib/storage/md-store', () => ({
  readMarkdownDocument: mocks.readMarkdownDocument,
}));

describe('research skills', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await import('@/lib/ai/skills/research');
  });

  it('uses the unified rag pipeline for knowledge search', async () => {
    const { toolRegistry } = await import('@/lib/ai/skills/registry');
    mocks.runRagRetrieval.mockResolvedValue({
      route: {
        intent: 'chain',
        method: 'regex',
        expandedQueries: ['液冷 设备 材料'],
        retrievalPlan: { targetDocTypes: ['theme_research'] },
      },
      searchQuery: '液冷 产业链',
      contextHits: [
        {
          chunk: {
            id: 'chunk-1',
            docId: 'doc-1',
            docPath: 'data/themes/liquid-cooling.md',
            docType: 'theme_research',
            title: '液冷产业链研究',
            headingPath: ['上游材料'],
            content: '冷板、接头、泵阀和CDU是液冷产业链中的关键环节。',
            date: '2026-06-01',
          },
          finalScore: 0.81234,
        },
      ],
    });

    const tool = toolRegistry.get('search_knowledge_base');
    const result = await tool?.execute(
      { query: '液冷产业链新增瓶颈', topK: 3, focus: 'technical', subQuestion: '液冷产业链新增瓶颈' },
      { question: 'AI数据中心液冷产业链有哪些新增瓶颈', depth: 'standard', focus: 'technical', runId: 'run-1' },
    ) as { traceId: string; hits: Array<{ chunkId: string; docId: string; score: number; snippet: string }> };

    expect(mocks.runRagRetrieval).toHaveBeenCalledWith('液冷产业链新增瓶颈', expect.objectContaining({
      topK: 3,
      contextTopK: 3,
      maxChunksPerDoc: 2,
      sourceBoosts: expect.objectContaining({ material: 2.4 }),
    }));
    expect(result.traceId).toContain('run-1_tool_');
    expect(result.hits).toEqual([
      expect.objectContaining({
        chunkId: 'chunk-1',
        docId: 'doc-1',
        score: 0.8123,
        snippet: expect.stringContaining('冷板'),
      }),
    ]);
  });

  it('limits read_document output by maxChars', async () => {
    const { toolRegistry } = await import('@/lib/ai/skills/registry');
    mocks.readDocumentIndex.mockResolvedValue([{ id: 'doc-1', path: 'data/themes/liquid-cooling.md' }]);
    mocks.readMarkdownDocument.mockResolvedValue({
      title: '液冷产业链研究',
      content: 'a'.repeat(5000),
      frontmatter: { type: 'theme_research' },
    });

    const tool = toolRegistry.get('read_document');
    const result = await tool?.execute(
      { docId: 'doc-1', maxChars: 1000 },
      { question: '液冷', depth: 'standard', focus: 'technical' },
    ) as { content: string; truncated: boolean; maxChars: number };

    expect(result.content).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(result.maxChars).toBe(1000);
  });
});
