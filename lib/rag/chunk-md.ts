import type { DocumentFrontmatter } from '@/lib/types/document';
import type { ChunkMarkdownOptions, RagChunk, RagSourceDocument } from '@/lib/rag/types';

const DEFAULT_MIN_LENGTH = 300;
const DEFAULT_MAX_LENGTH = 500;
const CHUNK_OVERLAP = 150; // 相邻 chunk 重叠字符数，避免边界信息丢失（原 50 → 150）

/** 各文档类型的专属分块大小 */
const DOC_TYPE_LIMITS: Record<string, { min: number; max: number }> = {
  daily_review:   { min: 200, max: 300 },  // 复盘：短点，每段独立
  theme_research: { min: 400, max: 600 },  // 产业链：长点，保持完整性
  stock_profile:  { min: 400, max: 600 },  // 个股档案：同上
  viewpoint:      { min: 300, max: 500 },  // 观点：适中
};

interface MarkdownSection {
  headingPath: string[];
  content: string;
}

function compactText(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

/** 尝试在句尾附近断开，返回截断位置 */
function sentenceBreakPoint(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const before = text.slice(0, limit);
  // 优先找中文句尾，往回找到 > limit*0.5 的位置
  const boundary = Math.max(
    before.lastIndexOf('。'),
    before.lastIndexOf('！'),
    before.lastIndexOf('？'),
    before.lastIndexOf('）'),
    before.lastIndexOf('\n'),
  );
  if (boundary > Math.floor(limit * 0.5)) return boundary + 1;
  return limit; // 找不到就在 limit 处硬切
}

/**
 * 将大段文本按段落合并、过长的段落按句尾拆分，片间带重叠。
 *
 * 返回的字符串数组每个元素 ≈ maxLength 字符，相邻元素间有 CHUNK_OVERLAP 字符的重叠。
 */
function splitLargeText(text: string, maxLength: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!paragraphs.length) return [];

  const chunks: string[] = [];
  let current = '';
  let previousTail = '';

  /** 用上一个 chunk 的尾部作为下一个 chunk 的开头重叠 */
  function startWithOverlap(seed: string): string {
    if (!previousTail) return seed;
    const tail = previousTail.slice(-CHUNK_OVERLAP);
    if (tail.length + 2 + seed.length <= maxLength) {
      return tail + '\n\n' + seed;
    }
    return seed;
  }

  for (const paragraph of paragraphs) {
    if (!current) {
      current = startWithOverlap(paragraph);
      continue;
    }

    // 能合并：不超过上限
    if (current.length + paragraph.length + 2 <= maxLength) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    // 放不下，刷出 current
    if (isMeaningfulChunk(current)) {
      chunks.push(current);
      previousTail = current;
    }

    // 普通段落，直接开始新 chunk
    if (paragraph.length <= maxLength) {
      current = startWithOverlap(paragraph);
      continue;
    }

    // 超长段落：按句尾拆成多片，片间重叠
    let remaining = paragraph;
    while (remaining.length > 0) {
      const effectiveLimit = Math.min(remaining.length, maxLength);
      const cutAt = sentenceBreakPoint(remaining, effectiveLimit);
      if (cutAt <= 0) break;

      const piece = remaining.slice(0, cutAt);
      if (isMeaningfulChunk(piece)) {
        chunks.push(piece);
        previousTail = piece;
      }

      if (cutAt >= remaining.length) break;

      // 下一片从 cutAt - overlap 处开始，与上一片有重叠
      const nextStart = Math.max(0, cutAt - CHUNK_OVERLAP);
      if (nextStart === 0) break; // 无法重叠说明已到头
      remaining = remaining.slice(nextStart);
    }
    current = '';
  }

  if (current && isMeaningfulChunk(current)) {
    chunks.push(current);
  }

  return chunks;
}

function splitMarkdownIntoSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  const headingPath: string[] = [];
  let buffer: string[] = [];

  function flushSection() {
    const sectionContent = compactText(buffer.join('\n'));
    buffer = [];

    if (!sectionContent) {
      return;
    }

    sections.push({
      headingPath: [...headingPath],
      content: sectionContent,
    });
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (!headingMatch) {
      buffer.push(line);
      continue;
    }

    flushSection();
    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();
    headingPath.splice(level - 1);
    headingPath[level - 1] = title;
  }

  flushSection();
  return sections;
}

/** 过滤无意义的 chunk（资料不足、过短等） */
function isMeaningfulChunk(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || trimmed === '资料不足' || trimmed === '（未提供）') return false;
  if (trimmed.length < 30 && !trimmed.match(/[一-龥]/)) return false;
  return true;
}

function getStocks(frontmatter: DocumentFrontmatter): string[] {
  return Array.from(
    new Set([
      ...(frontmatter.stocks ?? []),
      ...(frontmatter.mentioned_stocks ?? []),
      ...(frontmatter.core_stocks ?? []),
      ...(frontmatter.stock_code ? [frontmatter.stock_code] : []),
    ]),
  );
}

function getThemes(frontmatter: DocumentFrontmatter): string[] {
  return Array.from(
    new Set([...(frontmatter.themes ?? []), ...(frontmatter.mentioned_themes ?? [])]),
  );
}

function buildChunkBase(document: RagSourceDocument) {
  return {
    docId: document.id,
    docPath: document.relativePath,
    docType: document.frontmatter.type,
    title: document.title,
    date: document.frontmatter.date,
    author: document.frontmatter.author,
    platform: document.frontmatter.platform,
    stance: document.frontmatter.stance,
    stocks: getStocks(document.frontmatter),
    themes: getThemes(document.frontmatter),
    tags: document.frontmatter.tags ?? [],
  };
}

export function chunkMarkdownDocument(
  document: RagSourceDocument,
  options: ChunkMarkdownOptions = {},
): RagChunk[] {
  // 按文档类型选择分块大小
  const docType = document.frontmatter.type;
  const limits = DOC_TYPE_LIMITS[docType];
  const minLength = options.minLength ?? limits?.min ?? DEFAULT_MIN_LENGTH;
  const maxLength = options.maxLength ?? limits?.max ?? DEFAULT_MAX_LENGTH;
  const sections = splitMarkdownIntoSections(document.content);
  const chunks: RagChunk[] = [];
  const chunkBase = buildChunkBase(document);
  let chunkIndex = 0;

  for (const section of sections) {
    const pieces = splitLargeText(section.content, maxLength);

    if (!pieces.length) {
      continue;
    }

    let merged = '';

    for (const piece of pieces) {
      if (!merged) {
        merged = piece;
        continue;
      }

      if (merged.length < minLength && merged.length + piece.length + 2 <= maxLength) {
        merged = `${merged}\n\n${piece}`;
        continue;
      }

      if (isMeaningfulChunk(merged)) {
        chunks.push({
          id: `${document.id}::${chunkIndex}`,
          ...chunkBase,
          headingPath: [...section.headingPath],
          content: merged,
        });
        chunkIndex += 1;
      }
      merged = piece;
    }

    if (!merged || !isMeaningfulChunk(merged)) {
      continue;
    }

    chunks.push({
      id: `${document.id}::${chunkIndex}`,
      ...chunkBase,
      headingPath: [...section.headingPath],
      content: merged,
    });
    chunkIndex += 1;
  }

  return chunks;
}
