import { z } from 'zod';
import type { SourcedItem } from '@/lib/types/document';
import type { VerifiableClaim } from '@/lib/types/viewpoint';

// ===== 新增子类型 =====

/** 多层价值链的一层 */
export interface ValueChainLayer {
  layer_name: string;
  description: string;
  companies: string[];
  bottlenecks: SourcedItem[];

  // ===== 新增字段（可选，资料充足时填写） =====
  /** 价值量占比（如"15%-20%"） */
  value_ratio?: string;
  /** 行业毛利率水平（如"30%-40%"） */
  gross_margin?: string;
  /** 全球龙头企业 */
  global_leaders?: string[];
  /** 中国主要参与公司 */
  cn_companies?: string[];
  /** A股映射（具体标的） */
  a_stock_mapping?: string[];
  /** 供需状态：过剩/平衡/偏紧/紧缺 */
  supply_demand?: string;
  /** 扩产周期（如"12-18个月"） */
  expansion_cycle?: string;
  /** 技术路线（如"硅基光电子/EML/VCSEL"） */
  tech_route?: string;
  /** 当前卡点详情 */
  bottleneck_detail?: string;
  /** 未来催化 */
  catalysts?: string[];
  /** 风险因素 */
  risks?: string[];
}

/** 证据表条目 */
export interface EvidenceItem {
  claim: string;
  grade: 'strong' | 'medium' | 'weak';
  support: string;
  needs_check: string;
  source_ref?: string;
}

/** 评分卡 */
export interface Scorecard {
  positive_factors: Array<{ factor: string; detail: string; weight?: number }>;
  penalty_factors: Array<{ factor: string; detail: string; weight?: number }>;
  summary?: string;
}

export interface ThemeResearchResult {
  title: string;
  industry_chain_position: string;
  capital_flow: string;
  physical_flow: string;
  profit_flow: string;
  upstream: string[];
  midstream: string[];
  downstream: string[];
  bottlenecks: SourcedItem[];
  core_companies: string[];
  catalysts: SourcedItem[];
  risks: SourcedItem[];
  personal_judgment: string;
  /** AI 提取的可验证声明 */
  verifiable_claims: VerifiableClaim[];
  // ===== 新增可选字段 =====
  /** 多层价值链映射 */
  value_chain_layers?: ValueChainLayer[];
  /** 证据强度表 */
  evidence_table?: EvidenceItem[];
  /** 证伪条件 */
  failure_conditions?: string[];
  /** 下一步研究行动 */
  next_steps?: string[];
  /** 量化评分卡 */
  scorecard?: Scorecard;
  // ===== 新增分析字段 =====
  /** 新增约束分析 */
  bottleneck_analysis?: {
    fastest_growth?: string;
    slowest_expansion?: string;
    lowest_localization?: string;
    longest_validation?: string;
    most_likely_price_up?: string;
    least_understood?: string;
  };
  /** 投资判断 */
  investment_judgment?: {
    highest_certainty?: string;
    highest_elasticity?: string;
    biggest_gap?: string;
    fully_priced?: string;
    may_be_misunderstood?: string;
  };
  /** A股映射分类 */
  a_stock_mapping?: {
    core?: string[];
    high_beta?: string[];
    material?: string[];
    equipment?: string[];
    laggard?: string[];
    fake_concept?: string[];
  };
  /** 验证时间线 */
  verification_timeline?: {
    next_3_months?: string[];
    next_6_months?: string[];
    next_12_months?: string[];
    falsification_data?: string[];
  };
  /** 引用来源列表（配合正文中的 [N] 标记） */
  references?: Array<{
    id: string;
    title: string;
  }>;
}

const sourcedItemSchema = z.object({
  text: z.string(),
  source: z.enum(['original', 'opinion', 'inferred', 'market', 'rag', 'personal', 'unknown']),
  source_ref: z.string().optional(),
});

const verifiableClaimSchema = z.object({
  claim: z.string(),
  verify_by: z.string(),
  suggested_window: z.string(),
});

const valueChainLayerSchema = z.object({
  layer_name: z.string(),
  description: z.string(),
  companies: z.array(z.string()),
  bottlenecks: z.array(sourcedItemSchema),
  value_ratio: z.string().optional(),
  gross_margin: z.string().optional(),
  global_leaders: z.array(z.string()).optional(),
  cn_companies: z.array(z.string()).optional(),
  a_stock_mapping: z.array(z.string()).optional(),
  supply_demand: z.string().optional(),
  expansion_cycle: z.string().optional(),
  tech_route: z.string().optional(),
  bottleneck_detail: z.string().optional(),
  catalysts: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
});

const evidenceItemSchema = z.object({
  claim: z.string(),
  grade: z.enum(['strong', 'medium', 'weak']),
  support: z.string(),
  needs_check: z.string(),
  source_ref: z.string().optional(),
});

const scoreFactorSchema = z.object({
  factor: z.string(),
  detail: z.string(),
  weight: z.number().optional(),
});

const scorecardSchema = z.object({
  positive_factors: z.array(scoreFactorSchema),
  penalty_factors: z.array(scoreFactorSchema),
  summary: z.string().optional(),
});

export const themeResearchGenerationSchema = z.object({
  title: z.string(),
  industry_chain_position: z.string(),
  capital_flow: z.string(),
  physical_flow: z.string(),
  profit_flow: z.string(),
  upstream: z.array(z.string()),
  midstream: z.array(z.string()),
  downstream: z.array(z.string()),
  bottlenecks: z.array(sourcedItemSchema),
  core_companies: z.array(z.string()),
  catalysts: z.array(sourcedItemSchema),
  risks: z.array(sourcedItemSchema),
  personal_judgment: z.string(),
  verifiable_claims: z.array(verifiableClaimSchema),
  // ===== 新增可选字段 =====
  value_chain_layers: z.array(valueChainLayerSchema).optional(),
  evidence_table: z.array(evidenceItemSchema).optional(),
  failure_conditions: z.array(z.string()).optional(),
  next_steps: z.array(z.string()).optional(),
  scorecard: scorecardSchema.optional(),
  bottleneck_analysis: z.object({
    fastest_growth: z.string().optional(),
    slowest_expansion: z.string().optional(),
    lowest_localization: z.string().optional(),
    longest_validation: z.string().optional(),
    most_likely_price_up: z.string().optional(),
    least_understood: z.string().optional(),
  }).optional(),
  investment_judgment: z.object({
    highest_certainty: z.string().optional(),
    highest_elasticity: z.string().optional(),
    biggest_gap: z.string().optional(),
    fully_priced: z.string().optional(),
    may_be_misunderstood: z.string().optional(),
  }).optional(),
  a_stock_mapping: z.object({
    core: z.array(z.string()).optional(),
    high_beta: z.array(z.string()).optional(),
    material: z.array(z.string()).optional(),
    equipment: z.array(z.string()).optional(),
    laggard: z.array(z.string()).optional(),
    fake_concept: z.array(z.string()).optional(),
  }).optional(),
  verification_timeline: z.object({
    next_3_months: z.array(z.string()).optional(),
    next_6_months: z.array(z.string()).optional(),
    next_12_months: z.array(z.string()).optional(),
    falsification_data: z.array(z.string()).optional(),
  }).optional(),
  references: z.array(z.object({
    id: z.string(),
    title: z.string(),
  })).optional(),
});

export interface GenerateThemeResearchInput {
  themeName: string;
  rawMaterials: string;
  personalObservation: string;
}
