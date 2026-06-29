/**
 * 多角度查询生成。
 * 对特定意图自动生成多个检索角度，覆盖不同分析维度。
 * 结果合并到 source-router 的 expandedQueries 中。
 */

import type { ParsedEntities } from './types';

/** 查询角度生成器 */
type AngleGenerator = (query: string, entities?: ParsedEntities) => string[];

/** 各意图的角度生成器 */
const ANGLE_GENERATORS: Record<string, AngleGenerator> = {
  stock_deep: (query, entities) => {
    const stockName = entities?.stocks?.[0]?.name ?? '';
    const themes = entities?.themes ?? [];
    const angles: string[] = [];

    // 基本面角度
    angles.push(`${query} 业绩 财务 估值`);
    // 技术/产品角度
    if (stockName) angles.push(`${stockName} 技术 产品 产能 订单`);
    // 产业链角度
    if (themes.length > 0) angles.push(`${themes[0]} 产业链 供需 格局`);
    // 消息面角度
    angles.push(`${query} 催化 新闻 进展`);

    return angles;
  },

  chain: (query, entities) => {
    const themes = entities?.themes ?? [];
    const angles: string[] = [];

    // 下游角度
    if (themes.length > 0) angles.push(`${themes[0]} 下游 需求 应用`);
    // 上游角度
    if (themes.length > 0) angles.push(`${themes[0]} 上游 供应商 材料`);
    // 竞争格局角度
    if (themes.length > 0) angles.push(`${themes[0]} 竞争 格局 龙头 市占率`);
    // 政策/技术角度
    if (themes.length > 0) angles.push(`${themes[0]} 政策 技术 演进 趋势`);

    return angles;
  },

  market_review: (query) => {
    return [
      `${query} 情绪 周期 冰点 高潮`,
      `${query} 主线 板块 轮动 龙头`,
      `${query} 资金 流向 成交额 赚钱效应`,
    ];
  },

  verification: (query, entities) => {
    const stockName = entities?.stocks?.[0]?.name ?? '';
    const angles = [`${query} 验证 数据 事实`];
    if (stockName) angles.push(`${stockName} 业绩 订单 兑现 验证`);
    return angles;
  },

  value_analysis: (query, entities) => {
    const stockName = entities?.stocks?.[0]?.name ?? '';
    const themes = entities?.themes ?? [];
    const angles: string[] = [];

    // 成长性角度
    angles.push(`${query} 成长性 增速 空间 天花板`);
    // 竞争格局角度
    if (themes.length > 0) angles.push(`${themes[0]} 竞争格局 龙头 市占率`);
    else if (stockName) angles.push(`${stockName} 竞争格局 优势 壁垒`);
    // 估值角度
    angles.push(`${query} 估值 PE PEG 性价比`);
    // 催化角度
    angles.push(`${query} 催化 催化剂 拐点`);

    return angles;
  },

  policy_impact: (query, entities) => {
    const themes = entities?.themes ?? [];
    const angles: string[] = [];

    // 政策内容角度
    angles.push(`${query} 政策 内容 细则 落地`);
    // 影响角度
    if (themes.length > 0) angles.push(`${themes[0]} 影响 利好 利空`);
    else angles.push(`${query} 影响 受益 受损`);
    // 政策对比角度
    angles.push(`${query} 对比 历史 力度`);

    return angles;
  },

  risk_alert: (query, entities) => {
    const stockName = entities?.stocks?.[0]?.name ?? '';
    const angles: string[] = [];

    // 风险事件角度
    angles.push(`${query} 风险 违约 警示`);
    // 财务角度
    if (stockName) angles.push(`${stockName} 财务 审计 负债 现金流`);
    // 监管角度
    angles.push(`${query} 监管 处罚 立案`);
    // 市场角度
    angles.push(`${query} 股价 跌幅 评级 下调`);

    return angles;
  },
};

/**
 * 为查询生成多角度搜索关键词。
 * @returns 扩展查询列表（已去重），无匹配时返回空数组
 */
export function generateMultiAngleQueries(
  intent: string,
  query: string,
  entities?: ParsedEntities,
): string[] {
  const generator = ANGLE_GENERATORS[intent];
  if (!generator) return [];
  return generator(query, entities);
}
