/**
 * 中文分词 + BM25 关键词评分。
 *
 * 分词策略：基于 tokenizeForEmbedding 的 unigram+bigram 方案，
 * 叠加小词典正向最大匹配（覆盖投资领域常见复合词）。
 * BM25 参数 k1=1.5, b=0.75。
 */

import { tokenizeForEmbedding } from '@/lib/rag/embed';

// ---- 小型中文投资词典（正向最大匹配用） ----

// 按长度降序排列，优先匹配长词
const DICT: string[] = [
  '光纤光缆', '玻璃基板', '半导体', '数据中心', '人工智能', '消费电子',
  '智能驾驶', '物联网', '工业互联网', '车联网', '新能源', '光伏',
  '锂电池', '钠电池', '氢能', '储能', '智能电网', '生物医药', '创新药',
  '医疗器械', '功率器件', '激光雷达', '光模块', '光通信', '光器件',
  '光芯片', '化合物半导体', '第三代半导体', '先进封装', '晶圆代工',
  '操作系统', '基础软件', '工业软件', '网络安全', '数字经济', '元宇宙',
  'MiniLED', 'MicroLED', 'OLED', '显示面板', '液晶面板', '印刷电路板',
  '电子布', '复合材料', '碳纤维', '超高纯石英砂', '光纤预制棒',
  '注意力经济', '首发经济', '银发经济',
  '涨停', '跌停', '放量', '缩量', '突破', '支撑', '压力', '反弹', '回调',
  '震荡', '趋势', '板块', '个股', '大盘', '指数', '资金', '主力', '游资',
  '机构', '仓位', '建仓', '加仓', '减仓', '清仓', '止盈', '止损',
  '追高', '低吸', '打板', '高开', '低开', '冲高', '回落', '拉升', '砸盘',
  '护盘', '洗盘', '出货', '吸筹', '做多', '做空', '利好', '利空',
  '财报', '营收', '净利润', '毛利', '毛利率', '净利率', 'ROE',
  '市盈率', '市净率', '市销率', '产能', '订单', '市占率', '竞品',
  '渗透率', '国产替代', '自主可控', '供应链',
  '上调', '下调', '增持', '减持', '买入', '卖出', '评级',
  '上证', '深证', '创业板', '科创50', '沪深',
];

// ---- 分词 ----

/**
 * 分词入口，兼容 BM25 和现有评分。
 * 返回 token 数组（含重复，用于 TF 统计）。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 按汉字/非汉字/英文+数字分组
  const segments = text.match(/[一-鿿]+|[a-zA-Z0-9]+/gu) ?? [];

  for (const seg of segments) {
    if (/^[一-鿿]+$/u.test(seg)) {
      // 中文：词典分词 + bigram 回退
      const words = dictSegment(seg);
      tokens.push(...words);
      // bigram 兜底覆盖词典未登录词
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg.slice(i, i + 2));
      }
    } else {
      tokens.push(seg.toLowerCase());
    }
  }

  return tokens;
}

/** 正向最大匹配中文分词 */
function dictSegment(text: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < text.length) {
    let matched = false;
    // 先尝试长词（最长 4 个字）
    for (let len = Math.min(4, text.length - i); len >= 2; len--) {
      const candidate = text.slice(i, i + len);
      if (DICT.includes(candidate)) {
        words.push(candidate);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      words.push(text[i]);
      i++;
    }
  }
  return words;
}

// ---- BM25 评分 ----

export interface Bm25Config {
  k1: number; // 词频饱和度（默认 1.5）
  b: number;  // 长度归一化（默认 0.75）
}

const DEFAULT_BM25: Bm25Config = { k1: 1.5, b: 0.75 };

/**
 * 计算 BM25 得分。
 * @param queryTokens 查询 Token
 * @param docTokens   文档 Token
 * @param avgDocLen   语料平均文档长度
 * @param config      BM25 参数
 */
export function computeBm25Score(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  config: Bm25Config = DEFAULT_BM25,
): number {
  if (!queryTokens.length || !docTokens.length) return 0;

  const docLen = docTokens.length;
  const { k1, b } = config;

  // 计算文档中每个 term 的 TF
  const tf = new Map<string, number>();
  for (const token of docTokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  let score = 0;
  const seen = new Set<string>();

  for (const token of queryTokens) {
    if (seen.has(token)) continue;
    seen.add(token);

    const termFreq = tf.get(token) ?? 0;
    if (termFreq === 0) continue;

    // IDF: 假设 avgDocLen 代表的语料中有 N 篇文档
    // 简化处理：高频词（常见 bigram）IDF 低，低频词 IDF 高
    const idf = Math.log(1 + (avgDocLen - termFreq + 0.5) / (termFreq + 0.5));
    const tfNorm = termFreq * (k1 + 1) / (termFreq + k1 * (1 - b + b * docLen / avgDocLen));

    score += idf * tfNorm;
  }

  return Math.min(score / queryTokens.length, 1); // 归一化到 0-1
}

/** 估计语料的平均 token 长度 */
export function estimateAvgDocLength(chunks: Array<{ content: string }>): number {
  if (!chunks.length) return 200;
  const total = chunks.reduce((sum, c) => sum + tokenize(c.content).length, 0);
  return Math.max(50, total / chunks.length);
}
