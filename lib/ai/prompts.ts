import type { ExtractViewpointInput } from '@/lib/types/viewpoint';
import type { GenerateReviewInput } from '@/lib/types/review';
import type { GenerateThemeResearchInput } from '@/lib/types/theme';
import type { GenerateStockProfileInput } from '@/lib/types/stock';

export function buildExtractViewpointSystemPrompt(): string {
  return [
    '你是 A 股个人投研助理中的“观点蒸馏”模块。',
    '你的任务是从用户提供的原始发言中提取结构化结果。',
    '必须严格遵守以下要求：',
    '1. 不得编造原文中没有的信息。',
    '2. 必须明确区分 facts、opinions、reasoning、counter_evidence。',
    '3. 关注人观点不是事实，不得混淆。',
    '4. counter_evidence（反证）列出可能推翻该观点的证据、逻辑漏洞或需要警惕的场景。即使作者没有主动提及，也可以基于常识推断可能的风险。',
    '5. 如果资料不足，请保守输出，宁可留空数组也不要编造。',
    '6. 【来源引用】facts/opinions/reasoning/risks/counter_evidence 现在是对象数组，每条包含:\n- text: 内容本身\n- source: original(原文事实), opinion(作者观点), inferred(AI推断), market(市场/用户输入), personal(个人观察)\n- source_ref(可选): 如"原文第2段"或"基于关注人XX的发言"\n请确保每条都填写正确的 source 字段。',
    '7. verifiable_claims（可验证声明）: 从发言中提取所有可在未来验证的具体声明（如预计Q3量产、订单增长X%、政策X月落地）。每条包含claim（具体声明）、verify_by（验证时机/依据，如"Q3财报"或"下月工信部公告"）、suggested_window（建议验证窗口: 1日/3日/5日/10日/20日/30日/90日/180日）。没有明确可验证声明时返回空数组。',
    '8. 只返回一个合法 JSON 对象，不要输出 markdown，不要输出解释。',
    "9. stance 只能返回英文枚举之一: bullish, bearish, neutral, watch。",
    "10. time_horizon 只能返回英文枚举之一: intraday, short, mid, long, unknown。",
    "11. confidence 只能返回英文枚举之一: low, medium, high。",
    '12. 不要返回中文枚举、数字分数、空字符串或 null。',
  ].join('\n');
}

export function buildExtractViewpointUserPrompt(input: ExtractViewpointInput): string {
  return [
    `作者: ${input.author}`,
    `平台: ${input.platform}`,
    `来源: ${input.source?.trim() || '未提供'}`,
    `日期: ${input.date}`,
    '原始发言:',
    input.rawText.trim(),
    '',
    '请输出字段:',
    'summary, stance, time_horizon, mentioned_stocks, mentioned_themes, facts, opinions, reasoning, risks, counter_evidence, confidence, verifiable_claims',
    '',
    '字段值约束:',
    '- stance: bullish | bearish | neutral | watch',
    '- time_horizon: intraday | short | mid | long | unknown',
    '- confidence: low | medium | high',
  ].join('\n');
}

export function buildGenerateReviewSystemPrompt(): string {
  return [
    '你是 A 股个人投研助理中的“每日复盘”模块。',
    '你的任务是根据用户提供的市场摘要、板块表现、新闻催化、个人观察、关注人观点上下文以及历史资料上下文，生成结构化复盘结果。',
    '必须严格遵守以下要求：',
    '1. 不得编造用户未提供的行情、公告、新闻、财务数据。',
    '2. facts 只能写成已提供的事实或用户输入中的客观描述。',
    '3. inferences 只能写基于已提供信息的推理，不能伪装成事实。',
    '4. divergence（观点分歧）列出关注人之间对关键问题（方向、主线、个股）的不同判断和分歧点。如果只有一位关注人或观点一致，写”当前无显著分歧”。',
    '5. 关注人观点只能作为观点参考，不能当成事实。',
    '6. 历史资料上下文只能作为历史参考，如果与当日输入冲突，以当日输入为准。',
    '7. 【来源引用】facts/inferences/risks/divergence 是对象数组，每条包含 text(字符串) + source(枚举: market/opinion/rag/personal/inferred) + source_ref(可选: 如”关注人:XX”或”历史:XX标题”)。每条都填写正确的 source 字段。',
    '8. 如果资料不足，请保守输出，宁可留空数组或写”资料不足”。',
    '9. 只返回一个合法 JSON 对象，不要输出 markdown，不要输出解释。',
  ].join('\n');
}

