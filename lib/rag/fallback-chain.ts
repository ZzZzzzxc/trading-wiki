import type { DocumentType } from '@/lib/types/document';

/**
 * 数据源降级链配置。
 * 当 primary 文档类型检索结果不足 topK 时，自动降级到 fallback，再不足到 lastResort。
 */
export interface FallbackChain {
  primary: DocumentType[];
  fallback: DocumentType[];
  lastResort: DocumentType[];
}

// 各意图的默认降级链
export const FALLBACK_CHAINS: Record<string, FallbackChain> = {
  stock_deep: {
    primary: ['stock_profile', 'material'],
    fallback: ['viewpoint', 'theme_research'],
    lastResort: ['note', 'qa'],
  },
  chain: {
    primary: ['theme_research', 'material'],
    fallback: ['viewpoint', 'stock_profile'],
    lastResort: ['note', 'qa'],
  },
  recency: {
    primary: ['material', 'daily_review'],
    fallback: ['viewpoint', 'theme_research'],
    lastResort: ['stock_profile', 'note'],
  },
  verification: {
    primary: ['viewpoint', 'stock_profile'],
    fallback: ['material', 'theme_research'],
    lastResort: ['note', 'qa'],
  },
  market_review: {
    primary: ['daily_review', 'viewpoint'],
    fallback: ['material', 'theme_research'],
    lastResort: ['stock_profile', 'note'],
  },
  general: {
    primary: ['viewpoint', 'material', 'theme_research', 'stock_profile'],
    fallback: ['daily_review', 'note'],
    lastResort: ['qa'],
  },
  policy_impact: {
    primary: ['material', 'daily_review'],
    fallback: ['viewpoint', 'theme_research'],
    lastResort: ['stock_profile', 'note'],
  },
  risk_alert: {
    primary: ['material', 'viewpoint'],
    fallback: ['daily_review', 'theme_research'],
    lastResort: ['stock_profile', 'qa'],
  },
};

export function getFallbackChain(intent: string): FallbackChain {
  return FALLBACK_CHAINS[intent] ?? FALLBACK_CHAINS.general;
}
