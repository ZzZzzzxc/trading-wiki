import { retrieveRelevantChunks } from '@/lib/rag/retrieve';
import { routeQuerySource, type SourceRoute } from '@/lib/rag/source-router';
import { getDocumentTypeLabel } from '@/lib/utils/display';
import type { DocumentType } from '@/lib/types/document';
import type { RagSearchHit } from '@/lib/rag/types';

export interface RagRetrievalRunOptions {
  route?: SourceRoute;
  traceId?: string;
  topK?: number;
  contextTopK?: number;
  maxChunksPerDoc?: number;
  docTypes?: DocumentType[];
  stocks?: string[];
  themes?: string[];
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  sourceBoosts?: Partial<Record<DocumentType, number>>;
  weights?: { vector: number; keyword: number; metadata: number; freshness: number };
  fallbackDocTypes?: DocumentType[];
  mmrLambda?: number;
  enableRerank?: boolean;
  enableMmr?: boolean;
  /** 按作者过滤 */
  author?: string;
}

export interface RagContextChunk {
  rank: number;
  chunkId: string;
  docId: string;
  title: string;
  docType: DocumentType;
  heading: string;
  date?: string;
  score: number;
  contextLine: string;
}

export interface RagRetrievalRun {
  route: SourceRoute;
  searchQuery: string;
  hits: RagSearchHit[];
  contextHits: RagSearchHit[];
  contextChunks: RagContextChunk[];
  contextText: string;
  hasStanceConflict: boolean;
}

function nonEmpty<T>(items: T[] | undefined): T[] | undefined {
  return items && items.length > 0 ? items : undefined;
}

export function selectContextHits(
  hits: RagSearchHit[],
  contextTopK?: number,
  maxChunksPerDoc?: number,
): RagSearchHit[] {
  const limit = contextTopK ?? hits.length;
  const perDocLimit = maxChunksPerDoc ?? Number.POSITIVE_INFINITY;
  const docCounts = new Map<string, number>();
  const selected: RagSearchHit[] = [];

  for (const hit of hits) {
    const current = docCounts.get(hit.chunk.docId) ?? 0;
    if (current >= perDocLimit) continue;
    selected.push(hit);
    docCounts.set(hit.chunk.docId, current + 1);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function buildRagContext(
  hits: RagSearchHit[],
): Pick<RagRetrievalRun, 'contextChunks' | 'contextText' | 'hasStanceConflict'> {
  const contextChunks = hits.map((hit, i) => {
    const type = getDocumentTypeLabel(hit.chunk.docType);
    const heading = hit.chunk.headingPath.join(' > ') || '正文';
    const date = hit.chunk.date ? ` (${hit.chunk.date})` : '';

    return {
      rank: i + 1,
      chunkId: hit.chunk.id,
      docId: hit.chunk.docId,
      title: hit.chunk.title,
      docType: hit.chunk.docType,
      heading,
      date: hit.chunk.date,
      score: hit.finalScore,
      contextLine: `[${i + 1}] ${hit.chunk.title} [${type}${date}] [${heading}]\n${hit.chunk.content}`,
    };
  });

  const stances = hits.map((h) => h.chunk.stance).filter(Boolean);
  const hasStanceConflict = stances.length > 1 && new Set(stances).size > 1;
  let contextText = contextChunks.length
    ? contextChunks.map((c) => c.contextLine).join('\n\n')
    : '暂无相关资料';

  if (hasStanceConflict) {
    const conflictNote = [
      '',
      '注意：以下检索结果中存在 stance 冲突（看多/看空/中性观点并存）：',
      ...hits
        .filter((h) => h.chunk.stance)
        .map((h, i) => `- [${i + 1}] ${h.chunk.title}: ${h.chunk.stance}`),
      '请在「分歧与反证」段落中分析这些不同立场。',
    ].join('\n');
    contextText += '\n\n' + conflictNote;
  }

  return { contextChunks, contextText, hasStanceConflict };
}

export async function runRagRetrieval(
  question: string,
  options: RagRetrievalRunOptions = {},
): Promise<RagRetrievalRun> {
  const route = options.route ?? await routeQuerySource(question);
  const rp = route.retrievalPlan;
  const searchQuery = route.rewrittenQuery || question;
  const sourceBoosts = options.sourceBoosts
    ?? (Object.keys(route.docTypeBoosts).length > 0 ? route.docTypeBoosts : undefined);

  const docTypes = options.docTypes ?? nonEmpty(rp.targetDocTypes);
  const stocks = options.stocks ?? nonEmpty(rp.filters.stocks);
  const themes = options.themes ?? nonEmpty(rp.filters.themes);
  const tags = options.tags;
  const dateFrom = options.dateFrom ?? rp.filters.dateFrom;
  const dateTo = options.dateTo ?? rp.filters.dateTo;
  const topK = options.topK ?? rp.topK;
  const contextTopK = options.contextTopK ?? rp.contextTopK;
  const maxChunksPerDoc = options.maxChunksPerDoc ?? rp.maxChunksPerDoc;
  const fallbackDocTypes = options.fallbackDocTypes ?? rp.fallbackDocTypes;

  const hits = await retrieveRelevantChunks({
    query: searchQuery,
    topK,
    traceId: options.traceId,
    author: options.author ?? route.entities?.author,
    originalQuery: question,
    rewrittenQuery: route.rewrittenQuery,
    expandedQueries: route.expandedQueries,
    intent: route.intent,
    routeMethod: route.method,
    intentScores: route.intentScores,
    docTypes,
    stocks,
    themes,
    tags,
    dateFrom,
    dateTo,
    sourceBoosts,
    weights: options.weights ?? route.weights,
    fallbackDocTypes,
    mmrLambda: options.mmrLambda ?? 0.7,
    enableRerank: options.enableRerank,
    enableMmr: options.enableMmr,
    traceTargetDocTypes: docTypes,
    traceContextTopK: contextTopK,
    traceMaxChunksPerDoc: maxChunksPerDoc,
  });

  const contextHits = selectContextHits(hits, contextTopK, maxChunksPerDoc);
  const context = buildRagContext(contextHits);

  return {
    route,
    searchQuery,
    hits,
    contextHits,
    ...context,
  };
}
