/** 带来源标注的结构化条目 */
export interface SourcedItem {
  text: string;
  source: 'original' | 'opinion' | 'inferred' | 'market' | 'rag' | 'personal' | 'unknown';
  source_ref?: string;
}

export const documentTypes = [
  'daily_review',
  'viewpoint',
  'theme_research',
  'stock_profile',
  'note',
  'raw',
  'qa',
  'material',
] as const;

export type DocumentType = (typeof documentTypes)[number];

export interface DocumentFrontmatter {
  type: DocumentType;
  title: string;
  date?: string;
  author?: string;
  platform?: string;
  source?: string;
  stance?: string;
  time_horizon?: string;
  confidence?: string;
  market_phase?: string;
  stock_code?: string;
  themes?: string[];
  stocks?: string[];
  mentioned_stocks?: string[];
  mentioned_themes?: string[];
  core_stocks?: string[];
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  /** Q&A 会话线程 ID */
  thread_id?: string;
  /** 页面状态：active | archived | draft | iterating */
  status?: string;
  /** 最后审阅日期（ISO date） */
  last_reviewed?: string;
  /** 关联文档 ID 列表（双向链接） */
  related?: string[];
  /** 证据来源强度（仅事实类）：A | B | C | D */
  evidence_level?: string;
}

export interface MarkdownDocument<
  TFrontmatter extends DocumentFrontmatter = DocumentFrontmatter,
> {
  id: string;
  slug: string;
  title: string;
  absolutePath: string;
  relativePath: string;
  frontmatter: TFrontmatter;
  content: string;
  excerpt: string;
}

export interface DocumentIndexItem {
  id: string;
  type: DocumentType;
  title: string;
  path: string;
  date?: string;
  themes: string[];
  stocks: string[];
  tags: string[];
  author?: string;
  platform?: string;
  /** 观点立场（仅 viewpoint 类型有效） */
  stance?: string;
  summary: string;
  /** 页面状态 */
  status?: string;
  /** 最后审阅日期 */
  last_reviewed?: string;
  /** 认知确定程度 */
  confidence?: string;
  /** 时间维度（仅 viewpoint 类型有效） */
  time_horizon?: string;
  /** 证据强度（仅 material 类型有效） */
  evidence_level?: string;
}
