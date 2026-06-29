import type { DocumentType } from '@/lib/types/document';
import type { RagSearchHit } from '@/lib/rag/types';

export type ResearchDepth = 'quick' | 'standard' | 'deep';
export type ResearchFocus = 'comprehensive' | 'technical' | 'fundamental' | 'news';

export interface ResearchConfig {
  depth: ResearchDepth;
  focus: ResearchFocus;
  debate: boolean;
}

export interface ResearchPlan {
  title: string;
  subQuestions: string[];
  depth: ResearchDepth;
}

export type ResearchConfidence = 'high' | 'medium' | 'low';

export interface ResearchEvidenceItem {
  id: string;
  claim: string;
  sourceDocId: string;
  chunkId: string;
  title: string;
  snippet: string;
  score: number;
  confidence: ResearchConfidence;
  usedInSection: string;
  needsCheck: boolean;
}

export interface ResearchTaskCoverage {
  subQuestion: string;
  status: 'pending' | 'searching' | 'evidence_found' | 'summarized' | 'insufficient';
  evidenceIds: string[];
  summary?: string;
}

export interface ResearchReportContract {
  terminalDemand: string;
  valueChain: string;
  newConstraints: string;
  investmentJudgment: string;
  aStockMapping: string;
  verificationTimeline: string;
  references: Array<{ id: string; title: string }>;
}

export interface ResearchReportValidation {
  requiredSections: string[];
  presentSections: string[];
  missingSections: string[];
  citedEvidenceIds: string[];
  uncitedEvidenceIds: string[];
  citationCoverageRate: number;
  insufficientQuestions: string[];
  warnings: string[];
  passed: boolean;
  repaired?: boolean;
  repairNotes?: string[];
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

export interface ResearchReportRepair {
  report: string;
  repaired: boolean;
  repairNotes: string[];
}

export interface ResearchReportFallback {
  report: string;
  used: boolean;
  reason?: string;
}

export interface ResearchQualityAssessment {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  dimensions: {
    coverage: number;
    evidence: number;
    structure: number;
    citation: number;
  };
  reasons: string[];
  blockers: string[];
}

export interface ResearchBudget {
  maxSubQuestions: number;
  minEvidence: number;
  presearchTopK: number;
  evidencePerQuestion: number;
  maxSteps: number;
  debateRounds: number;
}

export const RESEARCH_REPORT_SECTIONS = [
  '核心结论',
  '终端需求变化',
  '产业链拆解',
  '新增约束',
  '供需错配',
  '公司与A股映射',
  '投资判断',
  '分歧与反证',
  '3/6/12个月验证清单',
  '引用来源',
] as const;

export const FOCUS_GUIDES: Record<ResearchFocus, string> = {
  comprehensive: '均衡覆盖技术、产业、公司、催化、风险与验证清单。',
  technical: '优先技术路线、工艺设备、材料、核心器件、国产替代率、客户验证周期。',
  fundamental: '优先公司、产能、客户、订单、毛利率、价值量占比、财务与估值映射。',
  news: '优先近期催化、政策、价格、招标、供需变化、公告与可证伪数据。',
};

export const FOCUS_RAG_OPTIONS: Record<
  ResearchFocus,
  {
    sourceBoosts?: Partial<Record<DocumentType, number>>;
    weights?: { vector: number; keyword: number; metadata: number; freshness: number };
  }
> = {
  comprehensive: {},
  technical: {
    sourceBoosts: { material: 2.4, theme_research: 2.0, note: 1.4, raw: 1.3 },
    weights: { vector: 0.42, keyword: 0.18, metadata: 0.28, freshness: 0.12 },
  },
  fundamental: {
    sourceBoosts: { stock_profile: 2.4, theme_research: 1.8, viewpoint: 1.3 },
    weights: { vector: 0.46, keyword: 0.2, metadata: 0.24, freshness: 0.1 },
  },
  news: {
    sourceBoosts: { daily_review: 2.6, viewpoint: 1.7, raw: 1.5, note: 1.2 },
    weights: { vector: 0.25, keyword: 0.28, metadata: 0.12, freshness: 0.35 },
  },
};

export function getResearchBudget(depth: ResearchDepth): ResearchBudget {
  if (depth === 'quick') {
    return { maxSubQuestions: 3, minEvidence: 5, presearchTopK: 5, evidencePerQuestion: 2, maxSteps: 3, debateRounds: 1 };
  }
  if (depth === 'deep') {
    return { maxSubQuestions: 7, minEvidence: 16, presearchTopK: 8, evidencePerQuestion: 4, maxSteps: 10, debateRounds: 3 };
  }
  return { maxSubQuestions: 5, minEvidence: 10, presearchTopK: 6, evidencePerQuestion: 3, maxSteps: 6, debateRounds: 2 };
}

const REQUIRED_RESEARCH_QUESTIONS = [
  '终端需求变化来自哪里，需求增速和应用场景是什么',
  '产业链从终端应用到系统、模块、核心器件、设备、材料和原材料如何拆解',
  '哪些环节出现新增约束，供需是否可能偏紧或涨价',
  '相关中国公司和A股标的如何映射，哪些是中军、弹性、材料端、设备端和伪概念',
  '未来3个月、6个月、12个月分别应该跟踪哪些验证和证伪数据',
];

export function buildResearchSubQuestions(
  question: string,
  planQuestions: string[],
  depth: ResearchDepth,
): string[] {
  const budget = getResearchBudget(depth);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of [...planQuestions, ...REQUIRED_RESEARCH_QUESTIONS]) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= budget.maxSubQuestions) break;
  }

  return result.length ? result : [question];
}

