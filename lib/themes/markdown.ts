import type { ThemeResearchResult, ValueChainLayer, EvidenceItem } from '@/lib/types/theme';

function renderSection(title: string, items: string[]): string {
  if (!items.length) return `## ${title}\n资料不足`;
  return `## ${title}\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** 多层价值链渲染 */
function renderValueChainLayers(layers: ValueChainLayer[]): string {
  if (!layers?.length) return '';
  const parts = layers.map((layer) => {
    const lines = [
      `### ${layer.layer_name}`,
      layer.description,
      `核心公司: ${layer.companies.join(', ') || '无'}`,
    ];
    if (layer.value_ratio) lines.push(`价值量占比: ${layer.value_ratio}`);
    if (layer.gross_margin) lines.push(`毛利率: ${layer.gross_margin}`);
    if (layer.global_leaders?.length) lines.push(`全球龙头: ${layer.global_leaders.join(', ')}`);
    if (layer.cn_companies?.length) lines.push(`中国公司: ${layer.cn_companies.join(', ')}`);
    if (layer.a_stock_mapping?.length) lines.push(`A股映射: ${layer.a_stock_mapping.join(', ')}`);
    if (layer.supply_demand) lines.push(`供需状态: ${layer.supply_demand}`);
    if (layer.expansion_cycle) lines.push(`扩产周期: ${layer.expansion_cycle}`);
    if (layer.tech_route) lines.push(`技术路线: ${layer.tech_route}`);
    if (layer.bottleneck_detail) lines.push(`卡点详情: ${layer.bottleneck_detail}`);
    if (layer.catalysts?.length) lines.push(`催化: ${layer.catalysts.join(', ')}`);
    if (layer.risks?.length) lines.push(`风险: ${layer.risks.join(', ')}`);
    if (layer.bottlenecks?.length) {
      lines.push(`卡点:\n${layer.bottlenecks.map((b) => `- ${b.text}${b.source !== 'unknown' ? ` [${b.source}]` : ''}`).join('\n')}`);
    }
    return lines.join('\n');
  });
  return `## 价值链全图\n\n${parts.join('\n\n')}`;
}

/** 渲染证据表 */
function renderEvidenceTable(items: EvidenceItem[]): string {
  if (!items?.length) return '';
  const rows = items.map(
    (item) =>
      `| ${item.claim} | ${item.grade === 'strong' ? '强' : item.grade === 'medium' ? '中' : '弱'} | ${item.support} | ${item.needs_check} |${item.source_ref ? ` ${item.source_ref} |` : ' |'}`,
  );
  return `## 证据表\n\n| 声明 | 强度 | 支持依据 | 待核查 | 来源 |\n|------|------|---------|--------|------|\n${rows.join('\n')}`;
}

/** 渲染评分卡 */
function renderScorecard(scorecard: NonNullable<ThemeResearchResult['scorecard']>): string {
  const parts: string[] = ['## 评分卡\n'];
  if (scorecard.positive_factors?.length) {
    parts.push('### 正面因素');
    scorecard.positive_factors.forEach((f) => {
      parts.push(`- ${f.factor}: ${f.detail}${f.weight ? `（权重: ${f.weight}）` : ''}`);
    });
  }
  if (scorecard.penalty_factors?.length) {
    parts.push('### 负面因素');
    scorecard.penalty_factors.forEach((f) => {
      parts.push(`- ${f.factor}: ${f.detail}${f.weight ? `（权重: ${f.weight}）` : ''}`);
    });
  }
  if (scorecard.summary) {
    parts.push(`\n**综合判断**: ${scorecard.summary}`);
  }
  return parts.join('\n');
}

/** 中文数字映射 */
const CN = ['零','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','二十一','二十二','二十三','二十四','二十五'];

