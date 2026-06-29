import { NextResponse } from 'next/server';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/storage/paths';

const RUNS_FILE = path.join(DATA_DIR, 'agent-traces', 'runs.jsonl');
const EVENTS_DIR = path.join(DATA_DIR, 'agent-traces', 'events');

export async function GET() {
  const runs: Array<Record<string, unknown>> = [];
  try {
    const source = await readFile(RUNS_FILE, 'utf8');
    runs.push(...source.split('\n').filter(Boolean).map(line => JSON.parse(line)));
  } catch {}

  const seen = new Set(runs.map((run) => run.runId));
  try {
    const files = await readdir(EVENTS_DIR);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const runId = file.replace(/\.jsonl$/, '');
      if (seen.has(runId)) continue;

      const source = await readFile(path.join(EVENTS_DIR, file), 'utf8');
      const events = source.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const started = events.find((event) => event.type === 'run_started');
      if (!started) continue;

      const finished = [...events].reverse().find((event) => event.type === 'run_finished');
      const error = [...events].reverse().find((event) => event.type === 'run_error')?.error;
      const stepCount = events.filter((event) => event.type === 'step_started').length;
      const reportDone = [...events].reverse().find((event) => event.type === 'report_done');
      const finalAnswer = ((reportDone?.data as { report?: string } | undefined)?.report || '') as string;

      runs.push({
        runId,
        userQuery: started.userQuery,
        status: finished?.status || 'running',
        startedAt: started.timestamp,
        endedAt: finished?.timestamp,
        latencyMs: finished?.latencyMs,
        config: started.config,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
        steps: stepCount,
        finalAnswer: finalAnswer.slice(0, 100),
        error,
      });
    }
  } catch {}

  const sorted = runs
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    .slice(0, 50);
  return NextResponse.json({ ok: true, data: sorted });
}
