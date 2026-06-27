import { z } from 'zod';
import type { DocumentType } from '@/lib/types/document';
import type { RetrievalPlan, ParsedEntities } from '@/lib/rag/types';
import { getDeepSeekConfig } from '@/lib/ai/model';
import { extractEntities, getRelatedStocks, getRelatedThemes } from '@/lib/rag/dictionary';

// ---- Types ----

export interface WeightConfig {
  vector: number;
  keyword: number;
  metadata: number;
  freshness: number;
}

export interface SourceRoute {
  /** 意图分类 */
  intent: string;
  /** 对各文档类型的权重加成（1.0 = 不变，3.0 = 三倍权重） */
  docTypeBoosts: Partial<Record<DocumentType, number>>;
  /** 各评分维度的动态权重 */
  weights: WeightConfig;
  /** 改写后的搜索查询（用于 embedding，保留原始问题给 LLM） */
  rewrittenQuery?: string;
  /** Multi-Query 扩展查询（recency 意图用，多条具体查询分别检索后合并） */
  expandedQueries?: string[];
  /** 检索计划（替代 docTypeBoosts 做更精确的检索控制） */
  retrievalPlan: RetrievalPlan;
  /** 识别到的实体 */
  entities?: ParsedEntities;
  /** 各意图评分明细（用于调试 trace） */
  intentScores?: Array<{ intent: string; score: number; matched: string[] }>;
  /** 是否启用鲜度优先 */
  recencyFirst: boolean;
  /** 是否扩展关联搜索 */
  expandRelated: boolean;
  /** 分类方式 */
  method: 'llm' | 'regex' | 'none';
}

// ---- 各意图的动态权重配置 ----

const WEIGHT_PROFILES: Record<string, WeightConfig> = {
  // 问最新动态 → 时效性最重要
  recency:       { vector: 0.25, keyword: 0.30, metadata: 0.10, freshness: 0.35 },
  // 验证证伪 → 关键词精确命中 + 时效并重
  verification:  { vector: 0.30, keyword: 0.40, metadata: 0.10, freshness: 0.20 },
  // 产业链 → metadata（文档类型）提权，区分产业链研报和普通素材
  chain:         { vector: 0.40, keyword: 0.15, metadata: 0.30, freshness: 0.15 },
  // 个股深度 → 语义 + metadata 为主
  stock_deep:    { vector: 0.50, keyword: 0.20, metadata: 0.20, freshness: 0.10 },
  // 市场复盘 → 时效 + metadata
  market_review: { vector: 0.40, keyword: 0.15, metadata: 0.15, freshness: 0.30 },
  // 通用 → 信任语义检索
  general:       { vector: 0.60, keyword: 0.15, metadata: 0.10, freshness: 0.15 },
};

export { WEIGHT_PROFILES };

// ---- Query Rewriting ----

/** 正则改写查询（LLM 改写不可用时回退） */
function rewriteViaRegex(query: string, intent: string): string {
  let q = query.trim();

  // 去除对话前缀
  q = q.replace(/^(帮我|请|请问|我想|我要|能不能帮我|可以帮我|分析一下|讲讲|介绍一下)\s*/g, '');
  // 去除"关于"
  q = q.replace(/^关于\s*/g, '');
  // 去除末尾疑问语气词（注意不加"么"，避免切断"什么""怎么"）
  q = q.replace(/[吗呢吧]\s*$/, '');
  // 去除末尾疑问句式
  q = q.replace(/(怎么样|好不好|怎么看|怎么办|能不能|会不会|有哪些|是什么|有什么)\s*$/g, '');
  // 去除句中填充词（保留核心名词）
  q = q.replace(/\s*(有什么|有哪些|是什么|什么是)\s*/g, ' ');

  // 按意图特定改写
  if (intent === 'verification') {
    // 验证类：去除验证动词和疑问词
    q = q.replace(/(是否|有没有|会不会|真的|假的|验证|证实|证伪|能不能|能不能够)\s*/g, ' ');
    // "A能不能取代B" → "A 取代 B"
    q = q.replace(/\s*能不能\s*/g, ' ');
  }
  if (intent === 'recency') {
    // 时效类：去除时间词但不丢掉主题
    q = q.replace(/(最近|最新|今天|昨天|近期|刚出|突发|还有没有)\s*/g, '');
    // "有什么催化" → "催化"
    q = q.replace(/有什么/g, '');
    // "最新动态" → "动态"
    q = q.replace(/最新/g, '');
  }

  return q.trim() || query;
}

