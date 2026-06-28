import { NextResponse } from 'next/server';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/storage/paths';

const FEEDBACK_FILE = path.join(DATA_DIR, 'agent-traces', 'feedback.jsonl');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const feedback = { ...body, createdAt: new Date().toISOString() };
    await mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
    await appendFile(FEEDBACK_FILE, JSON.stringify(feedback) + '\n', 'utf8');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: '提交失败' }, { status: 500 });
  }
}