export function createInitialCoverage(subQuestions: string[]): ResearchTaskCoverage[] {
  return subQuestions.map((subQuestion) => ({
    subQuestion,
    status: 'pending',
    evidenceIds: [],
  }));
}

export function confidenceFromScore(score: number): ResearchConfidence {
  if (score >= 0.72) return 'high';
  if (score >= 0.48) return 'medium';
  return 'low';
}

export function inferReportSection(text: string): string {
  if (/需求|终端|训练|推理|AI PC|机器人|数据中心|端侧/.test(text)) return '终端需求变化';
  if (/产业链|上下游|系统|模块|器件|设备|材料|原材料|化学品|气体/.test(text)) return '产业链拆解';
  if (/约束|瓶颈|卡点|供需|扩产|涨价|国产化|验证/.test(text)) return '新增约束';
  if (/公司|A股|标的|中军|弹性|材料端|设备端|伪概念/.test(text)) return '公司与A股映射';
  if (/风险|反证|分歧|估值|透支|误炒/.test(text)) return '分歧与反证';
  if (/3个月|6个月|12个月|验证|证伪|跟踪/.test(text)) return '3/6/12个月验证清单';
  return '投资判断';
}

export function normalizeSnippet(value: string, maxLength = 360): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

export function evidenceFromHit(
  hit: RagSearchHit,
  index: number,
  subQuestion: string,
): ResearchEvidenceItem {
  const heading = hit.chunk.headingPath.join(' > ') || '正文';
  const score = Number(hit.finalScore.toFixed(4));

  return {
    id: `E${String(index).padStart(2, '0')}`,
    claim: `${subQuestion} | ${hit.chunk.title} / ${heading}`,
    sourceDocId: hit.chunk.docId,
    chunkId: hit.chunk.id,
    title: hit.chunk.title,
    snippet: normalizeSnippet(hit.chunk.content),
    score,
    confidence: confidenceFromScore(score),
    usedInSection: inferReportSection(`${subQuestion} ${hit.chunk.title} ${heading}`),
    needsCheck: score < 0.48,
  };
}

export function buildEvidenceLedgerText(items: ResearchEvidenceItem[]): string {
  if (!items.length) return '暂无证据。无证据结论必须标注“待验证”。';

  return items.map((item) => [
    `[${item.id}] ${item.claim}`,
    `来源: ${item.title} / docId=${item.sourceDocId} / chunkId=${item.chunkId} / score=${item.score} / confidence=${item.confidence}`,
    `适用章节: ${item.usedInSection}`,
    `摘录: ${item.snippet}`,
  ].join('\n')).join('\n\n');
}

export function buildCoverageText(items: ResearchTaskCoverage[]): string {
  if (!items.length) return '暂无子问题。';

  return items.map((item, index) => [
    `${index + 1}. ${item.subQuestion}`,
    `状态: ${item.status}`,
    `证据: ${item.evidenceIds.length ? item.evidenceIds.join(', ') : '无'}`,
    item.summary ? `摘要: ${item.summary}` : '',
  ].filter(Boolean).join(' | ')).join('\n');
}

