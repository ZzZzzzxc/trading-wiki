import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildLocalDocumentIndex } from '@/lib/storage/build-index';
import { writeMarkdownDocument, deleteMarkdownDocument } from '@/lib/storage/md-store';
import { upsertRagDocument, removeRagDocument } from '@/lib/rag/rebuild';
import { readDocumentIndex } from '@/lib/storage/index-store';
import { readMarkdownDocument } from '@/lib/storage/md-store';
import { DATA_DIRECTORIES } from '@/lib/storage/paths';
import { slugify } from '@/lib/storage/slug';
import { dailyReviewGenerationSchema } from '@/lib/types/review';
import { viewpointExtractionSchema, viewpointPlatforms } from '@/lib/types/viewpoint';
import { themeResearchGenerationSchema } from '@/lib/types/theme';
import { stockProfileGenerationSchema } from '@/lib/types/stock';
import { buildReviewMarkdown } from '@/lib/reviews/markdown';
import { buildViewpointMarkdown } from '@/lib/viewpoints/markdown';
import { buildThemeResearchMarkdown } from '@/lib/themes/markdown';
import { buildStockProfileMarkdown } from '@/lib/stocks/markdown';
import {
  archiveViewpointRaw,
  archiveReviewRaw,
} from '@/lib/storage/raw-archive';
import { createFact } from '@/lib/storage/fact-store';
import { materialSchema } from '@/lib/types/material';
import { evidenceLevelLabels } from '@/lib/types/fact';
import { documentTypes } from '@/lib/types/document';
import type { FactWindow } from '@/lib/types/fact';

/** 解析 AI 建议的验证窗口 → 天数 */
function parseWindowDays(suggested: string): number | null {
  const match = suggested.match(/(\d+)\s*日/);
  if (match) return parseInt(match[1]);
  const map: Record<string, number> = { '1日': 1, '3日': 3, '5日': 5, '10日': 10, '20日': 20, '30日': 30, '90日': 90, '180日': 180 };
  return map[suggested.trim()] ?? null;
}

/** 为给定的天数构建验证窗口 */
function buildFactWindows(now: string, days: number[]): FactWindow[] {
  const base = new Date(now);
  const labels = ['1日', '3日', '5日', '10日', '20日', '30日', '90日', '180日'];
  return days.map((d) => {
    const due = new Date(base);
    due.setDate(due.getDate() + d);
    const label = labels.find((l) => l.startsWith(String(d))) || `${d}日`;
    return { label, dueDate: due.toISOString().slice(0, 10), result: null, note: '' };
  });
}

const ragContextItemSchema = z.object({
  id: z.string(),
  docId: z.string(),
  docPath: z.string(),
  docType: z.enum(documentTypes),
  title: z.string(),
  headingPath: z.array(z.string()),
  content: z.string(),
  date: z.string().optional(),
  author: z.string().optional(),
  platform: z.string().optional(),
  score: z.number().optional(),
});

const createViewpointSchema = z.object({
  type: z.literal('viewpoint'),
  author: z.string().min(1, '作者不能为空'),
  platform: z.enum(viewpointPlatforms),
  date: z.string().min(1, '日期不能为空'),
  source: z.string().trim().optional(),
  rawText: z.string().min(1, '原始发言不能为空'),
  extraction: viewpointExtractionSchema,
});

const createDailyReviewSchema = z.object({
  type: z.literal('daily_review'),
  date: z.string().min(1, '日期不能为空'),
  marketSummary: z.string(),
  sectorPerformance: z.string(),
  newsCatalysts: z.string(),
  personalObservation: z.string(),
  ragContext: z.array(ragContextItemSchema).optional(),
  selectedViewpoints: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      author: z.string().optional(),
      date: z.string().optional(),
    }),
  ),
  generation: dailyReviewGenerationSchema,
});

const createThemeResearchSchema = z.object({
  type: z.literal('theme_research'),
  themeName: z.string().min(1, '主题名称不能为空'),
  rawMaterials: z.string().optional().default(''),
  personalObservation: z.string().optional().default(''),
  appendedMaterials: z.string().optional(),
  generation: themeResearchGenerationSchema,
});

const stockViewpointContextSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  author: z.string().optional(),
  date: z.string().optional(),
});