function renderBottleneckAnalysis(bottleneck: NonNullable<ThemeResearchResult['bottleneck_analysis']>): string {
  const items: string[] = [];
  if (bottleneck.fastest_growth) items.push(`- 需求增长最快环节: ${bottleneck.fastest_growth}`);
  if (bottleneck.slowest_expansion) items.push(`- 扩产最慢环节: ${bottleneck.slowest_expansion}`);
  if (bottleneck.lowest_localization) items.push(`- 国产化率最低环节: ${bottleneck.lowest_localization}`);
  if (bottleneck.longest_validation) items.push(`- 客户验证最长环节: ${bottleneck.longest_validation}`);
  if (bottleneck.most_likely_price_up) items.push(`- 可能涨价环节: ${bottleneck.most_likely_price_up}`);
  if (bottleneck.least_understood) items.push(`- 市场认知不足环节: ${bottleneck.least_understood}`);
  if (!items.length) return '';
  return `## 新增约束分析\n\n${items.join('\n')}`;
}

function renderInvestmentJudgment(judgment: NonNullable<ThemeResearchResult['investment_judgment']>): string {
  const items: string[] = [];
  if (judgment.highest_certainty) items.push(`- 确定性最高方向: ${judgment.highest_certainty}`);
  if (judgment.highest_elasticity) items.push(`- 弹性最大方向: ${judgment.highest_elasticity}`);
  if (judgment.biggest_gap) items.push(`- 预期差最大方向: ${judgment.biggest_gap}`);
  if (judgment.fully_priced) items.push(`- 已充分定价方向: ${judgment.fully_priced}`);
  if (judgment.may_be_misunderstood) items.push(`- 可能误炒方向: ${judgment.may_be_misunderstood}`);
  if (!items.length) return '';
  return `## 投资判断\n\n${items.join('\n')}`;
}

function renderAStockMapping(mapping: NonNullable<ThemeResearchResult['a_stock_mapping']>): string {
  const items: string[] = [];
  if (mapping.core?.length) items.push(`- 中军标的: ${mapping.core.join(', ')}`);
  if (mapping.high_beta?.length) items.push(`- 弹性标的: ${mapping.high_beta.join(', ')}`);
  if (mapping.material?.length) items.push(`- 材料端标的: ${mapping.material.join(', ')}`);
  if (mapping.equipment?.length) items.push(`- 设备端标的: ${mapping.equipment.join(', ')}`);
  if (mapping.laggard?.length) items.push(`- 后排补涨: ${mapping.laggard.join(', ')}`);
  if (mapping.fake_concept?.length) items.push(`- 伪概念: ${mapping.fake_concept.join(', ')}`);
  if (!items.length) return '';
  return `## A股映射\n\n${items.join('\n')}`;
}

function renderVerificationTimeline(timeline: NonNullable<ThemeResearchResult['verification_timeline']>): string {
  const items: string[] = [];
  if (timeline.next_3_months?.length) items.push(`### 未来3个月\n${timeline.next_3_months.map(t => `- ${t}`).join('\n')}`);
  if (timeline.next_6_months?.length) items.push(`### 未来6个月\n${timeline.next_6_months.map(t => `- ${t}`).join('\n')}`);
  if (timeline.next_12_months?.length) items.push(`### 未来12个月\n${timeline.next_12_months.map(t => `- ${t}`).join('\n')}`);
  if (timeline.falsification_data?.length) items.push(`### 可证伪数据\n${timeline.falsification_data.map(t => `- ${t}`).join('\n')}`);
  if (!items.length) return '';
  return `## 验证时间线\n\n${items.join('\n\n')}`;
}

