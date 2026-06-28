import type { z } from 'zod';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'finish';
  content?: string;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

export interface LLMProvider {
  /** 唯一标识 */
  readonly id: string;

  /** 普通对话 */
  chat(system: string, user: string, opts?: ChatOptions): Promise<string>;

  /** 结构化输出（JSON mode） */
  structuredOutput<T>(
    schema: z.ZodType<T>,
    system: string,
    user: string,
    opts?: ChatOptions,
  ): Promise<T>;

  /** 流式对话 */
  streamChat(
    system: string,
    user: string,
    opts?: ChatOptions & { onChunk?: (delta: string) => void },
  ): AsyncIterable<string>;

  /** 提供商能力标识 */
  readonly capabilities: readonly ('chat' | 'structured' | 'stream' | 'vision' | 'tools')[];
}