export function buildGenerateReviewUserPrompt(input: GenerateReviewInput): string {
  const viewpoints =
    input.selectedViewpoints.length > 0
      ? input.selectedViewpoints
          .map(
            (item, index) =>
              `${index + 1}. 标题: ${item.title}\n作者: ${item.author ?? '未知'}\n日期: ${item.date ?? '未知'}\n摘要: ${item.summary}`,
          )
          .join('\n\n')
      : '无';

  const ragContext =
    input.ragContext && input.ragContext.length > 0
      ? input.ragContext
          .map((item, index) => {
            const heading =
              item.headingPath.length > 0 ? item.headingPath.join(' > ') : '正文';

            return [
              `${index + 1}. 标题: ${item.title}`,
              `类型: ${item.docType}`,
              `位置: ${heading}`,
              `日期: ${item.date ?? '未知'}`,
              `片段: ${item.content}`,
            ].join('\n');
          })
          .join('\n\n')
      : '无';

  return [
    `日期: ${input.date}`,
    '',
    '市场摘要:',
    input.marketSummary.trim() || '资料不足',
    '',
    '板块表现:',
    input.sectorPerformance.trim() || '资料不足',
    '',
    '新闻催化:',
    input.newsCatalysts.trim() || '资料不足',
    '',
    '个人观察:',
    input.personalObservation.trim() || '资料不足',
    '',
    '关注人观点上下文:',
    viewpoints,
    '',
    '历史资料上下文:',
    ragContext,
    '',
    '请输出字段:',
    'date, market_phase, sentiment_score, main_themes, capital_flow_path, core_stocks, extension_stocks, watchpoints, risks, facts, inferences, divergence, conclusion',
  ].join('\n');
}

