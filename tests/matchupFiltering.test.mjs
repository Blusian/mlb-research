import assert from 'node:assert/strict';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';
import { MockDailyDataProvider } from '../backend/dist/backend/src/providers/mock/mockDataProvider.js';
import { DailyAnalysisService } from '../backend/dist/backend/src/services/dailyAnalysisService.js';

test('canonical matchup ids filter the full analysis response together', async () => {
  const service = new DailyAnalysisService(new MockDailyDataProvider(), new DailySlateCache(60_000));
  const analysis = await service.getDailyAnalysis({
    date: '2026-04-13',
    matchup: 'LAD@ARI',
  });

  assert.equal(analysis.games.length, 1);
  assert.equal(analysis.games[0].matchupLabel, 'LAD @ ARI');
  assert.ok(analysis.rankings.hitters.length > 0);
  assert.ok(analysis.rankings.pitchers.length > 0);
  assert.ok(analysis.rankings.hitters.every((hitter) => hitter.matchupId === 'LAD@ARI'));
  assert.ok(analysis.rankings.pitchers.every((pitcher) => pitcher.matchupId === 'LAD@ARI'));
});

test('analysis service exposes matchup filters as value-label pairs', async () => {
  const service = new DailyAnalysisService(new MockDailyDataProvider(), new DailySlateCache(60_000));
  const analysis = await service.getDailyAnalysis({
    date: '2026-04-13',
  });

  assert.ok(analysis.filters.matchups.length > 0);
  assert.deepEqual(analysis.filters.matchups[0], {
    value: 'LAD@ARI',
    label: 'LAD @ ARI',
  });
});