const createStockProfileSchema = z.object({
  type: z.literal('stock_profile'),
  stockName: z.string().min(1, '公司名称不能为空'),
  themes: z.array(z.string()).optional().default([]),
  companyInfo: z.string().optional().default(''),
  announcements: z.string().optional().default(''),
  news: z.string().optional().default(''),
  viewpointSummary: z.string().optional().default(''),
  personalObservation: z.string().optional().default(''),
  appendedMaterials: z.string().optional(),
  selectedViewpoints: z.array(stockViewpointContextSchema).optional(),
  generation: stockProfileGenerationSchema,
});

const createNoteSchema = z.object({
  type: z.literal('note'),
  title: z.string().min(1, '标题不能为空'),
  date: z.string().optional(),
  themes: z.array(z.string()).optional(),
  stocks: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  content: z.string(),
});

const createMaterialSchema = z.object({
  type: z.literal('material'),
  title: z.string().min(1, '标题不能为空'),
  date: z.string().min(1, '日期不能为空'),
  stocks: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  content: z.string().min(1, '素材内容不能为空'),
  record: materialSchema,
});

const createDocumentSchema = z.discriminatedUnion('type', [
  createViewpointSchema,
  createDailyReviewSchema,
  createThemeResearchSchema,
  createStockProfileSchema,
  createNoteSchema,
  createMaterialSchema,
]);