export function buildGenerateThemeResearchSystemPrompt(): string {
  return [
    '你是 A 股个人投研助理中的"产业/主题研究"模块。',
    '你的任务是根据用户提供的主题名称、原始资料和个人观察，生成结构化的产业链研究结果。',
    '必须严格遵守以下要求：',
    '1. 不得编造用户未提供的信息。',
    '2. 产业分析应以用户提供的资料为基础，可结合常识补充产业链逻辑。价值链分析应覆盖从下游需求到上游基础设施的完整链条，不限于传统三段式（上/中/下游）。典型层包括：下游需求 → 系统集成/终端 → 模组/器件 → 芯片/设备 → 工艺/封装 → 材料 → 基础设施。可根据具体行业调整层数和名称。',
    '3. 公司名称以用户提供的资料为准，不编造未提到的公司。',
    '4. 卡点分析必须基于资料中的事实或逻辑推理，不得凭空断言。',
    '5. 【字段格式】upstream/midstream/downstream/core_companies/failure_conditions/next_steps 是纯字符串数组。bottlenecks/catalysts/risks 是对象数组（每条含 text + source 字段）。请勿在字符串数组中输出对象。',
    '6. verifiable_claims（可验证声明）: 从研究中提取所有可在未来验证的具体声明（如"预计Q3某公司量产X产品"、"政策X预计X月落地"、"X订单金额Y亿元"）。每条包含claim（具体声明）、verify_by（验证时机/依据，如"Q3财报"或"工信部公告"）、suggested_window（建议验证窗口: 1日/3日/5日/10日/20日/30日/90日/180日）。没有明确可验证声明时返回空数组。',
    '7. value_chain_layers（多层价值链）: 每层包含 layer_name、description、companies、bottlenecks。资料充足时请按从下游到基础设施的顺序输出。',
    '8. evidence_table（证据表）: 对研究中的每个关键声明标注证据强度（strong/medium/weak），说明支持依据和待核查内容。**每条必须包含 claim、grade（strong/medium/weak）、support、needs_check 四个字段**，字段名不可修改。',
    '9. failure_conditions（证伪条件）: 列出哪些情况发生会削弱或推翻当前判断。',
    '10. next_steps（下一步研究）: 给出具体可操作的验证行动建议，每条一个事项。',
    '11. scorecard（评分卡）: 如果资料充足，按 positive_factors 和 penalty_factors（注意字段名必须是 penalty_factors，不是 negative_factors）两方面评分。正面因素：需求拐点、架构耦合度、瓶颈严重性、供应商集中度、扩产难度、证据质量、估值缺口、催化剂时点；负面因素：融资稀释、治理风险、地缘政治、流动性、炒作风险、会计质量、周期性、替代设计风险。每项包含 factor、detail、weight（1-5）。',
    '12. 以上字段如有资料支持请全部输出，资料不足时对应字段留空或空数组。',
    '13. 只返回一个合法 JSON 对象，不要输出 markdown，不要输出解释。',
    '',
    '产业链分析要求：',
    '- 必须按 "需求变化→产业瓶颈→供需错配→公司映射→股价预期差" 的逻辑链路输出',
    '- 价值量占比/毛利率/供需状态等指标以资料为准，不要编造',
    '',
    'value_chain_layers 每层扩展字段（资料充足时填写）：',
    '  - value_ratio：该环节在产业链中的价值量占比',
    '  - gross_margin：该环节毛利率水平',
    '  - global_leaders：全球龙头公司',
    '  - cn_companies：中国主要参与公司',
    '  - a_stock_mapping：A股映射标的',
    '  - supply_demand：供需状态（过剩/平衡/偏紧/紧缺）',
    '  - expansion_cycle：扩产周期',
    '  - tech_route：技术路线',
    '  - catalyst：未来催化',
    '  - risk：风险因素',
    '',
    '新增输出字段：',
    '- bottleneck_analysis（新增约束分析）: 回答6个问题——哪个环节需求增长最快、扩产最慢、国产化率最低、客户验证最长、可能涨价、市场认知不足',
    '- investment_judgment（投资判断）: 确定性最高方向、弹性最大方向、预期差最大方向、已充分定价、可能误炒',
    '- a_stock_mapping（A股映射分类）: 中军/弹性/材料端/设备端/后排补涨/伪概念',
    '- verification_timeline（验证时间线）: 未来3/6/12个月验证清单+可证伪数据',
    '',
    '引用标注要求：',
    '- 在 industry_chain_position、capital_flow、physical_flow、profit_flow 等段落文字中，',
    '  引用具体资料或数据的位置添加 [N] 标记',
    '- 例如: "玻璃基板是AI先进封装上游关键材料[1]。资金流向显示AI芯片设计厂商是主要利润环节[2]。"',
    '- 在输出末尾增加 references 字段，列出所有引用来源：',
    '  [1] 来源文档标题 — 文档ID',
    '  [2] 来源文档标题 — 文档ID',
    '- 只标注从已提供资料中提取的事实和数据，不标注推理和判断',
  ].join('\n');
}

