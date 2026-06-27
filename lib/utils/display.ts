import type { DocumentType } from '@/lib/types/document';
import type { ViewpointExtractionResult } from '@/lib/types/viewpoint';

export const documentTypeLabels: Record<DocumentType, string> = {
  daily_review: '每日复盘',
  viewpoint: '观点蒸馏',
  theme_research: '产业链研究',
  stock_profile: '个股档案',
  note: '个人笔记',
  raw: '原始资料',
  qa: '知识库问答',
  material: '素材',
};

export const viewpointStanceLabels: Record<ViewpointExtractionResult['stance'], string> = {
  bullish: '看多',
  bearish: '看空',
  neutral: '中性',
  watch: '观察',
};

export const viewpointTimeHorizonLabels: Record<
  ViewpointExtractionResult['time_horizon'],
  string
> = {
  intraday: '日内',
  short: '短期',
  mid: '中期',
  long: '长期',
  unknown: '未知',
};

export const viewpointConfidenceLabels: Record<
  ViewpointExtractionResult['confidence'],
  string
> = {
  low: '低',
  medium: '中',
  high: '高',
};

const documentTypeBadgeClass: Record<string, string> = {
  daily_review: 'type-badge-review',
  viewpoint: 'type-badge-viewpoint',
  theme_research: 'type-badge-theme',
  stock_profile: 'type-badge-stock',
  note: 'type-badge-note',
  raw: 'type-badge-raw',
  qa: 'type-badge-note',
  material: 'type-badge-material',
};

/** 按文档类型分组权重排序（复盘 > 观点 > 研究 > 档案 > 笔记 > 原始） */
export const docTypePriority: Record<string, number> = {
  material: 0,
  daily_review: 1,
  viewpoint: 2,
  theme_research: 3,
  stock_profile: 4,
  note: 5,
  raw: 6,
  qa: 7,
};

export function getDocumentTypeLabel(value: DocumentType): string {
  return documentTypeLabels[value] ?? value;
}

export function getDocumentTypeBadgeClass(value: string): string {
  return documentTypeBadgeClass[value] ?? 'type-badge-note';
}

export function getViewpointStanceLabel(
  value: ViewpointExtractionResult['stance'],
): string {
  return viewpointStanceLabels[value] ?? value;
}

export function getViewpointTimeHorizonLabel(
  value: ViewpointExtractionResult['time_horizon'],
): string {
  return viewpointTimeHorizonLabels[value] ?? value;
}

export function getViewpointConfidenceLabel(
  value: ViewpointExtractionResult['confidence'],
): string {
  return viewpointConfidenceLabels[value] ?? value;
}

/** 根据文档类型和 ID 生成详情页链接 */
export function getDocumentHref(docType: string, docId: string): string {
  const map: Record<string, string> = {
    viewpoint: '/viewpoints',
    daily_review: '/reviews',
    theme_research: '/themes',
    stock_profile: '/stocks',
    note: '/notes',
    material: '/materials',
    qa: '/ask',
  };
  return `${map[docType] ?? '/dashboard'}/${docId}`;
}

/** 文档类型筛选选项（共享常量） */
export const DOC_TYPE_OPTIONS = [
  { label: '素材', value: 'material' as const },
  { label: '每日复盘', value: 'daily_review' as const },
  { label: '观点蒸馏', value: 'viewpoint' as const },
  { label: '产业链研究', value: 'theme_research' as const },
  { label: '个股档案', value: 'stock_profile' as const },
  { label: '个人笔记', value: 'note' as const },
  { label: '原始资料', value: 'raw' as const },
];

/** 相对时间格式化 */
export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return dateStr; // 未来日期
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + '分钟前';
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour + '小时前';
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return diffDay + '天前';
  return dateStr;
}

