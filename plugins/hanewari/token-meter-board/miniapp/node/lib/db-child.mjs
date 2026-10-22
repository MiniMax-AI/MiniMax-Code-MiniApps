// token-meter-board child-process fallback dispatcher.
// Spawned by server.mjs only when the Mini App runtime lacks node:sqlite:
//   node db-child.mjs <mode> <paramsJson>
// Prints exactly one JSON document on stdout; exits non-zero on failure.
import { resolveDataDir } from './common.mjs';
import { buildTrendResult, resolveTrendWindow } from './trend.mjs';
import { querySummary, querySessions, queryDaily, queryWindow, queryCalls, queryTurns } from './queries.mjs';

function run(mode, params) {
  const dataDir = params?.dataDir || resolveDataDir();
  const now = Date.now();
  switch (mode) {
    case 'trend': {
      const { startMs, endMs } = resolveTrendWindow(
        { startAt: params?.startAt, endAt: params?.endAt, days: params?.days },
        now,
      );
      return buildTrendResult({
        dataDir,
        startMs,
        endMs,
        bucket: params?.bucket,
        fillEmpty: params?.fillEmpty,
        now,
      });
    }
    case 'window':
      return queryWindow({ ...params, dataDir }, now);
    case 'summary':
      return querySummary({ ...params, dataDir }, now);
    case 'sessions':
      return querySessions({ ...params, dataDir }, now);
    case 'daily':
      return queryDaily({ ...params, dataDir }, now);
    case 'calls':
      return queryCalls({ ...params, dataDir }, now);
    case 'turns':
      return queryTurns({ ...params, dataDir }, now);
    default:
      throw new Error(`unknown mode: ${mode}`);
  }
}

try {
  const [, , mode, paramsJson] = process.argv;
  const params = paramsJson ? JSON.parse(paramsJson) : {};
  const result = run(mode, params);
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  process.stdout.write(JSON.stringify({ error: String(err?.message || err), code: err?.code || null }));
  process.exit(1);
}