// ---- LLM Classification + Rewriting ----

const intentSchema = z.object({
  intent: z.enum([
    'recency',
    'verification',
    'chain',
    'stock_deep',
    'market_review',
    'general',
  ]),
  reason: z.string().optional(),
  /** 改写后的搜索查询 */
  rewritten: z.string().optional(),
  /** Multi-Query 扩展（recency 用）：拆成多条具体搜索词，分别检索后合并 */
  expanded: z.array(z.string()).optional(),
});

type QueryIntent = z.infer<typeof intentSchema>;

/** LLM 分类 + 改写 */
async function classifyViaLLM(query: string): Promise<QueryIntent | null> {
  try {
    const config = getDeepSeekConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是查询意图分类器。分析用户问题，输出 JSON。',
              'intent 类别：',
              '- recency: 问最新动态、新闻、催化、公告',
              '- verification: 验证/证伪/预测是否兑现',
              '- chain: 产业链、关联公司、上下游扩散',
              '- stock_deep: 个股深度研究（估值、产能、订单、财报）',
              '- market_review: 市场复盘、情绪周期、主线板块',
              '- general: 以上都不匹配',
              '',
              'rewritten（可选）: 将用户口语化问题改写为更简洁、适合检索的关键词组合。',
              '  示例：「光模块现在还能不能买」→ "光模块 供需 景气度 2025"',
              '  示例：「帮我看看中际旭创最近怎么样」→ "中际旭创 最新动态"',
              '  示例：「关于先进封装这个概念现在还能做吗」→ "先进封装 验证"',
              '  如果原问题已经适合检索，则省略 rewritten。',
              '',
              'expanded（可选，仅 recency 意图需要）: 当用户问最新动态/催化时，',
              '  将口语化查询拆成 3-5 条具体的搜索关键词组合，覆盖不同检索角度。',
              '  示例：「800G光模块最近有什么催化」',
              '  → ["800G光模块 催化 事件 订单", "800G 1.6T 光模块 量产 进度", "800G 光模块 供应链 公司"]',
              '  示例：「光模块行业最新动态」',
              '  → ["光模块 技术 突破 量产", "光模块 业绩 订单 公告", "光模块 行业 观点 展望"]',
              '  每条应覆盖不同的角度（事件/业绩/技术/供应链等），非 recency 意图不输出此字段。',
              '只输出 JSON。',
            ].join('\n'),
          },
          { role: 'user', content: query.slice(0, 300) },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;

    return intentSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---- Regex Scoring ----

export interface IntentScore {
  intent: string;
  score: number;
  matched: string[];
}

export function scoreIntents(query: string): IntentScore[] {
  const q = query;

  const intentPatterns: Array<{ intent: string; weight: number; patterns: RegExp[] }> = [
    {
      intent: 'stock_deep',
      weight: 1.0,
      patterns: [
        /个股|档案|主营|估值|产能|订单|客户|营收|利润|财报|业绩|壁垒|护城河|优势|竞争力|业务|产品|技术/,
        /[一-鿿]{2,4}[公司]/,  // 限制长度避免贪婪匹配整句
        /[0-9]{6}/,
      ],
    },
    {
      intent: 'recency',
      weight: 1.0,
      patterns: [
        /最新|最近|今天|昨天|近期|刚出|突发|新闻|催化|公告|动态|进展/,
      ],
    },
    {
      intent: 'verification',
      weight: 1.0,
      patterns: [
        /验证|证实|证伪|预测|兑现|应验|是否|会不会|真的|果然|打脸|翻车|能不能取代|能否/,
      ],
    },
    {
      intent: 'chain',
      weight: 1.0,
      patterns: [
        /产业链|上下游|关联|扩散|涉及|还有哪些|包括|对标|替代|竞争|格局|供应|关系/,
      ],
    },
    {
      intent: 'market_review',
      weight: 1.0,
      patterns: [
        /复盘|情绪|冰点|高潮|退潮|市场环境|资金流向|主线|板块|赚钱效应|走[势向]|大盘/,
      ],
    },
  ];

  return intentPatterns
    .map(({ intent, weight, patterns }) => {
      let score = 0;
      const matched: string[] = [];
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, 'g');
        const matches = q.match(regex);
        if (matches) {
          for (const m of matches) {
            const matchWeight = Math.min(m.length / 3, 3);
            score += Math.floor(matchWeight * 10) / 10;
            if (!matched.includes(m)) matched.push(m);
          }
        }
      }
      score *= weight;
      const density = matched.reduce((s, m) => s + m.length, 0) / Math.max(q.length, 1);
      if (density > 0.3) score *= 1.5;
      return { intent, score, matched };
    })
    .sort((a, b) => {
      // 高分优先；同分时 general 优先（避免零分时第一个意图意外胜出）
      if (a.score !== b.score) return b.score - a.score;
      if (a.intent === 'general') return -1;
      if (b.intent === 'general') return 1;
      return 0;
    });
}

