import path from 'node:path';
import type { DocumentIndexItem, MarkdownDocument } from '@/lib/types/document';
import { readDocumentIndex } from '@/lib/storage/index-store';
import { readMarkdownDocument } from '@/lib/storage/md-store';

export type TrendInfo = { direction: 'up' | 'down' | 'flat'; percent: number };

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function computeTrend(curr: number, prev: number): TrendInfo | undefined {
  if (curr === 0 && prev === 0) return undefined;
  if (prev === 0) return { direction: 'up', percent: 100 };
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return { direction: 'flat', percent: 0 };
  return { direction: pct > 0 ? 'up' : 'down', percent: Math.abs(pct) };
}

export async function getDocumentIndex(): Promise<DocumentIndexItem[]> {
  return readDocumentIndex();
}

export async function getDocumentsByType(
  type: DocumentIndexItem['type'],
): Promise<DocumentIndexItem[]> {
  const items = await readDocumentIndex();
  return items.filter((item) => item.type === type);
}

export async function getDashboardSummary() {
  const items = await readDocumentIndex();

  // 观点立场分布
  const viewpointItems = items.filter((item) => item.type === 'viewpoint');
  const stanceDistribution = { bullish: 0, bearish: 0, neutral: 0, watch: 0 };
  for (const vp of viewpointItems.slice(0, 50)) {
    try {
      const doc = await readMarkdownDocument(path.join(process.cwd(), vp.path));
      const stance = doc.frontmatter.stance as string | undefined;
      if (stance && stance in stanceDistribution) {
        stanceDistribution[stance as keyof typeof stanceDistribution]++;
      }
    } catch {
      // 读取失败跳过
    }
  }

  // 热门主题 TOP 8
  const themeCounts = new Map<string, number>();
  for (const item of items) {
    for (const theme of item.themes) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
  }
  const topThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // 近 7 天文档趋势
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const trend: Array<{ date: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = items.filter((item) => item.date === dateStr).length;
    trend.push({ date: dateStr, count });
  }

  // 待验证断言数 + 今日到期窗口
  let pendingFacts = 0;
  let dueTodayWindows = 0;
  let pendingFactsTrend: TrendInfo | undefined;
  let dueTodayWindowsTrend: TrendInfo | undefined;
  try {
    const { readFacts } = await import('@/lib/storage/fact-store');
    const facts = await readFacts();
    pendingFacts = facts.filter((f) => f.state === 'pending').length;
    for (const f of facts) {
      if (f.state === 'pending') {
        dueTodayWindows += f.windows.filter(
          (w) => !w.result && w.dueDate <= todayStr,
        ).length;
      }
    }

    // 待验证断言趋势：本周新增 vs 上周新增
    const weekAgo = daysAgo(7);
    const twoWeeksAgo = daysAgo(14);
    const newPendingThisWeek = facts.filter(
      (f) => f.state === 'pending' && f.createdAt.slice(0, 10) > weekAgo,
    ).length;
    const newPendingLastWeek = facts.filter(
      (f) =>
        f.state === 'pending' &&
        f.createdAt.slice(0, 10) > twoWeeksAgo &&
        f.createdAt.slice(0, 10) <= weekAgo,
    ).length;
    pendingFactsTrend = computeTrend(newPendingThisWeek, newPendingLastWeek);

    // 今日到期趋势：本周到期 vs 上周到期的不含结果窗口
    let dueThisWeek = 0;
    let dueLastWeek = 0;
    for (const f of facts) {
      for (const w of f.windows) {
        if (!w.result) {
          if (w.dueDate > weekAgo && w.dueDate <= todayStr) dueThisWeek++;
          else if (w.dueDate > twoWeeksAgo && w.dueDate <= weekAgo) dueLastWeek++;
        }
      }
    }
    dueTodayWindowsTrend = computeTrend(dueThisWeek, dueLastWeek);
  } catch {
    // facts 文件可能不存在
  }

  // 环比趋势：本周新增 vs 上周新增
  const weekAgo = daysAgo(7);
  const twoWeeksAgo = daysAgo(14);

  const newDocsThisWeek = items.filter(
    (i) => i.date && i.date > weekAgo && i.date <= todayStr,
  ).length;
  const newDocsLastWeek = items.filter(
    (i) => i.date && i.date > twoWeeksAgo && i.date <= weekAgo,
  ).length;
  const totalDocumentsTrend = computeTrend(newDocsThisWeek, newDocsLastWeek);

  const newVpsThisWeek = viewpointItems.filter(
    (i) => i.date && i.date > weekAgo && i.date <= todayStr,
  ).length;
  const newVpsLastWeek = viewpointItems.filter(
    (i) => i.date && i.date > twoWeeksAgo && i.date <= weekAgo,
  ).length;
  const totalViewpointsTrend = computeTrend(newVpsThisWeek, newVpsLastWeek);

  return {
    items,
    recentReviews: items.filter((item) => item.type === 'daily_review').slice(0, 4),
    recentViewpoints: viewpointItems.slice(0, 4),
    recentNotes: items.filter((item) => item.type === 'note').slice(0, 4),
    recentThemes: items.filter((item) => item.type === 'theme_research').slice(0, 4),
    recentStocks: items.filter((item) => item.type === 'stock_profile').slice(0, 4),
    stanceDistribution,
    topThemes,
    trend,
    pendingFacts,
    dueTodayWindows,
    totalViewpoints: viewpointItems.length,
    trends: {
      totalDocuments: totalDocumentsTrend,
      totalViewpoints: totalViewpointsTrend,
      pendingFacts: pendingFactsTrend,
      dueTodayWindows: dueTodayWindowsTrend,
    },
  };
}

