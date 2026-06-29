/**
 * RAG 检索评测脚本。
 *
 * 走完整检索管线（源路由 + 动态权重 + rerank + MMR），评估命中率。
 *
 * 用法: tsx scripts/eval-rag.ts
 *       tsx scripts/eval-rag.ts --no-rerank
 *       tsx scripts/eval-rag.ts --no-mmr
 *       tsx scripts/eval-rag.ts --default-weights
 */
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { runRagRetrieval } from '@/lib/rag/pipeline';

interface EvalQuery {
  id: string;
  query: string;
  relevantDocIds: string[];
  category: string;
  note?: string;
}

interface EvalResult {
  id: string;
  query: string;
  category: string;
  intent: string;
  hitRate5: boolean;
  hitRate10: boolean;
  mrr: number;
  firstRank: number | null;
  relevantDocIds: string[];
  topKIds: string[];
  note?: string;
}

interface EvalReport {
  timestamp: string;
  config: string;
  total: number;
  validTotal: number;
  hitRate5: number;
  hitRate10: number;
  mrr: number;
  byCategory: Record<string, { count: number; hitRate5: number; hitRate10: number; mrr: number }>;
  results: EvalResult[];
}

async function loadQueries(): Promise<EvalQuery[]> {
  const source = await readFile(path.join(process.cwd(), 'data/rag-eval/queries.jsonl'), 'utf8');
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalQuery);
}

function computeMetrics(retrievedIds: string[], relevantIds: string[], topK: number): {
  hit: boolean;
  firstRank: number | null;
  mrr: number;
} {
  let firstRank: number | null = null;
  for (let i = 0; i < Math.min(retrievedIds.length, topK); i++) {
    if (relevantIds.includes(retrievedIds[i])) {
      firstRank = i + 1;
      break;
    }
  }
  return {
    hit: firstRank !== null,
    firstRank,
    mrr: firstRank !== null ? 1 / firstRank : 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const noRerank = args.includes('--no-rerank');
  const noMmr = args.includes('--no-mmr');
  const defaultWeights = args.includes('--default-weights');

  const configParts: string[] = [];
  if (noRerank) configParts.push('no-rerank');
  if (noMmr) configParts.push('no-mmr');
  if (defaultWeights) configParts.push('default-weights');
  const configName = configParts.length ? configParts.join('+') : 'full';

  console.log(`\nRAG Eval: ${configName}`);
  console.log('-'.repeat(50));

  const queries = await loadQueries();
  const validQueries = queries.filter((q) => q.relevantDocIds.length > 0);
  console.log(`加载 ${queries.length} 条测试 query，其中有 ${validQueries.length} 条带标注\n`);

  const results: EvalResult[] = [];

  for (const q of queries) {
    // 走完整管线：源路由 → 动态权重 → 检索 → rerank → MMR
    const rag = await runRagRetrieval(q.query, {
      topK: 10,
      weights: defaultWeights
        ? { vector: 0.6, keyword: 0.15, metadata: 0.1, freshness: 0.15 }
        : undefined,
      enableRerank: !noRerank,
      enableMmr: !noMmr,
      mmrLambda: 0.7,
    });

    const retrievedIds = rag.hits.map((h) => h.chunk.docId);

    let top5: ReturnType<typeof computeMetrics>;
    let top10: ReturnType<typeof computeMetrics>;
    if (q.relevantDocIds.length === 0) {
      top5 = { hit: false, firstRank: null, mrr: 0 };
      top10 = { hit: false, firstRank: null, mrr: 0 };
    } else {
      top5 = computeMetrics(retrievedIds, q.relevantDocIds, 5);
      top10 = computeMetrics(retrievedIds, q.relevantDocIds, 10);
    }

    results.push({
      id: q.id,
      query: q.query,
      category: q.category,
      intent: rag.route.intent,
      hitRate5: top5.hit,
      hitRate10: top10.hit,
      mrr: top10.mrr,
      firstRank: top10.firstRank,
      relevantDocIds: q.relevantDocIds,
      topKIds: retrievedIds,
      note: q.note,
    });

    const hasRel = q.relevantDocIds.length > 0;
    const status = !hasRel ? '⏭️' : top5.hit ? '✅' : top10.hit ? '⚠️' : '❌';
    const rankStr = top10.firstRank ? `#${top10.firstRank}` : '-';
    console.log(`${status} ${q.id} ${q.query.slice(0, 28).padEnd(30)} intent=${rag.route.intent.padEnd(12)} hit@5=${hasRel ? (top5.hit ? 1 : 0) : '-'} best=${rankStr}`);
  }

  // Aggregate (只算有标注的)
  const validResults = results.filter((r) => {
    const q = queries.find((qq) => qq.id === r.id);
    return q && q.relevantDocIds.length > 0;
  });

  const total = validResults.length;
  const hitRate5 = validResults.filter((r) => r.hitRate5).length / total;
  const hitRate10 = validResults.filter((r) => r.hitRate10).length / total;
  const mrr = validResults.reduce((s, r) => s + r.mrr, 0) / total;

  // By category
  const byCategory: EvalReport['byCategory'] = {};
  for (const r of results) {
    const q = queries.find((qq) => qq.id === r.id);
    if (!q || q.relevantDocIds.length === 0) continue;
    if (!byCategory[r.category]) byCategory[r.category] = { count: 0, hitRate5: 0, hitRate10: 0, mrr: 0 };
    byCategory[r.category].count++;
    byCategory[r.category].hitRate5 += r.hitRate5 ? 1 : 0;
    byCategory[r.category].hitRate10 += r.hitRate10 ? 1 : 0;
    byCategory[r.category].mrr += r.mrr;
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].hitRate5 /= byCategory[cat].count;
    byCategory[cat].hitRate10 /= byCategory[cat].count;
    byCategory[cat].mrr /= byCategory[cat].count;
  }

  // Print report
  console.log('\n' + '='.repeat(55));
  console.log(`配置: ${configName}`);
  console.log(`有效 query: ${total}/${results.length}（${results.length - total} 条无标注，跳过）`);
  console.log(`HitRate@5:  ${(hitRate5 * 100).toFixed(1)}%`);
  console.log(`HitRate@10: ${(hitRate10 * 100).toFixed(1)}%`);
  console.log(`MRR:        ${mrr.toFixed(4)}`);

  console.log('\n按类别:');
  console.log(`${'类别'.padEnd(14)} ${'数'.padEnd(4)} ${'Hit@5'.padEnd(8)} ${'Hit@10'.padEnd(8)} ${'MRR'.padEnd(8)}`);
  console.log('-'.repeat(45));
  for (const [cat, stats] of Object.entries(byCategory).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${cat.padEnd(14)} ${String(stats.count).padEnd(4)} ${(stats.hitRate5 * 100).toFixed(1).padEnd(7)} ${(stats.hitRate10 * 100).toFixed(1).padEnd(7)} ${stats.mrr.toFixed(4).padEnd(7)}`);
  }

  // Log results
  await appendFile(
    path.join(process.cwd(), 'data/rag-eval', 'results.jsonl'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      config: configName,
      total: results.length,
      validTotal: total,
      hitRate5,
      hitRate10,
      mrr,
      byCategory,
      results,
    }) + '\n',
    'utf8',
  );

  console.log('\n结果已追加到 data/rag-eval/results.jsonl');
}

main().catch(console.error);
