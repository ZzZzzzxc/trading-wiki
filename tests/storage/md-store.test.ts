import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listMarkdownPaths,
  readMarkdownDocument,
  writeMarkdownDocument,
  deleteMarkdownDocument,
} from '@/lib/storage/md-store';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  tempDirectories.length = 0;
});

describe('md-store', () => {
  it('lists markdown files recursively', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'md-store-'));
    tempDirectories.push(directory);
    await mkdir(path.join(directory, 'nested'), { recursive: true });
    await writeFile(
      path.join(directory, 'nested', 'sample.md'),
      '---\ntype: note\ntitle: 示例\n---\n\n内容',
    );

    const items = await listMarkdownPaths(directory);

    expect(items).toHaveLength(1);
    expect(items[0]).toContain('sample.md');
  });

  it('reads markdown document into structured data', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'md-read-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'review.md');
    await writeFile(
      filePath,
      '---\ntype: daily_review\ntitle: 示例复盘\ndate: 2026-06-12\n---\n\n复盘内容',
    );

    const document = await readMarkdownDocument(filePath);

    expect(document.title).toBe('示例复盘');
    expect(document.frontmatter.date).toBe('2026-06-12');
    expect(document.excerpt).toContain('复盘内容');
  });

  it('writes markdown document with frontmatter', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'md-write-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'note.md');

    await writeMarkdownDocument({
      absolutePath: filePath,
      frontmatter: {
        type: 'note',
        title: '测试笔记',
        date: '2026-06-13',
        themes: ['AI算力'],
        stocks: ['300604'],
        tags: ['测试'],
      },
      content: '# 标题\n\n正文内容',
    });

    const document = await readMarkdownDocument(filePath);
    expect(document.title).toBe('测试笔记');
    expect(document.frontmatter.themes).toEqual(['AI算力']);
    expect(document.content).toBe('# 标题\n\n正文内容');
  });

  it('deletes markdown document', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'md-delete-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'to-delete.md');

    await writeMarkdownDocument({
      absolutePath: filePath,
      frontmatter: { type: 'note', title: '待删除' },
      content: '内容',
    });

    // 确认文件存在
    await access(filePath);

    await deleteMarkdownDocument(filePath);

    // 确认文件已删除
    await expect(access(filePath)).rejects.toThrow();
  });

  it('overwrites existing document on write', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'md-overwrite-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'update.md');

    await writeMarkdownDocument({
      absolutePath: filePath,
      frontmatter: { type: 'note', title: '原始标题' },
      content: '原始内容',
    });

    // 覆盖写入
    await writeMarkdownDocument({
      absolutePath: filePath,
      frontmatter: { type: 'note', title: '更新标题' },
      content: '更新内容',
    });

    const document = await readMarkdownDocument(filePath);
    expect(document.title).toBe('更新标题');
    expect(document.content).toBe('更新内容');
  });

  describe('readMarkdownDocument error scenarios', () => {
    it('throws for non-existent file', async () => {
      const fakePath = '/tmp/non-existent-dir/some-file.md';
      await expect(readMarkdownDocument(fakePath)).rejects.toThrow();
    });

    it('throws with error mentioning the path for non-existent file', async () => {
      const fakePath = '/tmp/definitely-not-here-12345.md';
      await expect(readMarkdownDocument(fakePath)).rejects.toThrow(
        /definitely-not-here/,
      );
    });

    it('handles empty file by returning empty frontmatter', async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'md-empty-'));
      tempDirectories.push(directory);
      const filePath = path.join(directory, 'empty.md');
      await writeFile(filePath, '');

      const doc = await readMarkdownDocument(filePath);
      expect(doc.title).toBe('empty');
      expect(doc.content).toBe('');
    });

    it('handles markdown without frontmatter gracefully', async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'md-nofm-'));
      tempDirectories.push(directory);
      const filePath = path.join(directory, 'plain.md');
      await writeFile(filePath, '# 只有正文\n\n没有 frontmatter');

      const doc = await readMarkdownDocument(filePath);
      expect(doc.title).toBe('plain');
      expect(doc.content).toContain('没有 frontmatter');
      // frontmatter should be empty object
      expect(Object.keys(doc.frontmatter)).toHaveLength(0);
    });
  });

  describe('writeMarkdownDocument boundary', () => {
    it('write then read back produces identical content', async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'md-roundtrip-'));
      tempDirectories.push(directory);
      const filePath = path.join(directory, 'roundtrip.md');

      await writeMarkdownDocument({
        absolutePath: filePath,
        frontmatter: {
          type: 'note',
          title: '往返测试',
          date: '2026-06-20',
          themes: ['AI', '存储'],
          stocks: ['002456', '300604'],
          tags: ['测试', '往返'],
        },
        content: '# 往返测试\n\n写入并读回的内容。',
      });

      const doc = await readMarkdownDocument(filePath);
      expect(doc.title).toBe('往返测试');
      expect(doc.frontmatter.type).toBe('note');
      expect(doc.frontmatter.date).toBe('2026-06-20');
      expect(doc.frontmatter.themes).toEqual(['AI', '存储']);
      expect(doc.frontmatter.stocks).toEqual(['002456', '300604']);
      expect(doc.frontmatter.tags).toEqual(['测试', '往返']);
      expect(doc.content).toContain('写入并读回的内容');
    });

    it('write with minimal frontmatter works correctly', async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'md-minimal-'));
      tempDirectories.push(directory);
      const filePath = path.join(directory, 'minimal.md');

      await writeMarkdownDocument({
        absolutePath: filePath,
        frontmatter: { type: 'note', title: '极简' },
        content: '仅有必要字段',
      });

      const doc = await readMarkdownDocument(filePath);
      expect(doc.title).toBe('极简');
      expect(doc.content).toBe('仅有必要字段');
    });

    it('write with empty content persists blank frontmatter fields', async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'md-empty-content-'));
      tempDirectories.push(directory);
      const filePath = path.join(directory, 'empty-content.md');

      await writeMarkdownDocument({
        absolutePath: filePath,
        frontmatter: {
          type: 'note',
          title: '空内容',
          date: '2026-06-15',
          themes: [],
          stocks: [],
          tags: [],
        },
        content: '',
      });

      const doc = await readMarkdownDocument(filePath);
      expect(doc.title).toBe('空内容');
      expect(doc.content).toBe('');
      expect(doc.frontmatter.themes).toEqual([]);
    });
  });
});
