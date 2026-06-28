import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/storage/paths';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const source = await readFile(path.join(DATA_DIR, 'agent-traces', 'events', `${runId}.jsonl`), 'utf8');
    const events = source.split('\n').filter(Boolean).map(line => JSON.parse(line));
    // 提取 run 级别信息
    const runStartedEvent = events.find(e => e.type === 'run_started');
    const runFinishedEvent = events.find(e => e.type === 'run_finished');
    return NextResponse.json({ ok: true, data: { events, startedAt: runStartedEvent?.timestamp, finishedAt: runFinishedEvent?.timestamp } });
  } catch {
    return NextResponse.json({ ok: false, error: '未找到 trace' }, { status: 404 });
  }
}
