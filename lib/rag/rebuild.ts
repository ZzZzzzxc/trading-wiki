import { readFile, writeFile } from 'node:fs/promises';
import { chunkMarkdownDocument } from '@/lib/rag/chunk-md';
import { embedText, getEmbeddingDimension } from '@/lib/rag/embed';
import { loadRagSourceDocuments } from '@/lib/rag/load-docs';
import { ensureProjectDirectories, RAG_FILES } from '@/lib/storage/paths';
import type { RagChunk, RagEmbedding, RagSourceDocument } from '@/lib/rag/types';

let rebuildPromise: Promise<void> | null = null;

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const source = await readFile(filePath, 'utf8');
    return source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

/** 增量更新：新增或更新一个文档的 RAG chunks */
export async function upsertRagDocument(document: RagSourceDocument): Promise<void> {
  await ensureProjectDirectories();

  const [existingChunks, existingEmbeddings] = await Promise.all([
    readJsonLines<RagChunk>(RAG_FILES.chunks),
    readJsonLines<RagEmbedding>(RAG_FILES.embeddings),
  ]);

  // 移除旧 chunks
  const filteredChunks = existingChunks.filter((c) => c.docId !== document.id);
  const filteredEmbeddings = existingEmbeddings.filter(
    (e) => !e.id.startsWith(`${document.id}::`),
  );

  // 生成新 chunks + embeddings（分批避免 OOM）
  const newChunks = chunkMarkdownDocument(document);
  const BATCH_SIZE = 32; // 原 5 → 32，嵌入吞吐提升 3-5x
  const newEmbeddings: RagEmbedding[] = [];
  for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
    const batch = newChunks.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (chunk) => ({
        id: chunk.id,
        vector: await embedText(
          [
            chunk.title,
            chunk.headingPath.join(' '),
            chunk.content,
            ...(chunk.themes ?? []),
            ...(chunk.stocks ?? []),
          ].join('\n'),
          'passage',
        ),
      })),
    );
    newEmbeddings.push(...results);
  }

  const allChunks = [...filteredChunks, ...newChunks];
  const allEmbeddings = [...filteredEmbeddings, ...newEmbeddings];

  await Promise.all([
    writeFile(RAG_FILES.chunks, allChunks.map((item) => JSON.stringify(item)).join('\n'), 'utf8'),
    writeFile(RAG_FILES.embeddings, allEmbeddings.map((item) => JSON.stringify(item)).join('\n'), 'utf8'),
    writeFile(
      RAG_FILES.meta,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), chunkCount: allChunks.length, embeddingDimension: getEmbeddingDimension() }, null, 2)}\n`,
      'utf8',
    ),
  ]);
}

/** 增量删除：移除一个文档的所有 RAG chunks */
export async function removeRagDocument(docId: string): Promise<void> {
  await ensureProjectDirectories();

  const [existingChunks, existingEmbeddings] = await Promise.all([
    readJsonLines<RagChunk>(RAG_FILES.chunks),
    readJsonLines<RagEmbedding>(RAG_FILES.embeddings),
  ]);

  const filteredChunks = existingChunks.filter((c) => c.docId !== docId);
  const filteredEmbeddings = existingEmbeddings.filter(
    (e) => !e.id.startsWith(`${docId}::`),
  );

  if (filteredChunks.length === existingChunks.length) return; // 没找到，跳过

  await Promise.all([
    writeFile(RAG_FILES.chunks, filteredChunks.map((item) => JSON.stringify(item)).join('\n'), 'utf8'),
    writeFile(RAG_FILES.embeddings, filteredEmbeddings.map((item) => JSON.stringify(item)).join('\n'), 'utf8'),
    writeFile(
      RAG_FILES.meta,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), chunkCount: filteredChunks.length, embeddingDimension: getEmbeddingDimension() }, null, 2)}\n`,
      'utf8',
    ),
  ]);
}

/** 全量重建 RAG 索引（自动去重并发调用） */
export async function rebuildRagIndex(): Promise<void> {
  // 避免并发重建
  if (rebuildPromise) return rebuildPromise;

  rebuildPromise = (async () => {
    await ensureProjectDirectories();
    const documents = await loadRagSourceDocuments();
    const chunks = documents.flatMap((document) => chunkMarkdownDocument(document));

    // 分批 embedding，避免 OOM（BGE 模型在 CPU 上跑，并发无益）
    const BATCH_SIZE = 32; // 原 5 → 32
    const embeddings: RagEmbedding[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (chunk) => ({
          id: chunk.id,
          vector: await embedText(
            [
              chunk.title,
              chunk.headingPath.join(' '),
              chunk.content,
              ...(chunk.themes ?? []),
              ...(chunk.stocks ?? []),
            ].join('\n'),
            'passage',
          ),
        })),
      );
      embeddings.push(...results);
    }

    await Promise.all([
      writeFile(RAG_FILES.chunks, chunks.map((item) => JSON.stringify(item)).join('\n'), 'utf8'),
      writeFile(RAG_FILES.embeddings, embeddings.map((item) => JSON.stringify(item)).join('\n'), 'utf8'),
      writeFile(
        RAG_FILES.meta,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), documentCount: documents.length, chunkCount: chunks.length, embeddingDimension: getEmbeddingDimension() }, null, 2)}\n`,
        'utf8',
      ),
    ]);
  })();

  try {
    await rebuildPromise;
  } finally {
    rebuildPromise = null;
  }
}
