import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/storage/paths';

const RUNS_FILE = path.join(DATA_DIR, 'agent-traces', 'runs.jsonl');

export async function GET() {
  try {
    const source = await readFile(RUNS_FILE, 'utf8');
    const runs = source.split('\n').filter(Boolean).map(line => JSON.parse(line)).reverse().slice(0, 50);
    return NextResponse.json({ ok: true, data: runs });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
