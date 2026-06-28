import { z } from 'zod';
import type { LLMProvider, ChatOptions } from '../provider';

const KIMI_BASE = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn';
const KIMI_MODEL = process.env.MOONSHOT_VISION_MODEL || 'kimi-k2.6';

export class KimiProvider implements LLMProvider {
  readonly id = 'kimi';
  readonly capabilities = ['chat', 'vision'] as const;

  private getApiKey(): string {
    const key = process.env.MOONSHOT_API_KEY;
    if (!key) throw new Error('MOONSHOT_API_KEY 未设置');
    return key;
  }

  async chat(system: string, user: string, opts?: ChatOptions): Promise<string> {
    const res = await fetch(`${KIMI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getApiKey()}` },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: opts?.temperature ?? 1,
        max_tokens: opts?.maxTokens ?? 4096,
      }),
    });
    if (!res.ok) throw new Error(`Kimi API 错误: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // Kimi 不支持 structured output 和 stream（用 streamChat 代替）
  async structuredOutput<T>(schema: z.ZodType<T>, system: string, user: string, opts?: ChatOptions): Promise<T> {
    const text = await this.chat(system, user, opts);
    try {
      const json = JSON.parse(text);
      return schema.parse(json);
    } catch (err) {
      throw new Error(`Kimi 结构化输出解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }

  async *streamChat(system: string, user: string, opts?: ChatOptions & { onChunk?: (delta: string) => void }): AsyncIterable<string> {
    const res = await fetch(`${KIMI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getApiKey()}` },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: true,
        temperature: opts?.temperature ?? 1,
        max_tokens: opts?.maxTokens ?? 4096,
      }),
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`Kimi API 错误: ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            opts?.onChunk?.(delta);
            yield delta;
          }
        } catch { /* skip */ }
      }
    }
  }
}
