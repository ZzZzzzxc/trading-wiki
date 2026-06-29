import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface EvalQuery {
  id: string;
  relevantDocIds: string[];
}

interface EvalResultEntry {
  id: string;
  relevantDocIds?: string[];
  [key: string]: unknown;
}

interface EvalHistoryEntry {
  results?: EvalResultEntry[];
  [key: string]: unknown;
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const source = await readFile(filePath, 'utf8');
    return source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const evalDir = path.join(process.cwd(), 'data/rag-eval');
    const entries = await readJsonLines<EvalHistoryEntry>(path.join(evalDir, 'results.jsonl'));
    const queries = await readJsonLines<EvalQuery>(path.join(evalDir, 'queries.jsonl'));
    const relevantById = new Map(queries.map((q) => [q.id, q.relevantDocIds]));
    const enriched = entries.map((entry) => ({
      ...entry,
      results: entry.results?.map((result) => ({
        ...result,
        relevantDocIds: result.relevantDocIds ?? relevantById.get(result.id) ?? [],
      })),
    }));

    return NextResponse.json({ ok: true, data: enriched });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