export function buildResearchReportInstruction(): string {
  return [
    '最终报告必须使用以下 Markdown 章节，章节名保持一致：',
    ...RESEARCH_REPORT_SECTIONS.map((section) => `## ${section}`),
    '',
    '输出逻辑必须始终遵循：需求变化 -> 产业瓶颈 -> 供需错配 -> 公司映射 -> 股价预期差。',
    '所有关键判断必须引用证据编号，例如 [E01]；没有证据支持的判断必须明确标注“待验证”。',
    '“产业链拆解”必须覆盖终端应用、系统/整机、模块、核心器件、工艺设备、材料、原材料/化学品/金属/气体。',
    '“新增约束”必须回答需求增长最快、扩产最慢、国产化率最低、验证最长、可能涨价、市场认知不足的环节。',
    '“公司与A股映射”必须区分中军标的、弹性标的、材料端标的、设备端标的、后排补涨、伪概念。',
    '“3/6/12个月验证清单”必须列出未来3个月、6个月、12个月观察项和可证伪数据。',
  ].join('\n');
}

export function validateResearchReport(
  report: string,
  evidence: ResearchEvidenceItem[],
  coverage: ResearchTaskCoverage[],
): ResearchReportValidation {
  const presentSections = RESEARCH_REPORT_SECTIONS.filter((section) => {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'm');
    return pattern.test(report);
  });
  const missingSections = RESEARCH_REPORT_SECTIONS.filter((section) => !presentSections.includes(section));

  const evidenceIds = evidence.map((item) => item.id);
  const citedEvidenceIds = evidenceIds.filter((id) => new RegExp(`\\[${escapeRegExp(id)}\\]`).test(report));
  const citedSet = new Set(citedEvidenceIds);
  const uncitedEvidenceIds = evidenceIds.filter((id) => !citedSet.has(id));
  const citationCoverageRate = evidenceIds.length ? citedEvidenceIds.length / evidenceIds.length : 0;
  const insufficientQuestions = coverage
    .filter((item) => item.status === 'insufficient')
    .map((item) => item.subQuestion);

  const warnings: string[] = [];
  if (missingSections.length) {
    warnings.push(`缺少固定章节: ${missingSections.join(', ')}`);
  }
  if (evidenceIds.length > 0 && citedEvidenceIds.length === 0) {
    warnings.push('报告没有引用任何Evidence编号');
  } else if (evidenceIds.length > 0 && citationCoverageRate < 0.35) {
    warnings.push(`Evidence引用覆盖率偏低: ${(citationCoverageRate * 100).toFixed(0)}%`);
  }
  if (insufficientQuestions.length && !report.includes('待验证')) {
    warnings.push('存在证据不足子问题，但报告未显式标注“待验证”');
  }

  return {
    requiredSections: [...RESEARCH_REPORT_SECTIONS],
    presentSections,
    missingSections,
    citedEvidenceIds,
    uncitedEvidenceIds,
    citationCoverageRate,
    insufficientQuestions,
    warnings,
    passed: missingSections.length === 0
      && (evidenceIds.length === 0 || citedEvidenceIds.length > 0)
      && warnings.length === 0,
  };
}

export function repairResearchReport(
  report: string,
  evidence: ResearchEvidenceItem[],
  coverage: ResearchTaskCoverage[],
): ResearchReportRepair {
  let nextReport = report.trim();
  const repairNotes: string[] = [];

  if (!nextReport) {
    nextReport = '## 核心结论\n待验证：模型未生成有效报告。';
    repairNotes.push('补齐空报告的核心结论占位');
  }

  const validation = validateResearchReport(nextReport, evidence, coverage);
  for (const section of validation.missingSections) {
    nextReport += `\n\n## ${section}\n${defaultSectionFallback(section)}`;
    repairNotes.push(`补齐缺失章节: ${section}`);
  }

  const insufficientQuestions = coverage.filter((item) => item.status === 'insufficient');
  if (insufficientQuestions.length && !nextReport.includes('待验证')) {
    nextReport += [
      '',
      '### 证据不足项',
      ...insufficientQuestions.map((item) => `- 待验证：${item.subQuestion}${item.summary ? `（${item.summary}）` : ''}`),
    ].join('\n');
    repairNotes.push('补齐证据不足项的待验证标注');
  }

  if (evidence.length && !nextReport.includes('### Evidence索引') && !hasReferenceEvidenceList(nextReport, evidence)) {
    nextReport += '\n\n### Evidence索引\n' + evidence.map((item) => {
      const check = item.needsCheck ? '，待复核' : '';
      return `- [${item.id}] ${item.title}（docId=${item.sourceDocId}, chunkId=${item.chunkId}, score=${item.score}${check}）`;
    }).join('\n');
    repairNotes.push('补齐Evidence索引');
  }

  return {
    report: nextReport,
    repaired: repairNotes.length > 0,
    repairNotes,
  };
}

