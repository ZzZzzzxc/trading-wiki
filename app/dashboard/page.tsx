import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Plus, TrendingUp, TrendingDown, Minus, Archive } from 'lucide-react';
import { DocumentList } from '@/components/documents/document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDashboardSummary, type TrendInfo } from '@/lib/server/documents';

export const metadata: Metadata = {
  title: '仪表盘 - A 股投研助手',
};

export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  const stanceTotal =
    summary.stanceDistribution.bullish +
    summary.stanceDistribution.bearish +
    summary.stanceDistribution.neutral +
    summary.stanceDistribution.watch || 1;

  const maxTrend = Math.max(...summary.trend.map((t) => t.count), 1);
  const materialsCount = summary.items.filter((item) => item.type === 'material').length;

  return (
    <AppShell currentPath="/dashboard">
      <div className="page-stack">
        <PageHero
          title="今日投研总览"
          description="本地 Markdown 知识库的全局视图。"
          extra={
            <>
              <Link href="/viewpoints/new" className="app-nav-link app-nav-link-active">
                <Plus size={16} /> 新建观点
              </Link>
              <Link href="/reviews/new" className="app-nav-link">
                <ArrowRight size={16} /> 新建复盘
              </Link>
            </>
          }
        />

        {/* 统计卡片 */}
        <section className="stat-grid">
          <StatCard label="总文档" value={summary.items.length} color="var(--text)" hint="本地 Markdown" trend={summary.trends.totalDocuments} />
          <StatCard label="观点蒸馏" value={summary.totalViewpoints} color="#d4b16a" href="/viewpoints" trend={summary.trends.totalViewpoints} />
          <StatCard
            label="待验证断言"
            value={summary.pendingFacts}
            color={summary.pendingFacts > 0 ? '#ffb3b3' : 'var(--muted)'}
            href={summary.pendingFacts > 0 ? '/facts' : undefined}
            hint={summary.pendingFacts > 0 ? '需要关注' : '暂无'}
            trend={summary.trends.pendingFacts}
          />
          <StatCard
            label="今日到期验证"
            value={summary.dueTodayWindows}
            color={summary.dueTodayWindows > 0 ? '#ffb3b3' : 'var(--muted)'}
            href={summary.dueTodayWindows > 0 ? '/facts' : undefined}
            hint={summary.dueTodayWindows > 0 ? '尽快复核' : '暂无'}
            trend={summary.trends.dueTodayWindows}
          />
          <StatCard
            label="原始素材"
            value={materialsCount}
            color="#8cd8b0"
            href="/materials"
            icon={<Archive size={20} />}
          />
        </section>

        <section className="section-grid columns-2">
          {/* 观点立场分布 */}
          <div className="glass-card">
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>观点立场分布</h3>
            {stanceTotal > 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  { key: 'bullish', label: '看多', color: '#e09090' },
                  { key: 'bearish', label: '看空', color: '#8cd8b0' },
                  { key: 'neutral', label: '中性', color: '#b0c4d8' },
                  { key: 'watch', label: '观望', color: '#d4b16a' },
                ].map(({ key, label, color }) => {
                  const count =
                    summary.stanceDistribution[key as keyof typeof summary.stanceDistribution];
                  const pct = Math.round((count / stanceTotal) * 100);
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, width: 36, color: 'var(--muted)' }}>
                        {label}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 8,
                          borderRadius: 4,
                          background: 'rgba(143, 164, 194, 0.1)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            borderRadius: 4,
                            background: color,
                            transition: 'width 400ms ease',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 13, width: 36, textAlign: 'right' }}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-muted" style={{ fontSize: 13 }}>暂无观点数据</span>
            )}
          </div>

          {/* 近 7 天趋势 */}
          <div className="glass-card">
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>近 7 天新增</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
              {summary.trend.map((t) => {
                const h = Math.max((t.count / maxTrend) * 80, t.count > 0 ? 10 : 6);
                return (
                  <div
                    key={t.date}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{t.count}</span>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: 40,
                        height: h,
                        borderRadius: '6px 6px 0 0',
                        background: t.count > 0 ? 'var(--accent)' : 'rgba(143, 164, 194, 0.12)',
                        transition: 'height 400ms ease',
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {t.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 热门主题 + 个股 */}
        <section className="section-grid columns-2">
          <div className="glass-card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>热门主题</h3>
            {summary.topThemes.length > 0 ? (
              <div className="tag-list">
                {summary.topThemes.map((t) => (
                  <span key={t.name} className="tag" style={{ fontSize: 13, padding: '6px 12px' }}>
                    {t.name}
                    <span style={{ marginLeft: 6, opacity: 0.6 }}>{t.count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted" style={{ fontSize: 13 }}>暂无主题数据</span>
            )}
          </div>

          <div className="glass-card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>最近个股档案</h3>
            <DocumentList
              items={summary.recentStocks}
              emptyTitle="还没有个股档案"
              emptyDescription="创建个股档案后在此显示。"
            />
          </div>
        </section>

        {/* 最近文档 */}
        <section className="section-grid columns-2">
          <div className="glass-card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>最近复盘</h3>
            <DocumentList
              items={summary.recentReviews}
              emptyTitle="还没有复盘"
              emptyDescription="点击右上角「新建复盘」开始。"
            />
          </div>
          <div className="glass-card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>最近观点</h3>
            <DocumentList
              items={summary.recentViewpoints}
              emptyTitle="还没有观点"
              emptyDescription="点击右上角「新建观点」开始。"
            />
          </div>
        </section>

        <section className="section-grid columns-2">
          <div className="glass-card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>最近产业链研究</h3>
            <DocumentList
              items={summary.recentThemes}
              emptyTitle="还没有产业链研究"
              emptyDescription="创建产业链研究后在此显示。"
            />
          </div>
          <div className="glass-card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>最近笔记</h3>
            <DocumentList
              items={summary.recentNotes}
              emptyTitle="还没有笔记"
              emptyDescription="创建笔记后在此显示。"
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  color,
  href,
  icon,
  hint,
  trend,
}: {
  label: string;
  value: number;
  color: string;
  href?: string;
  icon?: React.ReactNode;
  trend?: TrendInfo;
  hint?: string;
}) {
  const formattedValue = Number(value).toLocaleString('zh-CN');

  const trendIcon = trend ? (
    trend.direction === 'up' ? (
      <TrendingUp size={14} style={{ color: '#4ade80' }} />
    ) : trend.direction === 'down' ? (
      <TrendingDown size={14} style={{ color: '#f87171' }} />
    ) : (
      <Minus size={14} style={{ color: 'var(--muted)' }} />
    )
  ) : null;

  const trendColor =
    trend?.direction === 'up'
      ? '#4ade80'
      : trend?.direction === 'down'
        ? '#f87171'
        : 'var(--muted)';

  const content = (
    <div className={`glass-card stat-card ${href ? 'interactive' : ''}`}>
      {icon && <div style={{ marginBottom: 4, opacity: 0.7 }}>{icon}</div>}
      <span className="stat-card-label">{label}</span>
      <span className="stat-card-value" style={{ color }}>
        {formattedValue}
      </span>
      {trend ? (
        <span
          style={{
            fontSize: 12,
            color: trendColor,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            marginTop: -2,
          }}
        >
          {trendIcon}
          {trend.percent}%
        </span>
      ) : null}
      {hint ? (
        <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: -4 }}>{hint}</span>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none' }}>
        {content}
      </Link>
    );
  }

  return content;
}
