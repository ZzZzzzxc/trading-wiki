import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import type { DocumentFrontmatter, MarkdownDocument } from '@/lib/types/document';
import { parseFrontmatter, stringifyFrontmatter } from '@/lib/storage/frontmatter';
import { DATA_DIR, ensureProjectDirectories } from '@/lib/storage/paths';
import { slugify } from '@/lib/storage/slug';

function excerptFromContent(content: string, limit = 200): string {
  const normalized = content.replace(/\s+/g, ' ').trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

export async function listMarkdownPaths(directory = DATA_DIR): Promise<string[]> {
  const matches = await glob('**/*.md', {
    cwd: directory,
    absolute: true,
  });

  return matches.sort();
}

export async function readMarkdownDocument<
  TFrontmatter extends DocumentFrontmatter,
>(absolutePath: string): Promise<MarkdownDocument<TFrontmatter>> {
  const source = await readFile(absolutePath, 'utf8');
  const { frontmatter, content } = parseFrontmatter<TFrontmatter>(source);
  const relativePath = path.relative(process.cwd(), absolutePath);
  const slug = path.basename(absolutePath, '.md');
  const title = frontmatter.title ?? slug;

  return {
    id: slugify(`${frontmatter.type}-${frontmatter.date ?? slug}-${slug}`),
    slug,
    title,
    absolutePath,
    relativePath,
    frontmatter,
    content,
    excerpt: excerptFromContent(content),
  };
}

export async function listMarkdownDocuments<
  TFrontmatter extends DocumentFrontmatter,
>(directory = DATA_DIR): Promise<Array<MarkdownDocument<TFrontmatter>>> {
  const filePaths = await listMarkdownPaths(directory);
  return Promise.all(
    filePaths.map((absolutePath) => readMarkdownDocument<TFrontmatter>(absolutePath)),
  );
}

export async function writeMarkdownDocument<
  TFrontmatter extends DocumentFrontmatter,
>(options: {
  absolutePath: string;
  frontmatter: TFrontmatter;
  content: string;
}): Promise<void> {
  await ensureProjectDirectories();
  const payload = stringifyFrontmatter(options.frontmatter, options.content);
  await writeFile(options.absolutePath, payload, 'utf8');
}

export async function deleteMarkdownDocument(absolutePath: string): Promise<void> {
  await unlink(absolutePath);
}
