import { z } from 'zod';
import { normalizeAiOutput } from '@/lib/ai/normalize';

const deepSeekChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getDeepSeekConfig() {
  return {
    apiKey: getRequiredEnv('DEEPSEEK_API_KEY'),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro',
  };
}

export function getKimiConfig() {
  return {
    apiKey: getRequiredEnv('MOONSHOT_API_KEY'),
    baseUrl: process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn',
    model: process.env.MOONSHOT_VISION_MODEL ?? 'kimi-k2.6',
  };
}

/** 各模块输出必须包含的核心字段签名 */
const OUTPUT_SIGNATURES: Array<{ required: string[] }> = [
  { required: ['summary', 'stance', 'facts'] },           // viewpoint
  { required: ['date', 'market_phase', 'main_themes'] },  // review
  { required: ['title', 'upstream', 'personal_judgment'] }, // theme
  { required: ['stock_name', 'main_business', 'risks'] }, // stock
];

function isKnownOutput(obj: Record<string, unknown>): boolean {
  return OUTPUT_SIGNATURES.some((sig) =>
    sig.required.every((key) => key in obj),
  );
}

/** 从给定位置开始，按大括号深度匹配找到配对的 } */
function findMatchingBrace(content: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonObject(content: string): string {
  const trimmed = content.trim();

  // 策略 1: markdown 代码块
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return extractJsonObject(fencedMatch[1].trim());
  }

  // 收集所有 { 位置
  const bracePositions: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') bracePositions.push(i);
  }
  if (!bracePositions.length) {
    throw new Error('Model did not return a JSON object.');
  }

  // 策略 2: 从最后一个 { 尝试（最可能是真正的 JSON 起始位置）
  const candidates = [
    trimmed.lastIndexOf('{'),
    trimmed.indexOf('{'),
    ...bracePositions.reverse().slice(2, 10), // 另外取 8 个候选位置
  ].filter((p, i, arr) => p >= 0 && arr.indexOf(p) === i);

  // 第一轮：尝试匹配已知模块签名（精确匹配，避免中间 JSON 块）
  for (const start of candidates) {
    const candidate = findMatchingBrace(trimmed, start);
    if (!candidate) continue;
    try {
      const obj = JSON.parse(candidate);
      if (typeof obj === 'object' && obj !== null && isKnownOutput(obj)) {
        return candidate;
      }
    } catch {
      // 继续尝试
    }
  }

  // 第二轮：退回到任意有效 JSON 对象
  for (const start of candidates) {
    const candidate = findMatchingBrace(trimmed, start);
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // 继续尝试
    }
  }

  throw new Error('Model did not return a valid JSON object.');
}

export async function callDeepSeekStructuredOutput<T>(
  schema: z.ZodType<T>,
  prompts: {
    system: string;
    user: string;
  },
): Promise<T> {
  const text = await providerRegistry.getForTask('structured').chat(prompts.system, prompts.user);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('结构化输出解析失败: 未找到 JSON');
  const json = JSON.parse(match[0]);
  const normalized = normalizeAiOutput(json);
  return schema.parse(normalized);
}

import { providerRegistry } from './provider-registry';
import { DeepSeekProvider } from './providers/deepseek';
import { KimiProvider } from './providers/kimi';

// 启动时自动注册
if (!providerRegistry.get('deepseek')) {
  providerRegistry.register('deepseek', new DeepSeekProvider(), ['generation', 'structured', 'stream']);
}
if (!providerRegistry.get('kimi')) {
  providerRegistry.register('kimi', new KimiProvider(), ['vision']);
}
