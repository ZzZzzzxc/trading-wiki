import Link from 'next/link';
import {
  Archive,
  BarChart3,
  BookOpen,
  Bug,
  CheckCheck,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Notebook,
  Search,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { Breadcrumb } from './breadcrumb';

const navGroups = [
  {
    label: '工作台',
    items: [
      { href: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
      { href: '/ask', label: '知识库问答', icon: MessageSquare },
      { href: '/research', label: '深度研究', icon: FlaskConical },
    ],
  },
  {
    label: '数据源',
    items: [
      { href: '/materials', label: '原始素材', icon: Archive },
      { href: '/crawler/xueqiu', label: '雪球采集', icon: Globe },
    ],
  },
  {
    label: '投研产出',
    items: [
      { href: '/viewpoints', label: '观点蒸馏', icon: Lightbulb },
      { href: '/reviews', label: '每日复盘', icon: BarChart3 },
      { href: '/themes', label: '产业链研究', icon: BookOpen },
      { href: '/stocks', label: '个股档案', icon: TrendingUp },
      { href: '/notes', label: '个人笔记', icon: Notebook },
    ],
  },
  {
    label: '验证与管理',
    items: [
      { href: '/facts', label: '可验证断言', icon: CheckCheck },
      { href: '/authors', label: '关注人管理', icon: Users },
      { href: '/search', label: '知识库搜索', icon: Search },
      { href: '/rag-debug', label: 'RAG 调试', icon: Wrench },
      { href: '/agent-debug', label: 'Agent 调试', icon: Bug },
    ],
  },
] as const;

export interface AppShellProps {
  currentPath: string;
  children: React.ReactNode;
}

export function AppShell({ currentPath, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div>
          <Link href="/dashboard" style={{ textDecoration: 'none' }}>
            <div className="app-brand">
              <span className="app-brand-badge">Local First</span>
              <div className="app-brand-title">A 股投研助手</div>
              <div className="app-brand-desc">
                本地 Markdown 知识库 · AI 驱动投研
              </div>
            </div>
          </Link>

          <nav className="app-nav" aria-label="主导航">
            {navGroups.map((group) => (
              <div key={group.label} className="app-nav-group">
                <div className="app-nav-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = currentPath === item.href || currentPath.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`app-nav-link ${active ? 'app-nav-link-active' : ''}`.trim()}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
        <div className="app-sidebar-footer">
          本地优先，先沉淀文档，再把检索与生成链路逐步打通。
        </div>
      </aside>
      <div className="app-content">
        <Breadcrumb path={currentPath} />
        <main>{children}</main>
      </div>
    </div>
  );
}