export function buildThemeResearchMarkdown(params: {
  title: string;
  themeName: string;
  rawMaterials: string;
  personalObservation: string;
  result: ThemeResearchResult;
  appendedMaterials?: string;
}): string {
  const { rawMaterials, personalObservation, result, title } = params;
  const generatedAt = new Date().toISOString();

  const sections: string[] = [
    `# ${title}`,
    '',
    `> 生成时间: ${generatedAt}`,
    '',
    '---',
    '',
    '## 引用素材',
    '',
    rawMaterials.trim() || '资料不足',
    '',
    '## 个人观察',
    '',
    personalObservation.trim() || '资料不足',
    '',
    '---',
    '',
    '## 一、产业链位置',
    result.industry_chain_position || '资料不足',
    '',
    '## 二、资金流',
    result.capital_flow || '资料不足',
    '',
    '## 三、实物流',
    result.physical_flow || '资料不足',
    '',
    '## 四、利润流',
    result.profit_flow || '资料不足',
    '',
    renderSection('五、上游', result.upstream),
    '',
    renderSection('六、中游', result.midstream),
    '',
    renderSection('七、下游', result.downstream),
    '',
    renderSection('八、当前卡点', result.bottlenecks.map(function(i) { return i.text; })),
    '',
    renderSection('九、核心公司', result.core_companies),
    '',
    renderSection('十、催化日历', result.catalysts.map(function(i) { return i.text; })),
    '',
    renderSection('十一、风险传导', result.risks.map(function(i) { return i.text; })),
  ];

  // 新增可选节段（仅当对应字段存在时输出）
  if (result.value_chain_layers?.length) {
    sections.push('', renderValueChainLayers(result.value_chain_layers));
  }
  if (result.evidence_table?.length) {
    sections.push('', renderEvidenceTable(result.evidence_table));
  }
  if (result.failure_conditions?.length) {
    sections.push('', renderSection('十四、证伪条件', result.failure_conditions));
  }
  if (result.next_steps?.length) {
    sections.push('', renderSection('十五、下一步研究', result.next_steps));
  }
  if (result.scorecard) {
    sections.push('', renderScorecard(result.scorecard));
  }

  // 新增字段节段
  if (result.bottleneck_analysis) {
    sections.push('', renderBottleneckAnalysis(result.bottleneck_analysis));
  }
  if (result.investment_judgment) {
    sections.push('', renderInvestmentJudgment(result.investment_judgment));
  }
  if (result.a_stock_mapping) {
    sections.push('', renderAStockMapping(result.a_stock_mapping));
  }
  if (result.verification_timeline) {
    sections.push('', renderVerificationTimeline(result.verification_timeline));
  }

  // 个人判断（编号根据前面实际出现的节段动态计算）
  let sectionNum = 11; // 一至十一
  if (result.value_chain_layers?.length) sectionNum++;
  if (result.evidence_table?.length) sectionNum++;
  if (result.failure_conditions?.length) sectionNum++;
  if (result.next_steps?.length) sectionNum++;
  if (result.scorecard) sectionNum++;
  if (result.bottleneck_analysis) sectionNum++;
  if (result.investment_judgment) sectionNum++;
  if (result.a_stock_mapping) sectionNum++;
  if (result.verification_timeline) sectionNum++;
  sections.push('', `## ${CN[sectionNum + 1]}、个人判断`);
  sections.push(result.personal_judgment || personalObservation.trim() || '资料不足');

  // 渲染引用标签 [N] → <sup> 标签
  const rendered = sections.join('\n').replace(/\[(\d+)\]/g, (_m: string, num: string) => {
    const idx = parseInt(num) - 1;
    const ref = result.references?.[idx];
    if (ref) {
      return `<sup class="md-source-tag md-source-original" title="${ref.title}" style="cursor:help">[${num}]</sup>`;
    }
    return `<sup class="md-source-tag" style="cursor:help">[${num}]</sup>`;
  });

  // 如果有引用，在末尾添加引用来源列表
  if (result.references?.length) {
    return rendered + '\n\n---\n\n## 引用来源\n' + result.references.map((ref, i) => `[${i + 1}] ${ref.title}`).join('\n');
  }

  return rendered;
}

/** 从 Markdown 正文解析原始输入（用于编辑时回填表单） */
export function parseThemeMarkdown(content: string): {
  personalObservation: string;
} {
  const obsMatch = content.match(/## 个人观察\n+([\s\S]*?)(?=\n---|\n## |$)/);
  return {
    personalObservation: (obsMatch?.[1] || '').trim(),
  };
}
