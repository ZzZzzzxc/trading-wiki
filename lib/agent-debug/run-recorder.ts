import { mkdir, appendFile, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { DATA_DIR } from '@/lib/storage/paths';
import type { AgentStep, AgentStepType, AgentDebugEvent, AgentRun, AgentError, AgentErrorType } from './types';

const TRACES_DIR = path.join(DATA_DIR, 'agent-traces');

function now() { return new Date().toISOString(); }

function classifyError(err: unknown): AgentError {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || msg.includes('timeout') || msg.includes('abort')) {
    return { type: 'timeout', message: msg };
  }
  if (msg.includes('rate') || msg.includes('429')) return { type: 'rate_limited', message: msg };
  if (msg.includes('parse') || msg.includes('JSON') || msg.includes('JSON')) return { type: 'llm_json_parse_failed', message: msg };
  if (msg.includes('tool') || msg.includes('tool')) return { type: 'tool_call_failed', message: msg };
  if (msg.includes('provider') || msg.includes('API') || msg.includes('fetch')) return { type: 'provider_unavailable', message: msg };
  if (msg.includes('rag') || msg.includes('检索')) return { type: 'rag_no_results', message: msg };
  return { type: 'unknown', message: msg };
}

async function cleanOldTraces(): Promise<void> {
  try {
    const eventsDir = path.join(TRACES_DIR, 'events');
    const files = await readdir(eventsDir);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(eventsDir, file);
      try {
        const stat = await import('node:fs').then(fs => fs.statSync(filePath));
        if (stat.mtimeMs < sevenDaysAgo) {
          await rm(filePath);
        }
      } catch {}
    }
    // 也清理 runs.jsonl 中的旧条目
    const runsFile = path.join(TRACES_DIR, 'runs.jsonl');
    try {
      const source = await readFile(runsFile, 'utf8');
      const lines = source.split('\n').filter(Boolean);
      const kept = lines.filter(line => {
        try {
          const entry = JSON.parse(line);
          const age = Date.now() - new Date(entry.startedAt || 0).getTime();
          return age < 7 * 24 * 60 * 60 * 1000;
        } catch { return false; }
      });
      if (kept.length < lines.length) {
        await writeFile(runsFile, kept.join('\n') + '\n', 'utf8');
      }
    } catch {}
  } catch {}
}

export class RunRecorder {
  readonly runId: string;
  private events: AgentDebugEvent[] = [];
  private traceDir: string;
  private run: AgentRun;
  private eventPersistFailed = false;

