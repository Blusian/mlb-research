import 'dotenv/config';

import { DailySlateCache } from '../../cache/dailySlateCache.js';
import { env } from '../../config/env.js';
import { createDailyDataProvider } from '../../providers/index.js';
import { DailyAnalysisService } from '../../services/dailyAnalysisService.js';
import { getAnalysisDate } from '../../utils/date.js';
import { parseCliArgs } from '../cli.js';
import { SnapshotArchive } from '../snapshotArchive.js';

const run = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  const analysisDate = getAnalysisDate(args.date ?? env.DEFAULT_ANALYSIS_DATE);
  const forceRefresh = args.refresh === 'true' || args.refresh === '1';
  const provider = createDailyDataProvider({
    dataProvider: env.DATA_PROVIDER,
    mlbStatsApiBaseUrl: env.MLB_STATS_API_BASE_URL,
    baseballSavantBaseUrl: env.BASEBALL_SAVANT_BASE_URL,
    fangraphsBaseUrl: env.FANGRAPHS_BASE_URL,
    openMeteoBaseUrl: env.OPEN_METEO_BASE_URL,
    timeoutMs: env.LIVE_PROVIDER_TIMEOUT_MS,
    enableOpenMeteoWeather: env.ENABLE_OPEN_METEO_WEATHER,
    enableFanGraphsSupport: env.ENABLE_FANGRAPHS_SUPPORT,
  });
  const analysisService = new DailyAnalysisService(
    provider,
    new DailySlateCache(env.CACHE_TTL_MINUTES * 60 * 1000, {
      cacheDirectory: env.CACHE_DIRECTORY,
    }),
  );
  const archive = new SnapshotArchive(env.MODELING_SNAPSHOT_DIRECTORY);
  const analysis = await analysisService.getDailyAnalysis(
    { date: analysisDate },
    { forceRefresh },
  );
  const filePath = archive.save({
    analysisDate,
    capturedAt: new Date().toISOString(),
    providerName: analysis.meta.providerName,
    source: analysis.meta.source,
    analysis,
  });

  console.log(
    JSON.stringify(
      {
        analysisDate,
        providerName: analysis.meta.providerName,
        source: analysis.meta.source,
        savedTo: filePath,
        games: analysis.games.length,
        hitters: analysis.rankings.hitters.length,
        pitchers: analysis.rankings.pitchers.length,
      },
      null,
      2,
    ),
  );
};

void run();
