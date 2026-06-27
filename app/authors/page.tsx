import Link from 'next/link';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentIndex } from '@/lib/server/documents';

export const metadata = { title: '关注人管理 - A 股投研助手' };

interface AuthorStats {
  author: string;
  total: number;
  lastActive: string;
  stanceDistribution: { bullish: number; bearish: number; neutral: number; watch: number };
  topThemes: string[];
  platforms: string[];
}

export default async function AuthorsPage() {
  const items = await getDocumentIndex();
  const vps = items.filter((i) => i.type === 'viewpoint');

  // 按作者聚合
  const map = new Map<string, {
    count: number; dates: string[]; themes: string[]; platforms: string[];
    stances: { bullish: number; bearish: number; neutral: number; watch: number };
  }>();

  for (const vp of vps) {
    const a = vp.author || '未知';
    if (!map.has(a)) map.set(a, { count: 0, dates: [], themes: [], platforms: [], stances: { bullish: 0, bearish: 0, neutral: 0, watch: 0 } });
    const entry = map.get(a)!;
    entry.count++;
    if (vp.date) entry.dates.push(vp.date);
    entry.themes.push(...vp.themes);
    if (vp.platform) entry.platforms.push(vp.platform);
    // 从 index 直接读取 stance
    if (vp.stance && vp.stance in entry.stances) {
      entry.stances[vp.stance as keyof typeof entry.stances]++;
    }
  }

  const authors: AuthorStats[] = [...map.entries()]
    .map(([author, d]) => {
      const themeCounts = new Map<string, number>();
      d.themes.forEach((t) => themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1));
      const topThemes = [...themeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
      const platforms = [...new Set(d.platforms)];
      const lastActive = d.dates.sort().reverse()[0] || '';

      // 读取 stance 分布（需要遍历文档）
      // 从 index 无法拿 stance，简单统计
      const stanceDist = d.stances;

      return { author, total: d.count, lastActive, stanceDistribution: stanceDist, topThemes, platforms };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <AppShell currentPath="/authors">
      <div className="page-stack">
        <PageHero title="关注人管理" description={`共 ${authors.length} 位关注人，${vps.length} 条观点蒸馏记录。`} />

        <div className="checkbox-list">
          {authors.map((a) => {
            const total = a.stanceDistribution.bullish + a.stanceDistribution.bearish + a.stanceDistribution.neutral + a.stanceDistribution.watch || a.total;
            return (
              <Link
                key={a.author}
                href={`/viewpoints?author=${encodeURIComponent(a.author)}`}
                className="checkbox-item result-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: 17 }}>{a.author}</strong>
                    <span className="text-muted" style={{ fontSize: 13 }}>{a.total} 条观点</span>
                  </div>

                  {/* 立场分布 */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {[
                      { key: 'bullish', label: '看多', color: '#e09090' },
                      { key: 'bearish', label: '看空', color: '#8cd8b0' },
                      { key: 'neutral', label: '中性', color: '#b0c4d8' },
                      { key: 'watch', label: '观望', color: '#d4b16a' },
                    ].map((s) => {
                      const cnt = a.stanceDistribution[s.key as keyof typeof a.stanceDistribution];
                      if (!cnt) return null;
                      const pct = Math.round((cnt / total) * 100);
                      return (
                        <span key={s.key} className="meta-pill" style={{ fontSize: 11 }}>
                          <span style={{ color: s.color, fontWeight: 600 }}>{s.label} {cnt}</span>
                          <span style={{ marginLeft: 4 }}>{pct}%</span>
                        </span>
                      );
                    })}
                  </div>

                  <div className="text-muted" style={{ fontSize: 12 }}>
                    最近活跃: {a.lastActive || '未知'}
                    {a.platforms.length ? ` · ${a.platforms.join(', ')}` : ''}
                  </div>

                  {a.topThemes.length > 0 ? (
                    <div className="tag-list" style={{ marginTop: 6 }}>
                      {a.topThemes.map((t) => (
                        <span key={t} className="tag" style={{ fontSize: 11, padding: '3px 8px' }}>{t}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