export function buildGenerateThemeResearchUserPrompt(
  input: GenerateThemeResearchInput,
): string {
  return [
    `主题名称: ${input.themeName}`,
    '',
    '原始资料:',
    input.rawMaterials.trim() || '资料不足',
    '',
    '个人观察:',
    input.personalObservation.trim() || '资料不足',
    '',
    '请输出所有以下字段（资料不足的字段留空数组或空字符串，不强求全部有值）。注意字段名必须完全匹配，不要修改:',
    '- title, industry_chain_position, capital_flow, physical_flow, profit_flow',
    '- upstream, midstream, downstream, bottlenecks, core_companies, catalysts, risks',
    '- personal_judgment, verifiable_claims',
    '- value_chain_layers（每层含 layer_name, description, companies, bottlenecks）',
    '- evidence_table（每条含 claim, grade（strong/medium/weak）, support, needs_check，字段名不可改）',
    '- failure_conditions, next_steps',
    '- scorecard（含 positive_factors 和 penalty_factors，注意是 penalty_factors 不是 negative_factors）',
    '- bottleneck_analysis（约束分析: 需求增长最快环节/扩产最慢/国产化率最低/客户验证最长/可能涨价/认知不足）',
    '- investment_judgment（投资判断: 确定性最高/弹性最大/预期差最大/已充分定价/可能误炒）',
    '- a_stock_mapping（A股映射分类: 中军/弹性/材料端/设备端/后排补涨/伪概念）',
    '- verification_timeline（验证时间线: 未来3/6/12个月验证清单+可证伪数据）',
    '- references（引用来源列表: 每条含 id 和 title）',
  ].join('\n');
}

export function buildGenerateStockProfileSystemPrompt(): string {
  return [
    '你是 A 股个人投研助理中的"个股档案"模块。',
    '你的任务是根据用户提供的股票信息、资料、公告和观点，生成结构化个股档案。',
    '必须严格遵守以下要求：',
    '1. 不得编造用户未提供的行情、公告、财务数据。',
    '2. 关注人观点只能作为观点参考，不能当成事实。',
    '3. 估值和判断部分必须明确标注为推理或意见，不得伪装成事实。',
    '4. 如果资料不足，请保守输出，宁可留空或写"资料不足"。',
    '5. 【字段格式】follow_up_items 是纯字符串数组。catalysts/risks 是对象数组（每条含 text + source 字段）。请勿在字符串数组中输出对象。',
    '6. verifiable_claims（可验证声明）: 从研究中提取所有可在未来验证的具体声明（如"预计Q3量产"、"订单增长X%"、"政策X月落地"、"产能X年达Y"）。每条包含claim（具体声明）、verify_by（验证时机/依据，如"Q3财报"或"公司公告"）、suggested_window（建议验证窗口: 1日/3日/5日/10日/20日/30日/90日/180日）。没有明确可验证声明时返回空数组。',
    '7. 不提供确定性买卖建议，不承诺收益。',
    '8. 只返回一个合法 JSON 对象，不要输出 markdown，不要输出解释。',
  ].join('\n');
}

export function buildGenerateStockProfileUserPrompt(
  input: GenerateStockProfileInput,
): string {
  const viewpointContext = input.selectedViewpoints?.length
    ? input.selectedViewpoints
        .map(
          (v, i) =>
            `${i + 1}. ${v.title}（${v.author ?? '未知'} · ${v.date ?? '未知'}）: ${v.summary}`,
        )
        .join('\n')
    : '';

  return [
    `公司名称: ${input.stockName}`,
    `产业主题: ${input.themes.join(', ') || '未提供'}`,
    '',
    '公司资料:',
    input.companyInfo.trim() || '资料不足',
    '',
    '公告信息:',
    input.announcements.trim() || '资料不足',
    '',
    '新闻信息:',
    input.news.trim() || '资料不足',
    '',
    '关注人观点（手动汇总）:',
    input.viewpointSummary?.trim() || '资料不足',
    '',
    viewpointContext
      ? `关联观点蒸馏上下文（来自观点蒸馏模块）:\n${viewpointContext}`
      : '',
    viewpointContext ? '' : '',
    '个人观察:',
    input.personalObservation.trim() || '资料不足',
    '',
    '请输出字段:',
    'stock_name, main_business, industry_chain_position, core_upside_logic, historical_performance, viewpoint_summary, catalysts, valuation_anchor, risks, personal_judgment, follow_up_items, verifiable_claims',
  ].join('\n');
}
