import 'dotenv/config';

import { env } from '../../config/env.js';
import { MlbStatsApiSource } from '../../sources/mlbStatsApiSource.js';
import { getAnalysisDate } from '../../utils/date.js';
import { listDateRange, parseCliArgs } from '../cli.js';
import { ResolvedResultArchive } from '../resolvedResultArchive.js';
import { buildResolvedDailyResults } from '../resultIngestion.js';

const run = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  const singleDate = args.date
    ? getAnalysisDate(args.date)
    : undefined;
  const dateFrom = singleDate ?? getAnalysisDate(args['date-from'] ?? env.DEFAULT_ANALYSIS_DATE);
  const dateTo = singleDate ?? getAnalysisDate(args['date-to'] ?? dateFrom);
  const mlbStatsApi = new MlbStatsApiSource(
    env.MLB_STATS_API_BASE_URL,
    env.LIVE_PROVIDER_TIMEOUT_MS,
  );
  const archive = new ResolvedResultArchive(env.MODELING_RESULT_DIRECTORY);
  const summaries = [];

  for (const analysisDate of listDateRange(dateFrom, dateTo)) {
    const results = await buildResolvedDailyResults(analysisDate, mlbStatsApi);
    const filePath = archive.save(results);

    summaries.push({
      analysisDate,
      savedTo: filePath,
      games: results.games.length,
      hitters: results.hitters.length,
      pitchers: results.pitchers.length,
      notes: results.notes,
    });
  }

  console.log(JSON.stringify(summaries, null, 2));
};

void run();
