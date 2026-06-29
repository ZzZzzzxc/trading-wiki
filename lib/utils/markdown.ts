/**
 * 轻量 Markdown → HTML 渲染器。
 * 不依赖外部库，处理投研文档中最常用的 Markdown 语法。
 */

interface RenderState {
  inCodeBlock: boolean;
  inList: 'ul' | 'ol' | null;
  codeBlockContent: string;
  codeBlockLang: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const DOC_TYPE_URLS: Record<string, string> = {
  material: '/materials',
  viewpoint: '/viewpoints',
  daily_review: '/reviews',
  theme_research: '/themes',
  stock_profile: '/stocks',
  note: '/notes',
};

function renderInline(text: string): string {
  // 第一步：转义 HTML（安全防护）
  let result = escapeHtml(text);

  // 引用标记 [N] → 上标标签
  result = result.replace(/\[(\d+)\]/g, '<sup class="md-source-tag md-source-original" style="cursor:pointer">[$1]</sup>');

  // 还原已存储的 <sup> 标签（旧版 markdown 构建器注入了原始 HTML）
  result = result.replace(/&lt;(\/?sup[\s\S]*?)&gt;/g, (match: string, tag: string) => {
    // 将 &quot; 还原为 "，&amp; 还原为 &，cursor:help → cursor:pointer
    const restored = '<' + tag.replace(/&quot;/g, '"').replace(/&amp;/g, '&') + '>';
    return tag.startsWith('sup ') || !tag.startsWith('/')
      ? restored.replace(/cursor:help/g, 'cursor:pointer')
      : restored;
  });

  // 第二步：处理 Markdown 行内语法
  // 行内代码
  result = result.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

  // 素材引用链接 [素材:docId:type] → 可点击的标签
  result = result.replace(/\[素材:([^:]+):([^\]]+)\]/g, (match, docId, type) => {
    const base = DOC_TYPE_URLS[type] || '/materials';
    return `<a href="${base}/${encodeURIComponent(docId)}" class="material-link" target="_blank">📎 查看原文</a>`;
  });

  // 引用标记 [N] → 上标标签
  result = result.replace(/\[(\d+)\]/g, '<sup class="md-source-tag md-source-original" style="cursor:default">[$1]</sup>');

  // 图片（必须在链接之前处理）
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="md-image" loading="lazy" />',
  );

  // 链接
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener">$1</a>',
  );

  // 粗体
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 斜体
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 来源引用标签 [原文] [推断] [风险] 等
  result = result.replace(
    /\[(原文|原文\+推断|作者观点|推断|风险|反证|市场输入|关注人:[^\]]+|历史:[^\]]+|个人观察|个人补充|个人判断|资料|公司资料|公告|新闻|综合关注人观点|反证推断)\]/g,
    (match, label) => {
      const cls = getSourceTagClass(label);
      return `<span class="md-source-tag ${cls}">${match}</span>`;
    },
  );

  return result;
}

function getSourceTagClass(label: string): string {
  if (label.startsWith('原文')) return 'md-source-original';
  if (label.startsWith('作者') || label.startsWith('关注人') || label.startsWith('综合')) return 'md-source-opinion';
  if (label.startsWith('推断')) return 'md-source-infer';
  if (label.startsWith('风险')) return 'md-source-risk';
  if (label.startsWith('反证')) return 'md-source-counter';
  if (label.startsWith('市场')) return 'md-source-market';
  if (label.startsWith('个人')) return 'md-source-personal';
  if (label.startsWith('历史')) return 'md-source-original';
  if (['资料', '公司资料', '公告', '新闻'].includes(label)) return 'md-source-market';
  return 'md-source-personal';
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  const state: RenderState = {
    inCodeBlock: false,
    inList: null,
    codeBlockContent: '',
    codeBlockLang: '',
  };

  function flushList() {
    if (state.inList) {
      output.push(`</${state.inList}>`);
      state.inList = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();

    // 代码块
    if (line.startsWith('```')) {
      if (state.inCodeBlock) {
        // 结束代码块
        const langAttr = state.codeBlockLang
          ? ` data-lang="${escapeHtml(state.codeBlockLang)}"`
          : '';
        output.push(
          `<pre class="md-code-block"${langAttr}><code>${escapeHtml(state.codeBlockContent)}</code></pre>`,
        );
        state.inCodeBlock = false;
        state.codeBlockContent = '';
        state.codeBlockLang = '';
      } else {
        // 开始代码块
        flushList();
        state.inCodeBlock = true;
        state.codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (state.inCodeBlock) {
      state.codeBlockContent += (state.codeBlockContent ? '\n' : '') + rawLine;
      continue;
    }

    // 空行
    if (!line.trim()) {
      flushList();
      continue;
    }

    // 水平线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushList();
      output.push('<hr class="md-hr" />');
      continue;
    }

    // 表格
    if (/^\|.+\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[-:\s|]+\|$/.test(lines[i + 1].trim())) {
      flushList();
      const headerRow = line;
      const sepRow = lines[i + 1];
      const tableLines: string[] = [headerRow, sepRow];
      i += 2;
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;

      const alignCells = sepRow.trim().split('|').filter(c => c.trim().length > 0);
      const aligns = alignCells.map(cell => {
        const c = cell.trim();
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });

      const rows = tableLines.map((row, rowIdx) => {
        if (rowIdx === 1) return null; // 跳过表头分隔行
        const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        const tag = rowIdx === 0 ? 'th' : 'td';
        const cellsHtml = cells.map((cell, ci) => {
          const align = aligns[ci] || 'left';
          const alignStyle = align !== 'left' ? ` style="text-align:${align}"` : '';
          return `<${tag}${alignStyle}>${renderInline(cell.trim())}</${tag}>`;
        }).join('');
        return `<tr>${cellsHtml}</tr>`;
      }).filter(Boolean);

      const thead = `<thead>${rows[0]}</thead>`;
      const tbody = rows.slice(1).join('');
      output.push(`<table class="md-table">${thead}<tbody>${tbody}</tbody></table>`);
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      output.push(`<h${level} class="md-heading md-h${level}">${renderInline(text)}</h${level}>`);
      continue;
    }

    // 无序列表
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      if (state.inList !== 'ul') {
        flushList();
        output.push('<ul class="md-list md-ul">');
        state.inList = 'ul';
      }
      output.push(`<li>${renderInline(ulMatch[1])}</li>`);
      continue;
    }

    // 有序列表
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (state.inList !== 'ol') {
        flushList();
        output.push('<ol class="md-list md-ol">');
        state.inList = 'ol';
      }
      output.push(`<li>${renderInline(olMatch[1])}</li>`);
      continue;
    }

    // 普通段落
    flushList();
    output.push(`<p class="md-paragraph">${renderInline(line)}</p>`);
  }

  // 收尾
  flushList();

  // 未闭合的代码块
  if (state.inCodeBlock) {
    const langAttr = state.codeBlockLang
      ? ` data-lang="${escapeHtml(state.codeBlockLang)}"`
      : '';
    output.push(
      `<pre class="md-code-block"${langAttr}><code>${escapeHtml(state.codeBlockContent)}</code></pre>`,
    );
  }

  return output.join('\n');
}
