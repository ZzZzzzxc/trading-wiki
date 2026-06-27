'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

const LABEL_MAP: Record<string, string> = {
  'dashboard': '仪表盘',
  'ask': '知识库问答',
  'materials': '原始素材',
  'new': '新建',
  'viewpoints': '观点蒸馏',
  'reviews': '每日复盘',
  'themes': '产业链研究',
  'stocks': '个股档案',
  'notes': '个人笔记',
  'facts': '可验证断言',
  'authors': '关注人管理',
  'search': '知识库搜索',
  'rag-debug': 'RAG 调试',
  'crawler': '采集',
  'xueqiu': '雪球',
  'edit': '编辑',
};

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return null;

  const items: BreadcrumbItem[] = [{ label: '首页', href: '/dashboard' }];
  let current = '';
  for (const seg of segments) {
    current += '/' + seg;
    // 跳过动态 ID 段（长于 20 的 slug）或 36 进制时间戳
    if (seg.length > 20 || /^[0-9a-z]{8,}$/.test(seg)) {
      items.push({ label: '详情' });
      continue;
    }
    if (seg === 'new') {
      items.push({ label: '新建' });
      continue;
    }
    if (seg === 'edit') {
      items.push({ label: '编辑' });
      continue;
    }
    items.push({ label: LABEL_MAP[seg] || seg, href: current });
  }

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', marginBottom: 8, flexWrap: 'wrap' }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <ChevronRight size={12} />}
          {item.href ? (
            <Link href={item.href} style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = ''; }}>
              {item.label}
            </Link>
          ) : (
            <span style={{ color: 'var(--text)' }}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
