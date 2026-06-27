import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { XueqiuWorkbench } from '@/components/crawler/xueqiu/xueqiu-workbench';

export const metadata = { title: '雪球采集 - A 股投研助手' };

export default function XueqiuCrawlerPage() {
  return (
    <AppShell currentPath="/crawler/xueqiu">
      <div className="page-stack-fluid">
        <PageHero
          title="雪球采集"
          description="通过浏览器自动化抓取关注用户的雪球主页帖子。原始帖子不可变存档，勾选后批量调用 AI 提取结构化观点。"
        />
        <XueqiuWorkbench />
      </div>
    </AppShell>
  );
}
