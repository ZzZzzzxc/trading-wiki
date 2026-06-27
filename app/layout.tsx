import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ToastProvider } from '@/components/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'A 股个人投研助理',
  description: '本地优先的 A 股投研助理，沉淀 Markdown 知识库、观点和每日复盘。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ToastProvider>{children}</ToastProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