  constructor(userQuery: string, config: { depth: string; focus: string; debate: boolean }) {
    this.runId = `agent_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    this.traceDir = TRACES_DIR;
    this.run = {
      runId: this.runId,
      userQuery,
      status: 'running',
      startedAt: now(),
      config,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      steps: [],
    };
    this.appendEvent({ type: 'run_started', runId: this.runId, userQuery, config });
  }

  async step<T>(name: string, type: AgentStepType, fn: () => Promise<T>, stepId?: string): Promise<T> {
    const sid = stepId || crypto.randomUUID();
    const startedAt = Date.now();
    const step: AgentStep = { stepId: sid, runId: this.runId, type, name, status: 'running', startedAt: now() };
    this.run.steps.push(step);
    this.appendEvent({ type: 'step_started', runId: this.runId, stepId: sid, name, stepType: type });

    try {
      const output = await fn();
      step.status = 'success';
      step.endedAt = now();
      step.latencyMs = Date.now() - startedAt;
      step.output = output;
      this.appendEvent({ type: 'step_finished', runId: this.runId, stepId: sid, latencyMs: step.latencyMs, status: 'success' });
      return output;
    } catch (err) {
      step.status = 'failed';
      step.endedAt = now();
      step.latencyMs = Date.now() - startedAt;
      step.error = classifyError(err);
      this.appendEvent({ type: 'run_error', runId: this.runId, stepId: sid, error: step.error });
      throw err;
    }
  }

  /** 手动开始一个步骤（适用于无法用 step() 包裹的异步循环） */
  startStep(stepId: string, name: string, type: AgentStepType): void {
    this.run.steps.push({ stepId, runId: this.runId, type, name, status: 'running', startedAt: now() });
    this.appendEvent({ type: 'step_started', runId: this.runId, stepId, name, stepType: type });
  }

  /** 手动结束一个步骤 */
  finishStep(stepId: string, status: 'success' | 'failed'): void {
    const step = this.run.steps.find(s => s.stepId === stepId);
    if (step) {
      step.status = status;
      step.endedAt = now();
      step.latencyMs = Date.now() - new Date(step.startedAt).getTime();
    }
    this.appendEvent({ type: 'step_finished', runId: this.runId, stepId, status, latencyMs: step?.latencyMs });
  }

  /** 记录 LLM 调用 */
  recordLlmCall(stepId: string, prompt: { system: string; user: string }, response: string, latencyMs: number, tokens?: { input: number; output: number }): void {
    this.appendEvent({ type: 'llm_call', runId: this.runId, stepId, prompt, response, latencyMs, tokens });
    // 同步更新 step 上的 prompt/response/tokens 供查询
    const step = this.run.steps.find(s => s.stepId === stepId);
    if (step) {
      step.prompt = prompt;
      step.response = response;
      step.tokens = tokens || { input: 0, output: 0 };
    }
  }

  /** 记录工具调用开始（入参） */
  recordToolCallStart(stepId: string, toolName: string, args: Record<string, unknown>): void {
    this.appendEvent({ type: 'tool_call', runId: this.runId, stepId, toolName, args, phase: 'start' });
  }

  /** 记录工具调用结束（出参） */
  recordToolCallEnd(stepId: string, toolName: string, result: unknown): void {
    this.appendEvent({ type: 'tool_call', runId: this.runId, stepId, toolName, result, phase: 'end' });
  }

  /** 记录工具调用（兼容旧接口，同时记录入参和出参） */
  recordToolCall(stepId: string, toolName: string, args: Record<string, unknown>, result: unknown): void {
    this.recordToolCallStart(stepId, toolName, args);
    this.recordToolCallEnd(stepId, toolName, result);
  }

  /** 记录 RAG 检索 */
  recordRagRetrieve(stepId: string, query: string, resultsCount: number, topK: number): void {
    this.appendEvent({ type: 'rag_retrieve', runId: this.runId, stepId, query, resultsCount, topK });
  }

  /** 记录研究过程中的结构化状态（coverage/evidence/summary 等） */
  recordResearchEvent(stepId: string, type: string, data: unknown): void {
    this.appendEvent({ type, runId: this.runId, stepId, data });
  }

  async finish(finalAnswer?: string, error?: AgentError): Promise<void> {
    this.run.status = error ? 'failed' : 'success';
    this.run.endedAt = now();
    this.run.latencyMs = Date.now() - new Date(this.run.startedAt).getTime();
    this.run.finalAnswer = finalAnswer;
    if (error) this.run.error = error;

    this.appendEvent({ type: 'run_finished', runId: this.runId, status: this.run.status, latencyMs: this.run.latencyMs });

    // 写文件
    try {
      await mkdir(this.traceDir, { recursive: true });
      await mkdir(path.join(this.traceDir, 'events'), { recursive: true });
      // 追加 run 摘要
      await appendFile(
        path.join(this.traceDir, 'runs.jsonl'),
        JSON.stringify({ runId: this.runId, userQuery: this.run.userQuery, status: this.run.status,
          startedAt: this.run.startedAt, endedAt: this.run.endedAt, latencyMs: this.run.latencyMs,
          config: this.run.config, model: this.run.model, steps: this.run.steps.length,
          finalAnswer: this.run.finalAnswer?.slice(0, 100), error: this.run.error }) + '\n',
        'utf8',
      );
      if (this.eventPersistFailed) {
        await writeFile(
          path.join(this.traceDir, 'events', `${this.runId}.jsonl`),
          this.events.map(e => JSON.stringify(e)).join('\n') + '\n',
          'utf8',
        );
      }
    } catch (err) {
      console.error('[agent-debug] 写入 trace 失败:', err);
    }

    // fire-and-forget: 清理 7 天前的旧 trace
    cleanOldTraces().catch(() => {});
  }

  private appendEvent(event: AgentDebugEvent): void {
    const stamped = { ...event, timestamp: now() };
    this.events.push(stamped);
    this.persistEvent(stamped);
  }

  private persistEvent(event: AgentDebugEvent): void {
    if (this.eventPersistFailed) return;
    try {
      const eventsDir = path.join(this.traceDir, 'events');
      mkdirSync(eventsDir, { recursive: true });
      appendFileSync(path.join(eventsDir, `${this.runId}.jsonl`), JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      this.eventPersistFailed = true;
      console.error('[agent-debug] 增量写入 trace 失败:', err);
    }
  }
}
