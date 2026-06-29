import type { DocumentType, MarkdownDocument } from '@/lib/types/document';

export interface RagChunk {
  id: string;
  docId: string;
  docPath: string;
  docType: DocumentType;
  title: string;
  headingPath: string[];
  content: string;
  date?: string;
  author?: string;
  platform?: string;
  stance?: string;
  stocks?: string[];
  themes?: string[];
  tags?: string[];
}

export interface RagEmbedding {
  id: string;
  vector: number[];
}

export interface RetrieveOptions {
  query: string;
  topK?: number;
  docTypes?: DocumentType[];
  themes?: string[];
  stocks?: string[];
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  /** 源路由：按文档类型加权的倍数映射（1.0=不变，2.0=双倍权重） */
  sourceBoosts?: Partial<Record<string, number>>;
  /** 各评分维度的动态权重（默认 0.6/0.15/0.1/0.15） */
  weights?: { vector: number; keyword: number; metadata: number; freshness: number };
  /** MMR 多样性系数：0=纯多样性，1=纯相关，默认不启用（undefined） */
  mmrLambda?: number;
  /** 是否启用 rerank，默认启用 */
  enableRerank?: boolean;
  /** 是否启用 MMR，默认启用 */
  enableMmr?: boolean;
  /** 送入 rerank 的候选数，默认 30 */
  rerankCandidateLimit?: number;
  /** rerank 后保留的候选数，默认至少保留 topK */
  rerankTopK?: number;
  /** 检索 trace ID（用于链路追踪，空则不写 trace） */
  traceId?: string;
  /** Multi-Query 扩展查询：多条具体查询分别检索后合并，用于模糊查询场景 */
  expandedQueries?: string[];
  /** trace 补充信息：原始用户问题 */
  originalQuery?: string;
  /** trace 补充信息：改写后的查询 */
  rewrittenQuery?: string;
  /** trace 补充信息：源路由意图 */
  intent?: string;
  /** trace 补充信息：源路由匹配方式 */
  routeMethod?: 'llm' | 'regex' | 'none';
  /** trace 补充信息：源路由各意图评分明细 */
  intentScores?: Array<{ intent: string; score: number; matched: string[] }>;
  /** 降级检索的文档类型 */
  fallbackDocTypes?: DocumentType[];
  /** 按作者过滤 */
  author?: string;
  /** 按平台过滤 */
  platform?: string;
  /** 按立场过滤 (bullish/bearish/neutral/watch) */
  stance?: string;
  /** trace 补充信息：进入检索层的目标文档类型 */
  traceTargetDocTypes?: DocumentType[];
  /** trace 补充信息：进入 prompt 的 chunk 数 */
  traceContextTopK?: number;
  /** trace 补充信息：同一文档进入 prompt 的 chunk 上限 */
  traceMaxChunksPerDoc?: number;
}

export interface RagSearchHit {
  chunk: RagChunk;
  vectorScore: number;
  keywordScore: number;
  metadataScore: number;
  freshnessScore: number;
  finalScore: number;
}

export interface ChunkMarkdownOptions {
  maxLength?: number;
  minLength?: number;
}

export type RagSourceDocument = MarkdownDocument;

/** 回答模式 */
export type AnswerMode =
  | 'direct_answer'
  | 'evidence_based_analysis'
  | 'comparison_table'
  | 'timeline'
  | 'summary'
  | 'markdown_generation';

/** 意图识别输出的检索计划 */
export interface RetrievalPlan {
  targetDocTypes: DocumentType[];
  searchMode: 'vector' | 'keyword' | 'hybrid';
  topK: number;
  /** 最终进入 prompt 的 chunk 数上限（默认 = topK，通常比 topK 小） */
  contextTopK?: number;
  /** 同一文档最多进入 prompt 的 chunk 数 */
  maxChunksPerDoc?: number;
  filters: {
    stocks?: string[];
    themes?: string[];
    dateFrom?: string;
    dateTo?: string;
  };
  answerMode: AnswerMode;
  /** 降级文档类型（当 primary 结果不足时使用） */
  fallbackDocTypes?: DocumentType[];
  /** 按作者过滤 */
  author?: string;
  /** 按平台过滤 */
  platform?: string;
  /** 按立场过滤 (bullish/bearish/neutral/watch) */
  stance?: string;
}

/** 实体提取结果 */
export interface ParsedEntities {
  stocks: Array<{ name: string; codes: string[]; themes: string[] }>;
  themes: string[];
  author?: string;
  timeRange?: {
    type: 'today' | 'yesterday' | 'recent' | 'historical' | 'unknown';
    dateFrom?: string;
    dateTo?: string;
  };
}