export function isMeaningfulResearchReport(report: string): boolean {
  const compact = report.replace(/[#>*_\-\s`|]/g, '');
  if (compact.length < 180) return false;

  const lines = report.split('\n').map((line) => line.trim()).filter(Boolean);
  const placeholderLines = lines.filter((line) => /^(待验证|资料不足|无证据|暂无|模型未生成)/.test(line)).length;
  if (lines.length > 0 && placeholderLines / lines.length > 0.45) return false;

  const usefulSections = RESEARCH_REPORT_SECTIONS.filter((section) => {
    const match = report.match(new RegExp(`^##\\s+${escapeRegExp(section)}\\s*\\n([\\s\\S]*?)(?=^##\\s+|$)`, 'm'));
    const body = match?.[1]?.replace(/\s+/g, '') ?? '';
    return body.length > 30 && !/^(待验证|资料不足|无证据|暂无)/.test(body);
  });

  return usefulSections.length >= 3;
}

export function buildEvidenceBasedFallbackReport(params: {
  question: string;
  title?: string;
  evidence: ResearchEvidenceItem[];
  coverage: ResearchTaskCoverage[];
}): ResearchReportFallback {
  const evidence = params.evidence;
  const topEvidence = [...evidence].sort((a, b) => b.score - a.score).slice(0, 5);
  const insufficient = params.coverage.filter((item) => item.status === 'insufficient');
  const title = params.title || `${params.question} 深度研究`;

  const lines: string[] = [
    `# ${title}`,
    '',
    '## 核心结论',
  ];

  if (topEvidence.length) {
    lines.push(
      `本报告为基于本次RAG检索证据生成的确定性草稿。共纳入 ${evidence.length} 条Evidence，优先展示已命中的事实与待验证缺口。`,
      ...topEvidence.slice(0, 3).map((item) => `- ${item.claim}：${item.snippet} [${item.id}]`),
    );
  } else {
    lines.push('待验证：本次未获得可用Evidence，无法形成有效投资结论。');
  }

  lines.push(
    '',
    '## 终端需求变化',
    sectionEvidenceText('终端需求变化', evidence, '待验证：本次证据未充分覆盖终端需求来源、训练/推理/AI PC/机器人/端侧AI等需求变化。'),
    '',
    '## 产业链拆解',
    sectionEvidenceText('产业链拆解', evidence, '待验证：本次证据未充分覆盖终端应用、系统/整机、模块、核心器件、设备、材料、原材料链条。'),
    '',
    '## 新增约束',
    sectionEvidenceText('新增约束', evidence, '待验证：本次证据未充分覆盖扩产周期、国产化率、客户验证、价格弹性和市场认知差。'),
    '',
    '## 供需错配',
    sectionEvidenceText('新增约束', evidence, '待验证：需要继续验证需求增长与供给扩产之间是否形成错配。'),
    '',
    '## 公司与A股映射',
    sectionEvidenceText('公司与A股映射', evidence, '待验证：本次证据未充分覆盖中军、弹性、材料端、设备端、后排补涨和伪概念。'),
    '',
    '## 投资判断',
  );

  if (topEvidence.length) {
    lines.push(
      '当前只能形成证据驱动的初步判断：优先跟踪证据中反复出现的产业链节点，尚不能直接外推出确定性投资结论。',
      ...topEvidence.slice(0, 3).map((item) => `- 关注方向：${item.usedInSection}，依据 ${item.title} [${item.id}]。`),
    );
  } else {
    lines.push('待验证：证据不足，暂不形成投资判断。');
  }

  lines.push(
    '',
    '## 分歧与反证',
    insufficient.length
      ? insufficient.map((item) => `- 待验证：${item.subQuestion}${item.summary ? `（${item.summary}）` : ''}`).join('\n')
      : '待验证：需要继续补充反方证据、价格数据、订单兑现、扩产节奏和估值透支风险。',
    '',
    '## 3/6/12个月验证清单',
    '- 未来3个月：跟踪订单、招标、价格、公告和客户验证进展。',
    '- 未来6个月：跟踪产能释放、毛利率变化、国产替代进度和关键客户导入。',
    '- 未来12个月：跟踪技术路线切换、竞争格局变化、资本开支和证伪数据。',
    '',
    '## 引用来源',
    evidence.length
      ? evidence.map((item) => `- [${item.id}] ${item.title}（docId=${item.sourceDocId}, chunkId=${item.chunkId}, score=${item.score}）`).join('\n')
      : '资料不足：无Evidence来源。',
  );

  return {
    report: lines.join('\n'),
    used: true,
    reason: '模型未生成有意义正文，已改用Evidence生成确定性草稿',
  };
}

export function assessResearchQuality(params: {
  evidence: ResearchEvidenceItem[];
  coverage: ResearchTaskCoverage[];
  validation: ResearchReportValidation;
  minEvidence: number;
}): ResearchQualityAssessment {
  const coverageTotal = params.coverage.length;
  const coverageDone = params.coverage.filter((item) => item.status === 'summarized' || item.status === 'evidence_found').length;
  const coverageScore = coverageTotal ? coverageDone / coverageTotal : 0;
  const evidenceScore = params.minEvidence > 0 ? Math.min(params.evidence.length / params.minEvidence, 1) : 1;
  const structureScore = params.validation.requiredSections.length
    ? params.validation.presentSections.length / params.validation.requiredSections.length
    : 1;
  const citationScore = params.evidence.length ? params.validation.citationCoverageRate : 0;

  const weightedScore = Math.round((
    coverageScore * 0.3
    + evidenceScore * 0.25
    + structureScore * 0.2
    + citationScore * 0.25
  ) * 100);

  const reasons: string[] = [];
  const blockers: string[] = [];

  if (coverageScore < 1) reasons.push(`子问题覆盖不足: ${coverageDone}/${coverageTotal}`);
  if (params.evidence.length < params.minEvidence) reasons.push(`证据数量不足: ${params.evidence.length}/${params.minEvidence}`);
  if (params.validation.missingSections.length) reasons.push(`报告结构缺失: ${params.validation.missingSections.join(', ')}`);
  if (params.evidence.length && citationScore < 0.35) reasons.push(`Evidence引用覆盖偏低: ${(citationScore * 100).toFixed(0)}%`);
  if (params.validation.repaired) reasons.push('报告经过自动结构修复');

  if (!params.evidence.length) blockers.push('未获得任何Evidence');
  if (params.validation.citedEvidenceIds.length === 0 && params.evidence.length > 0) blockers.push('报告未引用Evidence编号');
  if (params.coverage.some((item) => item.status === 'insufficient')) blockers.push('存在证据不足子问题');

  return {
    score: weightedScore,
    grade: scoreToGrade(weightedScore),
    dimensions: {
      coverage: Math.round(coverageScore * 100),
      evidence: Math.round(evidenceScore * 100),
      structure: Math.round(structureScore * 100),
      citation: Math.round(citationScore * 100),
    },
    reasons,
    blockers,
  };
}

function scoreToGrade(score: number): ResearchQualityAssessment['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function defaultSectionFallback(section: string): string {
  if (section === '引用来源') return '资料不足：未生成引用来源。';
  if (section === '3/6/12个月验证清单') return '待验证：当前报告未生成验证清单。';
  if (section === '分歧与反证') return '待验证：当前报告未生成反证分析。';
  return '待验证：当前报告未覆盖该章节。';
}

function sectionEvidenceText(section: string, evidence: ResearchEvidenceItem[], fallback: string): string {
  const matched = evidence.filter((item) => item.usedInSection === section).slice(0, 5);
  if (!matched.length) return fallback;
  return matched.map((item) => `- ${item.claim}：${item.snippet} [${item.id}]`).join('\n');
}

function hasReferenceEvidenceList(report: string, evidence: ResearchEvidenceItem[]): boolean {
  const match = report.match(/^##\s+引用来源\s*\n([\s\S]*?)(?=^##\s+|$)/m);
  const body = match?.[1] ?? '';
  return evidence.some((item) => body.includes(`[${item.id}]`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