async function saveViewpoint(input: z.infer<typeof createViewpointSchema>) {
  // 原始发言自动归档
  await archiveViewpointRaw({
    author: input.author,
    platform: input.platform,
    date: input.date,
    source: input.source,
    rawText: input.rawText,
  });

  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString(36);
  const title = `${input.author}观点蒸馏`;
  const fileSlug = slugify(`${input.date}-${input.author}-${uniqueSuffix}`);
  const absolutePath = path.join(DATA_DIRECTORIES.viewpoints, `${fileSlug}.md`);

  await writeMarkdownDocument({
    absolutePath,
    frontmatter: {
      type: 'viewpoint',
      title,
      date: input.date,
      author: input.author,
      platform: input.platform,
      source: input.source?.trim() || undefined,
      stance: input.extraction.stance,
      time_horizon: input.extraction.time_horizon,
      mentioned_stocks: input.extraction.mentioned_stocks,
      mentioned_themes: input.extraction.mentioned_themes,
      tags: [
        '观点蒸馏',
        input.author,
        ...input.extraction.mentioned_themes,
        ...input.extraction.mentioned_stocks,
      ],
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: buildViewpointMarkdown({
      title,
      rawText: input.rawText,
      extraction: input.extraction,
    }),
  });

  // 自动创建可验证断言（AI 提取的 verifiable_claims → facts 系统）
  const claims = input.extraction.verifiable_claims ?? [];
  for (const claim of claims) {
    if (claim.claim?.trim()) {
      // 解析建议窗口天数
      const windowDays = parseWindowDays(claim.suggested_window);
      const windows = windowDays
        ? buildFactWindows(timestamp, [windowDays])
        : undefined;
      createFact({
        claim: claim.claim.trim(),
        sourceDocId: fileSlug,
        sourceDocType: 'viewpoint',
        sourceTitle: title,
        stocks: input.extraction.mentioned_stocks ?? [],
        themes: input.extraction.mentioned_themes ?? [],
        evidenceLevel: 'D', // 关注人观点默认为 D 级（社交媒体来源）
        windows,
        notes: claim.verify_by ? `验证依据: ${claim.verify_by}` : '',
      }).catch((err) => { console.error('[documents] viewpoint 事实创建失败:', err); });
    }
  }

  return {
    type: 'viewpoint' as const,
    fileSlug,
  };
}

async function saveDailyReview(input: z.infer<typeof createDailyReviewSchema>) {
  // 复盘原始输入自动归档
  await archiveReviewRaw({
    date: input.date,
    marketSummary: input.marketSummary,
    sectorPerformance: input.sectorPerformance,
    newsCatalysts: input.newsCatalysts,
    personalObservation: input.personalObservation,
  });

  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString(36);
  const title = `${input.date} A股每日复盘`;
  const fileSlug = slugify(`${input.date}-${uniqueSuffix}`);
  const absolutePath = path.join(DATA_DIRECTORIES.dailyReviews, `${fileSlug}.md`);

  await writeMarkdownDocument({
    absolutePath,
    frontmatter: {
      type: 'daily_review',
      title,
      date: input.date,
      market_phase: input.generation.market_phase,
      themes: input.generation.main_themes,
      core_stocks: input.generation.core_stocks,
      stocks: [...input.generation.core_stocks, ...input.generation.extension_stocks],
      tags: ['每日复盘', ...input.generation.main_themes],
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: buildReviewMarkdown({
      title,
      inputs: {
        marketSummary: input.marketSummary,
        sectorPerformance: input.sectorPerformance,
        newsCatalysts: input.newsCatalysts,
        personalObservation: input.personalObservation,
        selectedViewpoints: input.selectedViewpoints,
        ragContext: input.ragContext,
      },
      result: input.generation,
    }),
  });

  return {
    type: 'daily_review' as const,
    fileSlug,
  };
}

async function saveThemeResearch(
  input: z.infer<typeof createThemeResearchSchema>,
) {
  // 原始资料已由素材库管理，不再自动归档

  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString(36);
  const title = `${input.themeName}产业链研究`;
  const fileSlug = slugify(`${input.themeName}-${uniqueSuffix}`);
  const absolutePath = path.join(DATA_DIRECTORIES.themes, `${fileSlug}.md`);

  await writeMarkdownDocument({
    absolutePath,
    frontmatter: {
      type: 'theme_research',
      title,
      themes: [input.themeName],
      tags: ['产业链', '资金流', '利润流', input.themeName],
      confidence: (input.generation.verifiable_claims?.length ?? 0) > 0 ? 'medium' : 'low',
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: buildThemeResearchMarkdown({
      title,
      themeName: input.themeName,
      rawMaterials: input.rawMaterials,
      personalObservation: input.personalObservation,
      appendedMaterials: input.appendedMaterials,
      result: input.generation,
    }),
  });

  // 自动创建可验证断言（主题研究 → facts 系统）
  const themeClaims = input.generation.verifiable_claims ?? [];
  for (const claim of themeClaims) {
    if (claim.claim?.trim()) {
      const windowDays = parseWindowDays(claim.suggested_window);
      const windows = windowDays
        ? buildFactWindows(timestamp, [windowDays])
        : undefined;
      createFact({
        claim: claim.claim.trim(),
        sourceDocId: fileSlug,
        sourceDocType: 'theme_research',
        sourceTitle: title,
        themes: [input.themeName],
        evidenceLevel: 'C', // 主题研究的推断默认 C 级
        windows,
        notes: claim.verify_by ? `验证依据: ${claim.verify_by}` : '',
      }).catch((err) => { console.error('[documents] theme 事实创建失败:', err); });
    }
  }

  return {
    type: 'theme_research' as const,
    fileSlug,
  };
}

async function saveStockProfile(
  input: z.infer<typeof createStockProfileSchema>,
) {
  // 原始资料已由素材库管理，不再自动归档

  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString(36);
  const title = `${input.stockName}个股档案`;
  const fileSlug = slugify(`${input.stockName}-${uniqueSuffix}`);
  const absolutePath = path.join(DATA_DIRECTORIES.stocks, `${fileSlug}.md`);

  await writeMarkdownDocument({
    absolutePath,
    frontmatter: {
      type: 'stock_profile',
      title,
      themes: input.themes,
      tags: ['个股档案', input.stockName, ...input.themes],
      confidence: (input.generation.verifiable_claims?.length ?? 0) > 0 ? 'medium' : 'low',
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: buildStockProfileMarkdown({
      title,
      stockName: input.stockName,
      themes: input.themes,
      companyInfo: input.companyInfo,
      announcements: input.announcements,
      news: input.news,
      viewpointSummary: input.viewpointSummary,
      personalObservation: input.personalObservation,
      appendedMaterials: input.appendedMaterials,
      selectedViewpoints: input.selectedViewpoints,
      result: input.generation,
    }),
  });

  // 自动创建可验证断言（个股研究 → facts 系统）
  const stockClaims = input.generation.verifiable_claims ?? [];
  for (const claim of stockClaims) {
    if (claim.claim?.trim()) {
      const windowDays = parseWindowDays(claim.suggested_window);
      const windows = windowDays
        ? buildFactWindows(timestamp, [windowDays])
        : undefined;
      createFact({
        claim: claim.claim.trim(),
        sourceDocId: fileSlug,
        sourceDocType: 'stock_profile',
        sourceTitle: title,
        stocks: [input.stockName],
        themes: input.themes,
        evidenceLevel: 'C', // 个股研究的推断默认 C 级
        windows,
        notes: claim.verify_by ? `验证依据: ${claim.verify_by}` : '',
      }).catch((err) => { console.error('[documents] stock 事实创建失败:', err); });
    }
  }

  return {
    type: 'stock_profile' as const,
    fileSlug,
  };
}

async function saveNote(input: z.infer<typeof createNoteSchema>) {
  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString(36);
  const fileSlug = slugify(`${input.title}-${uniqueSuffix}`);
  const absolutePath = path.join(DATA_DIRECTORIES.notes, `${fileSlug}.md`);

  await writeMarkdownDocument({
    absolutePath,
    frontmatter: {
      type: 'note',
      title: input.title,
      date: input.date,
      themes: input.themes ?? [],
      stocks: input.stocks ?? [],
      tags: input.tags ?? [],
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: input.content.trim(),
  });

  return {
    type: 'note' as const,
    fileSlug,
  };
}

async function saveMaterial(input: z.infer<typeof createMaterialSchema>) {
  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString(36);
  const fileSlug = slugify(`${input.date}-${input.title}-${uniqueSuffix}`);
  const absolutePath = path.join(DATA_DIRECTORIES.materials, `${fileSlug}.md`);

  const { record } = input;

  const markdownContent = [
    `# ${input.title}`,
    '',
    '## 来源信息',
    '',
    `- 类型：${record.materialType}`,
    `- 日期：${input.date}`,
    `- 证据强度：${evidenceLevelLabels[record.evidenceLevel as keyof typeof evidenceLevelLabels] ?? record.evidenceLevel}`,
    record.sourceUrl ? `- 原始链接：${record.sourceUrl}` : '',
    '',
    '## 原始内容',
    '',
    input.content.trim(),
  ].join('\n');

  await writeMarkdownDocument({
    absolutePath,
    frontmatter: {
      type: 'material',
      title: input.title,
      date: input.date,
      stocks: input.stocks ?? [],
      themes: input.themes ?? [],
      tags: [
        '素材',
        record.materialType,
        ...(input.stocks ?? []),
        ...(input.themes ?? []),
        ...(input.tags ?? []),
      ],
      evidence_level: record.evidenceLevel,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: markdownContent,
  });

  return {
    type: 'material' as const,
    fileSlug,
  };
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = createDocumentSchema.parse(json);
    let saved: { type: string; fileSlug: string };
    switch (input.type) {
      case 'viewpoint':
        saved = await saveViewpoint(input);
        break;
      case 'daily_review':
        saved = await saveDailyReview(input);
        break;
      case 'theme_research':
        saved = await saveThemeResearch(input);
        break;
      case 'stock_profile':
        saved = await saveStockProfile(input);
        break;
      case 'note':
        saved = await saveNote(input);
        break;
      case 'material':
        saved = await saveMaterial(input);
        break;
      default:
        throw new Error(`Unknown document type.`);
    }

    const items = await buildLocalDocumentIndex();
    const item = items.find(
      (entry) => entry.type === saved.type && entry.path.endsWith(`${saved.fileSlug}.md`),
    );

    if (!item) {
      throw new Error('文档已写入，但索引未找到对应文档。');
    }

    // 增量更新 RAG（不阻塞响应）
    const docPath = path.join(process.cwd(), item.path);
    readMarkdownDocument(docPath)
      .then((doc) => upsertRagDocument(doc))
      .catch((err) => { console.error('[documents] 创建后 RAG 增量更新失败:', err); });

    return NextResponse.json({
      ok: true,
      data: {
        id: item.id,
        path: item.path,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.flatten(),
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

// ---- UPDATE (PUT) ----

const updateDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(documentTypes),
  title: z.string().optional(),
  date: z.string().optional(),
  themes: z.array(z.string()).optional(),
  stocks: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  content: z.string().optional(),
  // type-specific 字段
  author: z.string().optional(),
  platform: z.string().optional(),
  source: z.string().optional(),
  stance: z.string().optional(),
  time_horizon: z.string().optional(),
  confidence: z.string().optional(),
  market_phase: z.string().optional(),
  stock_code: z.string().optional(),
  mentioned_stocks: z.array(z.string()).optional(),
  mentioned_themes: z.array(z.string()).optional(),
  core_stocks: z.array(z.string()).optional(),
  // 主题研究编辑字段
  themeName: z.string().optional(),
  rawMaterials: z.string().optional(),
  personalObservation: z.string().optional(),
  appendedMaterials: z.string().optional(),
  generation: z.unknown().optional(),
  // 个股编辑字段
  stockName: z.string().optional(),
  companyInfo: z.string().optional(),
  announcements: z.string().optional(),
  news: z.string().optional(),
  viewpointSummary: z.string().optional(),
  // 知识质量字段（Phase 1 新增）
  status: z.string().optional(),
  last_reviewed: z.string().optional(),
  related: z.array(z.string()).optional(),
});

export async function PUT(request: Request) {
  try {
    const json = await request.json();
    const input = updateDocumentSchema.parse(json);

    // 查找已有文档
    const index = await readDocumentIndex();
    const existing = index.find((item) => item.id === input.id);
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: '文档不存在' },
        { status: 404 },
      );
    }

    // 素材不可编辑
    if (existing.type === 'material') {
      return NextResponse.json(
        { ok: false, error: '素材内容不可编辑，保护原始证据不被修改' },
        { status: 403 },
      );
    }

    const absolutePath = path.join(process.cwd(), existing.path);
    const timestamp = new Date().toISOString();

    // 根据 type 决定如何重建内容
    let markdownContent: string;
    const title = input.title ?? existing.title;

    if (input.type === 'theme_research' && input.themeName && input.generation) {
      markdownContent = buildThemeResearchMarkdown({
        title,
        themeName: input.themeName,
        rawMaterials: input.rawMaterials ?? '',
        personalObservation: input.personalObservation ?? '',
        appendedMaterials: input.appendedMaterials,
        result: input.generation as Parameters<typeof buildThemeResearchMarkdown>[0]['result'],
      });
    } else if (input.type === 'stock_profile' && input.stockName && input.generation) {
      markdownContent = buildStockProfileMarkdown({
        title,
        stockName: input.stockName,
        themes: input.themes ?? [],
        companyInfo: input.companyInfo ?? '',
        announcements: input.announcements ?? '',
        news: input.news ?? '',
        viewpointSummary: input.viewpointSummary ?? '',
        personalObservation: input.personalObservation ?? '',
        appendedMaterials: input.appendedMaterials,
        result: input.generation as Parameters<typeof buildStockProfileMarkdown>[0]['result'],
      });
    } else {
      markdownContent = input.content?.trim() ?? '';
    }

    await writeMarkdownDocument({
      absolutePath,
      frontmatter: {
        type: input.type,
        title,
        date: input.date,
        themes: input.themes ?? [],
        stocks: input.stocks ?? [],
        tags: input.tags ?? [],
        author: input.author,
        platform: input.platform,
        source: input.source,
        stance: input.stance,
        time_horizon: input.time_horizon,
        confidence: input.confidence,
        market_phase: input.market_phase,
        stock_code: input.stock_code,
        mentioned_stocks: input.mentioned_stocks ?? [],
        mentioned_themes: input.mentioned_themes ?? [],
        core_stocks: input.core_stocks ?? [],
        status: input.status,
        last_reviewed: input.last_reviewed,
        related: input.related,
        updated_at: timestamp,
      },
      content: markdownContent,
    });

    // 重建索引
    const items = await buildLocalDocumentIndex();
    const item = items.find((entry) => entry.id === input.id);

    // 增量更新 RAG
    readMarkdownDocument(absolutePath)
      .then((doc) => upsertRagDocument(doc))
      .catch((err) => { console.error('[documents] 更新后 RAG 增量更新失败:', err); });

    return NextResponse.json({
      ok: true,
      data: {
        id: item?.id ?? input.id,
        path: existing.path,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.flatten() },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

// ---- DELETE ----

const deleteDocumentSchema = z.object({
  id: z.string().min(1, '文档 ID 不能为空'),
});

export async function DELETE(request: Request) {
  try {
    const json = await request.json();
    const { id } = deleteDocumentSchema.parse(json);

    const index = await readDocumentIndex();
    const existing = index.find((item) => item.id === id);

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: '文档不存在' },
        { status: 404 },
      );
    }

    const absolutePath = path.join(process.cwd(), existing.path);
    await deleteMarkdownDocument(absolutePath);

    // 重建索引
    await buildLocalDocumentIndex();
    // 增量删除 RAG 中该文档的 chunks
    removeRagDocument(id).catch((err) => { console.error('[documents] RAG 文档删除失败:', err); });

    return NextResponse.json({
      ok: true,
      data: { id },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.flatten() },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
