import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { ThemeWorkbench } from '@/components/themes/theme-workbench';
import { getDocumentById, getDocumentsByType } from '@/lib/server/documents';
import { parseThemeMarkdown } from '@/lib/themes/markdown';

export const metadata = { title: '编辑产业链研究 - A 股投研助手' };

interface ThemeEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function ThemeEditPage({ params }: ThemeEditPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'theme_research') {
    notFound();
  }

  const [materials, viewpoints, reviews, notes] = await Promise.all([
    getDocumentsByType('material'),
    getDocumentsByType('viewpoint'),
    getDocumentsByType('daily_review'),
    getDocumentsByType('note'),
  ]);
  const { personalObservation } = parseThemeMarkdown(document.content);
  const themeName = (document.frontmatter.themes?.[0]) ?? document.title.replace('产业链研究', '');

  return (
    <AppShell currentPath="/themes">
      <div className="page-stack-fluid">
        <PageHero
          title={`重新生成：${document.title}`}
          description="重新选择素材后调用 AI 生成。素材库中的原始资料不会被覆盖。"
          extra={
            <Link href={`/themes/${encodeURIComponent(document.id)}`} className="app-nav-link">
              返回详情
            </Link>
          }
        />
        <ThemeWorkbench
          editDocId={document.id}
          initialThemeName={themeName}
          initialObservation={personalObservation}
          materials={[...materials, ...viewpoints, ...reviews, ...notes]}
        />
      </div>
    </AppShell>
  );
}
