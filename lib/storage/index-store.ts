import { readFile, writeFile } from 'node:fs/promises';
import type { DocumentIndexItem, MarkdownDocument } from '@/lib/types/document';
import { INDEX_FILE, ensureProjectDirectories } from '@/lib/storage/paths';

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

export function documentToIndexItem(document: MarkdownDocument): DocumentIndexItem {
  const frontmatter = document.frontmatter;
  const stocks = [
    ...(frontmatter.stocks ?? []),
    ...(frontmatter.mentioned_stocks ?? []),
    ...(frontmatter.core_stocks ?? []),
    frontmatter.stock_code,
  ];
  const themes = [
    ...(frontmatter.themes ?? []),
    ...(frontmatter.mentioned_themes ?? []),
  ];

  return {
    id: document.id,
    type: frontmatter.type,
    title: document.title,
    path: document.relativePath,
    date: frontmatter.date,
    themes: unique(themes),
    stocks: unique(stocks),
    tags: unique(frontmatter.tags ?? []),
    author: frontmatter.author,
    platform: frontmatter.platform,
    stance: frontmatter.stance,
    summary: document.excerpt,
    status: frontmatter.status,
    last_reviewed: frontmatter.last_reviewed,
    confidence: frontmatter.confidence,
    time_horizon: frontmatter.time_horizon,
    evidence_level: frontmatter.evidence_level,
  };
}

export async function readDocumentIndex(): Promise<DocumentIndexItem[]> {
  try {
    const raw = await readFile(INDEX_FILE, 'utf8');
    return JSON.parse(raw) as DocumentIndexItem[];
  } catch {
    return [];
  }
}

export async function writeDocumentIndex(items: DocumentIndexItem[]): Promise<void> {
  await ensureProjectDirectories();
  await writeFile(INDEX_FILE, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}