function classifyViaRegex(query: string): QueryIntent & { _scores?: IntentScore[] } {
  const scores = scoreIntents(query);
  const top = scores[0];

  if (top.score > 0 && scores.length > 1 && top.score >= scores[1].score * 2) {
    return { intent: top.intent, _scores: scores } as QueryIntent & { _scores: IntentScore[] };
  }
  if (top.score > 0) {
    return { intent: top.intent, _scores: scores } as QueryIntent & { _scores: IntentScore[] };
  }
  return { intent: 'general', _scores: scores } as QueryIntent & { _scores: IntentScore[] };
}

// ---- Retrieval Plan Builder ----

/** 按意图生成检索计划 */
function buildRetrievalPlan(intentName: string): RetrievalPlan {
  const plan: RetrievalPlan = {
    targetDocTypes: [],
    searchMode: 'hybrid',
    topK: 20,
    contextTopK: 6,
    maxChunksPerDoc: 2,
    filters: {},
    answerMode: 'evidence_based_analysis',
  };

  switch (intentName) {
    case 'recency':
      plan.targetDocTypes = ['raw' as DocumentType, 'material' as DocumentType, 'viewpoint' as DocumentType, 'daily_review' as DocumentType];
      plan.topK = 20;
      plan.contextTopK = 6;
      plan.answerMode = 'direct_answer';
      break;
    case 'verification':
      plan.targetDocTypes = ['material' as DocumentType, 'viewpoint' as DocumentType, 'stock_profile' as DocumentType];
      plan.contextTopK = 6;
      plan.answerMode = 'evidence_based_analysis';
      break;
    case 'chain':
      plan.targetDocTypes = ['theme_research' as DocumentType, 'material' as DocumentType, 'stock_profile' as DocumentType];
      plan.topK = 22;
      plan.contextTopK = 8;
      break;
    case 'stock_deep':
      plan.targetDocTypes = ['stock_profile' as DocumentType, 'material' as DocumentType, 'theme_research' as DocumentType, 'viewpoint' as DocumentType];
      plan.topK = 22;
      plan.contextTopK = 8;
      break;
    case 'market_review':
      plan.targetDocTypes = ['daily_review' as DocumentType, 'viewpoint' as DocumentType, 'material' as DocumentType];
      plan.contextTopK = 8;
      plan.answerMode = 'summary';
      break;
    case 'general':
    default:
      plan.targetDocTypes = ['material' as DocumentType, 'viewpoint' as DocumentType, 'theme_research' as DocumentType, 'stock_profile' as DocumentType, 'daily_review' as DocumentType, 'note' as DocumentType];
      plan.topK = 16;
      plan.contextTopK = 6;
      plan.answerMode = 'direct_answer';
      break;
  }

  return plan;
}

/** 从 query 中解析时间范围 */
function parseTimeRange(query: string): ParsedEntities['timeRange'] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (/今天/.test(query)) {
    return { type: 'today', dateFrom: today, dateTo: today };
  }
  if (/昨天/.test(query)) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { type: 'yesterday', dateFrom: yesterday.toISOString().slice(0, 10), dateTo: yesterday.toISOString().slice(0, 10) };
  }
  if (/最近|近期|刚出|突发/.test(query)) {
    const recent = new Date(now);
    recent.setDate(recent.getDate() - 30);
    return { type: 'recent', dateFrom: recent.toISOString().slice(0, 10) };
  }
  if (/之前|历史|以前|过去/.test(query)) {
    return { type: 'historical' };
  }
  return undefined;
}

// ---- Intent → Route Mapping ----

