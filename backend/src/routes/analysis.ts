import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { DailySlateCache } from '../cache/dailySlateCache.js';
import { env } from '../config/env.js';
import { ResolvedResultArchive } from '../modeling/resolvedResultArchive.js';
import { SnapshotArchive } from '../modeling/snapshotArchive.js';
import { createDailyDataProvider } from '../providers/index.js';
import { DailyAnalysisService } from '../services/dailyAnalysisService.js';
import { PropBoardService } from '../services/propBoardService.js';
import { getAnalysisDate } from '../utils/date.js';

const querySchema = z.object({
  date: z.string().optional(),
  team: z.string().optional(),
  matchup: z.string().optional(),
  handedness: z.enum(['L', 'R', 'S', 'ALL']).optional(),
  hitterScoreType: z
    .enum(['overall_hit_score', 'home_run_upside_score', 'floor_score', 'risk_score'])
    .optional(),
  pitcherScoreType: z
    .enum(['overall_pitcher_score', 'strikeout_upside_score', 'safety_score', 'blowup_risk_score'])
    .optional(),
});

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
  new PropBoardService(
    new SnapshotArchive(env.MODELING_SNAPSHOT_DIRECTORY),
    new ResolvedResultArchive(env.MODELING_RESULT_DIRECTORY),
  ),
);

export const registerAnalysisRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/daily-analysis', async (request) => {
    const rawQuery = (request.query ?? {}) as Record<string, string | undefined>;
    const forceRefresh = rawQuery.refresh === 'true' || rawQuery.refresh === '1';
    const parsedQuery = querySchema.parse({
      ...rawQuery,
      date: getAnalysisDate(rawQuery.date ?? env.DEFAULT_ANALYSIS_DATE),
    });

    return analysisService.getDailyAnalysis(parsedQuery, { forceRefresh });
  });

  app.get('/api/games/today', async (request) => {
    const rawQuery = (request.query ?? {}) as Record<string, string | undefined>;
    const forceRefresh = rawQuery.refresh === 'true' || rawQuery.refresh === '1';
    const parsedQuery = querySchema.parse({
      ...rawQuery,
      date: getAnalysisDate(rawQuery.date ?? env.DEFAULT_ANALYSIS_DATE),
    });

    const analysis = await analysisService.getDailyAnalysis(parsedQuery, { forceRefresh });

    return {
      meta: analysis.meta,
      filters: analysis.filters,
      games: analysis.games,
    };
  });
};
