import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { DocumentEditor } from '@/components/documents/document-editor';
import { getDocumentById } from '@/lib/server/documents';

export const metadata = { title: '编辑观点 - A 股投研助手' };

interface ViewpointEditPageProps {
  params: Promise<{ id: string }>;
}

const STANCE_OPTIONS = [
  { value: 'bullish', label: '看多' },
  { value: 'bearish', label: '看空' },
  { value: 'neutral', label: '中性' },
  { value: 'watch', label: '观察' },
];

const TIME_HORIZON_OPTIONS = [
  { value: 'intraday', label: '日内' },
  { value: 'short', label: '短期' },
  { value: 'mid', label: '中期' },
  { value: 'long', label: '长期' },
  { value: 'unknown', label: '未知' },
];

const CONFIDENCE_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

export default async function ViewpointEditPage({
  params,
}: ViewpointEditPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'viewpoint') {
    notFound();
  }

  const fm = document.frontmatter;

  return (
    <AppShell currentPath="/viewpoints">
      <div className="page-stack-fluid">
        <PageHero
          title={`编辑：${document.title}`}
          description="修改 frontmatter 字段或直接编辑 Markdown 正文，保存后索引自动更新。"
          extra={
            <Link href={`/viewpoints/${encodeURIComponent(id)}`} className="app-nav-link">
              返回详情
            </Link>
          }
        />

        <DocumentEditor
          documentId={id}
          documentType="viewpoint"
          initialFrontmatter={fm}
          initialContent={document.content}
          frontmatterFields={[
            { key: 'author', label: '作者', value: fm.author ?? '' },
            { key: 'platform', label: '平台', value: fm.platform ?? '' },
            {
              key: 'stance',
              label: '立场',
              value: fm.stance ?? '',
              type: 'select',
              options: STANCE_OPTIONS,
            },
            {
              key: 'time_horizon',
              label: '时间周期',
              value: fm.time_horizon ?? '',
              type: 'select',
              options: TIME_HORIZON_OPTIONS,
            },
            {
              key: 'confidence',
              label: '置信度',
              value: fm.confidence ?? '',
              type: 'select',
              options: CONFIDENCE_OPTIONS,
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