function intentToRoute(intent: QueryIntent, method: 'llm' | 'regex'): SourceRoute {
  const intentName = intent.intent;
  const weights = { ...WEIGHT_PROFILES[intentName] };

  const route: SourceRoute = {
    intent: intentName,
    docTypeBoosts: {},
    weights,
    retrievalPlan: buildRetrievalPlan(intentName),
    recencyFirst: false,
    expandRelated: false,
    method,
  };

  if (intent.rewritten) {
    route.rewrittenQuery = intent.rewritten;
  } else {
    // LLM 没返回改写时，用正则改写
    const rewritten = rewriteViaRegex('', intentName);
    if (rewritten) route.rewrittenQuery = rewritten;
  }

  // Multi-Query 扩展（LLM 提供时使用）
  if (intent.expanded && intent.expanded.length > 0) {
    route.expandedQueries = intent.expanded;
  }

  switch (intentName) {
    case 'recency':
      route.docTypeBoosts.raw = 1.5;
      route.docTypeBoosts.material = 2.5;
      route.docTypeBoosts.viewpoint = 2.0;
      route.docTypeBoosts.daily_review = 1.5;
      route.recencyFirst = true;
      break;
    case 'verification':
      route.docTypeBoosts.material = 1.8;
      route.docTypeBoosts.viewpoint = 2.0;
      route.docTypeBoosts.stock_profile = 2.0;
      break;
    case 'chain':
      route.expandRelated = true;
      route.docTypeBoosts.theme_research = 2.5;
      route.docTypeBoosts.material = 1.3;
      route.docTypeBoosts.stock_profile = 1.5;
      break;
    case 'stock_deep':
      route.docTypeBoosts.material = 2.0;
      route.docTypeBoosts.stock_profile = 2.0;
      route.docTypeBoosts.theme_research = 1.3;
      break;
    case 'market_review':
      route.docTypeBoosts.daily_review = 2.5;
      route.docTypeBoosts.viewpoint = 1.3;
      route.docTypeBoosts.material = 1.2;
      break;
    case 'general':
      break;
  }

  // 统一降权 QA 历史文档（避免 QA 标题精确匹配污染检索）
  route.docTypeBoosts.qa = 0.3;

  return route;
}

// ---- Public API ----

/** 补充实体和时间到 route */
async function enrichRoute(route: SourceRoute, query: string): Promise<SourceRoute> {
  // 正则改写
  if (!route.rewrittenQuery) {
    const rewritten = rewriteViaRegex(query, route.intent);
    if (rewritten !== query) route.rewrittenQuery = rewritten;
  }
  // 实体提取
  if (!route.entities) {
    try {
      route.entities = await extractEntities(query);
    } catch { /* ignore */ }
  }
  // 时间解析
  if (!route.retrievalPlan.filters.dateFrom && !route.retrievalPlan.filters.dateTo) {
    const timeRange = parseTimeRange(query);
    if (timeRange?.dateFrom) route.retrievalPlan.filters.dateFrom = timeRange.dateFrom;
    if (timeRange?.dateTo) route.retrievalPlan.filters.dateTo = timeRange.dateTo;
  }
  // 实体注入检索计划 filter（general 意图不硬过滤，让向量检索自己判断）
  if (route.entities && route.intent !== 'general') {
    if (route.entities.stocks.length > 0) {
      route.retrievalPlan.filters.stocks = route.entities.stocks.map(s => s.name);
    }
    if (route.entities.themes.length > 0) {
      route.retrievalPlan.filters.themes = route.entities.themes;
      // 主题 filter 扩展：如"光纤"自动包含"光通信""光纤光缆"等
      try {
        const related = await getRelatedThemes(route.entities.themes);
        if (related.length > 0) {
          const all = new Set([...route.entities.themes, ...related]);
          route.retrievalPlan.filters.themes = [...all];
        }
      } catch { /* ignore */ }
    }
    // 双向实体扩展：主题→公司 / 公司→主题，不依赖 intent 类型
    if (route.entities.themes.length > 0 || route.entities.stocks.length > 0) {
      const base = route.rewrittenQuery || query;
      // 主题→相关公司
      let relatedStocks: string[] = []; try { relatedStocks = await getRelatedStocks(route.entities.themes); } catch (err) { console.error('[source-router] 主题→公司扩展失败:', err); }
      for (const stock of relatedStocks) {
        const eq = base + ' ' + stock;
        if (!route.expandedQueries?.includes(eq)) {
          if (!route.expandedQueries) route.expandedQueries = [];
          route.expandedQueries.push(eq);
        }
      }
      // 公司→相关主题
      const stockNames = route.entities.stocks.map(s => s.name);
      let relatedThemes: string[] = []; try { relatedThemes = await getRelatedThemes(stockNames); } catch (err) { console.error('[source-router] 公司→主题扩展失败:', err); }
      for (const theme of relatedThemes) {
        const eq = base + ' ' + theme;
        if (!route.expandedQueries?.includes(eq)) {
          if (!route.expandedQueries) route.expandedQueries = [];
          route.expandedQueries.push(eq);
        }
      }
    }
  }
  // recency + verification 扩展查询
  recencyExpansion(route, query);
  verificationExpansion(route, query);
  return route;
}

