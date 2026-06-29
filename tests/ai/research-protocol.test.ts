import { describe, expect, it } from 'vitest';
import {
  buildResearchReportInstruction,
  buildResearchSubQuestions,
  createInitialCoverage,
  evidenceFromHit,
  assessResearchQuality,
  buildEvidenceBasedFallbackReport,
  isMeaningfulResearchReport,
  repairResearchReport,
  validateResearchReport,
} from '@/lib/ai/research-protocol';
import type { RagSearchHit } from '@/lib/rag/types';

describe('research protocol helpers', () => {
  it('expands and caps sub questions by depth', () => {
    const quick = buildResearchSubQuestions('AI液冷产业链', ['冷板供需', 'CDU格局', '泵阀材料', 'A股映射'], 'quick');
    const deep = buildResearchSubQuestions('AI液冷产业链', ['冷板供需'], 'deep');

    expect(quick).toHaveLength(3);
    expect(deep.length).toBeGreaterThanOrEqual(5);
    expect(deep.length).toBeLessThanOrEqual(7);
    expect(deep.some((q) => q.includes('A股'))).toBe(true);
  });

  it('creates pending coverage for each sub question', () => {
    const coverage = createInitialCoverage(['需求变化', '供需错配']);

    expect(coverage).toEqual([
      { subQuestion: '需求变化', status: 'pending', evidenceIds: [] },
      { subQuestion: '供需错配', status: 'pending', evidenceIds: [] },
    ]);
  });

  it('builds stable evidence from a rag hit', () => {
    const hit: RagSearchHit = {
      chunk: {
        id: 'chunk-1',
        docId: 'doc-1',
        docPath: 'data/themes/liquid-cooling.md',
        docType: 'theme_research',
        title: '液冷产业链研究',
        headingPath: ['材料', '冷板'],
        content: '冷板和接头材料是液冷系统中需要跟踪的关键环节，客户验证周期较长。',
      },
      vectorScore: 0.8,
      keywordScore: 0.7,
      metadataScore: 0.6,
      freshnessScore: 0.5,
      finalScore: 0.83,
    };

    const evidence = evidenceFromHit(hit, 1, '液冷产业链有哪些新增约束');

    expect(evidence.id).toBe('E01');
    expect(evidence.sourceDocId).toBe('doc-1');
    expect(evidence.chunkId).toBe('chunk-1');
    expect(evidence.confidence).toBe('high');
    expect(evidence.usedInSection).toBe('产业链拆解');
  });

  it('requires the fixed industry-chain report structure', () => {
    const instruction = buildResearchReportInstruction();

    expect(instruction).toContain('## 终端需求变化');
    expect(instruction).toContain('## 产业链拆解');
    expect(instruction).toContain('## 公司与A股映射');
    expect(instruction).toContain('需求变化 -> 产业瓶颈 -> 供需错配 -> 公司映射 -> 股价预期差');
  });

  it('validates report sections and evidence citation coverage', () => {
    const evidence = [
      {
        id: 'E01',
        claim: '液冷需求来自AI数据中心',
        sourceDocId: 'doc-1',
        chunkId: 'chunk-1',
        title: '液冷产业链研究',
        snippet: 'AI数据中心推动液冷需求。',
        score: 0.8,
        confidence: 'high' as const,
        usedInSection: '终端需求变化',
        needsCheck: false,
      },
      {
        id: 'E02',
        claim: '冷板扩产周期较长',
        sourceDocId: 'doc-2',
        chunkId: 'chunk-2',
        title: '冷板材料研究',
        snippet: '冷板客户验证周期较长。',
        score: 0.7,
        confidence: 'medium' as const,
        usedInSection: '新增约束',
        needsCheck: false,
      },
    ];
    const coverage = createInitialCoverage(['终端需求', '冷板瓶颈']);
    coverage[0] = { ...coverage[0], status: 'summarized', evidenceIds: ['E01'] };
    coverage[1] = { ...coverage[1], status: 'insufficient', evidenceIds: [] };
    const report = [
      '## 核心结论',
      '液冷需求明确 [E01]，冷板瓶颈待验证。',
      '## 终端需求变化',
      '## 产业链拆解',
      '## 新增约束',
      '## 供需错配',
      '## 公司与A股映射',
      '## 投资判断',
      '## 分歧与反证',
      '## 3/6/12个月验证清单',
      '## 引用来源',
    ].join('\n');

    const validation = validateResearchReport(report, evidence, coverage);

    expect(validation.missingSections).toEqual([]);
    expect(validation.citedEvidenceIds).toEqual(['E01']);
    expect(validation.uncitedEvidenceIds).toEqual(['E02']);
    expect(validation.insufficientQuestions).toEqual(['冷板瓶颈']);
    expect(validation.warnings).toEqual([]);
    expect(validation.passed).toBe(true);
  });

  it('repairs missing sections and appends evidence index deterministically', () => {
    const evidence = [
      {
        id: 'E01',
        claim: '液冷需求来自AI数据中心',
        sourceDocId: 'doc-1',
        chunkId: 'chunk-1',
        title: '液冷产业链研究',
        snippet: 'AI数据中心推动液冷需求。',
        score: 0.8,
        confidence: 'high' as const,
        usedInSection: '终端需求变化',
        needsCheck: false,
      },
    ];
    const coverage = createInitialCoverage(['液冷需求']);
    coverage[0] = { ...coverage[0], status: 'summarized', evidenceIds: ['E01'] };

    const repair = repairResearchReport('## 核心结论\n液冷需求明确。', evidence, coverage);
    const validation = validateResearchReport(repair.report, evidence, coverage);

    expect(repair.repaired).toBe(true);
    expect(repair.repairNotes).toContain('补齐缺失章节: 引用来源');
    expect(repair.report).toContain('## 终端需求变化');
    expect(repair.report).toContain('### Evidence索引');
    expect(repair.report).toContain('[E01]');
    expect(validation.missingSections).toEqual([]);
  });

  it('builds a meaningful evidence fallback report when model output is empty', () => {
    const evidence = [
      {
        id: 'E01',
        claim: '液冷需求来自AI数据中心 | 液冷产业链研究 / 需求',
        sourceDocId: 'doc-1',
        chunkId: 'chunk-1',
        title: '液冷产业链研究',
        snippet: 'AI数据中心功率密度提升推动液冷方案渗透。',
        score: 0.82,
        confidence: 'high' as const,
        usedInSection: '终端需求变化',
        needsCheck: false,
      },
      {
        id: 'E02',
        claim: '冷板材料扩产周期较长 | 冷板材料研究 / 卡点',
        sourceDocId: 'doc-2',
        chunkId: 'chunk-2',
        title: '冷板材料研究',
        snippet: '冷板、接头和泵阀需要客户验证，扩产节奏慢于需求变化。',
        score: 0.76,
        confidence: 'high' as const,
        usedInSection: '新增约束',
        needsCheck: false,
      },
    ];
    const coverage = createInitialCoverage(['液冷需求', '冷板瓶颈']);
    coverage[0] = { ...coverage[0], status: 'summarized', evidenceIds: ['E01'] };
    coverage[1] = { ...coverage[1], status: 'summarized', evidenceIds: ['E02'] };

    const fallback = buildEvidenceBasedFallbackReport({
      question: 'AI数据中心液冷产业链有哪些新增瓶颈',
      title: 'AI液冷产业链深度研究',
      evidence,
      coverage,
    });

    expect(fallback.used).toBe(true);
    expect(fallback.report).toContain('AI数据中心功率密度提升推动液冷方案渗透。 [E01]');
    expect(fallback.report).toContain('冷板、接头和泵阀需要客户验证');
    expect(fallback.report).toContain('## 引用来源');
    expect(isMeaningfulResearchReport(fallback.report)).toBe(true);
  });

  it('scores research quality from coverage, evidence, structure and citations', () => {
    const evidence = [
      {
        id: 'E01',
        claim: '液冷需求来自AI数据中心',
        sourceDocId: 'doc-1',
        chunkId: 'chunk-1',
        title: '液冷产业链研究',
        snippet: 'AI数据中心推动液冷需求。',
        score: 0.8,
        confidence: 'high' as const,
        usedInSection: '终端需求变化',
        needsCheck: false,
      },
    ];
    const coverage = createInitialCoverage(['液冷需求', '冷板瓶颈']);
    coverage[0] = { ...coverage[0], status: 'summarized', evidenceIds: ['E01'] };
    coverage[1] = { ...coverage[1], status: 'insufficient', evidenceIds: [] };
    const repair = repairResearchReport('## 核心结论\n液冷需求明确 [E01]。', evidence, coverage);
    const validation = validateResearchReport(repair.report, evidence, coverage);

    const quality = assessResearchQuality({ evidence, coverage, validation, minEvidence: 4 });

    expect(quality.dimensions).toEqual({
      coverage: 50,
      evidence: 25,
      structure: 100,
      citation: 100,
    });
    expect(quality.score).toBe(66);
    expect(quality.grade).toBe('C');
    expect(quality.reasons).toContain('子问题覆盖不足: 1/2');
    expect(quality.reasons).toContain('证据数量不足: 1/4');
    expect(quality.blockers).toContain('存在证据不足子问题');
  });
});