export async function getDocumentById(
  id: string,
): Promise<MarkdownDocument | null> {
  const items = await readDocumentIndex();
  const item = items.find((entry) => entry.id === id);

  if (!item) {
    return null;
  }

  return readMarkdownDocument(path.join(process.cwd(), item.path));
}

export interface RelatedDocumentsResult {
  /** 共享股票的相关文档 */
  byStock: DocumentIndexItem[];
  /** 共享主题的相关文档 */
  byTheme: DocumentIndexItem[];
  /** 同类型的相关文档 */
  byType: DocumentIndexItem[];
}

/** 根据当前文档的 stocks/themes 找到关联文档（排除自身） */
/** 根据 stocks + themes 交集匹配已有素材，按重叠度降序 */
export async function matchMaterials(
  stocks: string[],
  themes: string[],
): Promise<DocumentIndexItem[]> {
  const items = await readDocumentIndex();
  const materials = items.filter((item) => item.type === 'material');

  if (!stocks.length && !themes.length) {
    // 无筛选条件时返回全部素材（按日期降序）
    return materials.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  const scored = materials.map((m) => {
    let score = 0;
    for (const s of stocks) {
      if (m.stocks.some((ms) => ms.includes(s) || s.includes(ms))) score += 2;
    }
    for (const t of themes) {
      if (m.themes.some((mt) => mt.includes(t) || t.includes(mt))) score += 2;
    }
    return { item: m, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

export async function getRelatedDocuments(
  currentId: string,
  stocks: string[],
  themes: string[],
): Promise<RelatedDocumentsResult> {
  const items = await readDocumentIndex();

  const byStock = stocks.length
    ? items.filter(
        (item) =>
          item.id !== currentId &&
          item.stocks.some((s) => stocks.some((cs) => s.includes(cs) || cs.includes(s))),
      )
    : [];

  const byTheme = themes.length
    ? items.filter(
        (item) =>
          item.id !== currentId &&
          !byStock.some((bs) => bs.id === item.id) &&
          item.themes.some((t) => themes.some((ct) => t.includes(ct) || ct.includes(t))),
      )
    : [];

  // 同类型文档
  const currentItem = items.find((i) => i.id === currentId);
  const byType = currentItem
    ? items
        .filter(
          (item) =>
            item.id !== currentId &&
            item.type === currentItem.type &&
            !byStock.some((bs) => bs.id === item.id) &&
            !byTheme.some((bt) => bt.id === item.id),
        )
        .slice(0, 5)
    : [];

  return { byStock: byStock.slice(0, 8), byTheme: byTheme.slice(0, 8), byType };
}