export async function routeQuerySource(query: string): Promise<SourceRoute> {
  // 1. 先跑正则评分（即时，零成本）
  const regexResult = classifyViaRegex(query);

  // 2. 高分且领先 → 直接用正则结果，跳过 LLM
  if (regexResult._scores && regexResult._scores.length > 1) {
    const top = regexResult._scores[0];
    const second = regexResult._scores[1];
    if (top.score > 0 && top.score >= second.score * 2) {
      const r1 = await enrichRoute(intentToRoute(regexResult, 'regex'), query);
      r1.intentScores = regexResult._scores?.map(s => ({ intent: s.intent, score: s.score, matched: s.matched }));
      return r1;
    }
  }

  // 3. 模糊或低分 → 尝试 LLM（3s 超时）
  const llmResult = await classifyViaLLM(query);
  if (llmResult) {
    const r3 = await enrichRoute(intentToRoute(llmResult, 'llm'), query);
    r3.intentScores = regexResult._scores?.map(s => ({ intent: s.intent, score: s.score, matched: s.matched }));
    return r3;
  }

  // 4. LLM 失败 → 用正则的最高分
  const r2 = await enrichRoute(intentToRoute(regexResult, 'regex'), query);
  r2.intentScores = regexResult._scores?.map(s => ({ intent: s.intent, score: s.score, matched: s.matched }));
  return r2;
}

/** recency 意图补充 Multi-Query 扩展查询 */
function recencyExpansion(route: SourceRoute, query: string) {
  if (route.intent !== 'recency') return;
  const base = route.rewrittenQuery || query;
  const expanded = [base];
  const topic = base.replace(/(最近|最新|今天|昨天|催化|动态|新闻|公告|有没有|有什么|是什么|关于)\s*/g, '').trim();
  if (topic && topic !== base) expanded.push(topic);
  const suffixes = ['业绩 订单 公告', '技术 进展 量产', '公司 供应链 格局', '观点 展望 判断'];
  for (const suffix of suffixes) {
    const extended = topic + ' ' + suffix;
    if (extended.trim() !== base && !expanded.includes(extended.trim())) {
      expanded.push(extended.trim());
      if (expanded.length >= 4) break;
    }
  }
  route.expandedQueries = [...new Set(expanded)].slice(0, 4);
}

/** verification 意图：剥离验证语义词，生成纯实体关键词查询 */
function verificationExpansion(route: SourceRoute, query: string) {
  if (route.intent !== 'verification') return;
  const base = route.rewrittenQuery || query;
  const expanded = [base];

  // 剥离验证语义词，提取纯事实关键词
  const topic = base
    .replace(/(验证|证实|证伪|是否|有没有|会不会|真的|假的|能不能|能否|兑现|应验|取代|替代|已经|落地|量产|过剩)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (topic && topic !== base) expanded.push(topic);

  // 如果识别到了股票实体，加一条精确的"股票名 + 财务关键词"查询
  if (route.entities?.stocks && route.entities.stocks.length > 0) {
    for (const stock of route.entities.stocks) {
      const precise = stock.name + ' 业绩 营收 财报 数据';
      if (!expanded.includes(precise)) expanded.push(precise);
    }
  }

  // 如果 query 包含数字（如 Q1、192%），加一条精确数字匹配
  const numbers = query.match(/[Qq]\d|\d+[%％]/g);
  if (numbers && numbers.length > 0) {
    const topicParts = topic.split(/\s+/).filter(s => s.length > 0);
    const heads = topicParts.slice(0, 2).join(' ');
    if (heads) {
      const numericQuery = heads + ' ' + numbers.join(' ');
      if (!expanded.includes(numericQuery) && numericQuery !== base) {
        expanded.push(numericQuery);
      }
    }
  }

  route.expandedQueries = [...new Set(expanded)].slice(0, 4);
}
