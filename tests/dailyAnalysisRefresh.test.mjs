import assert from 'node:assert/strict';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';
import { DailyAnalysisService } from '../backend/dist/backend/src/services/dailyAnalysisService.js';

class CountingProvider {
  name = 'counting-provider';
  calls = 0;

  async getDailySlate(date) {
    this.calls += 1;

    return {
      analysisDate: date,
      generatedAt: `2026-04-14T00:00:0${this.calls}.000Z`,
      providerName: 'counting-provider',
      source: 'mock',
      notes: [`call ${this.calls}`],
      games: [],
      hitters: [],
      pitchers: [],
    };
  }
}

test('manual refresh bypasses the cached daily slate and stores the fresh result', async () => {
  const provider = new CountingProvider();
  const service = new DailyAnalysisService(provider, new DailySlateCache(60_000));

  const first = await service.getDailyAnalysis({ date: '2026-04-14' });
  const second = await service.getDailyAnalysis({ date: '2026-04-14' });
  const refreshed = await service.getDailyAnalysis(
    { date: '2026-04-14' },
    { forceRefresh: true },
  );

  assert.equal(provider.calls, 2);
  assert.equal(first.meta.cacheStatus, 'miss');
  assert.equal(second.meta.cacheStatus, 'hit');
  assert.equal(refreshed.meta.cacheStatus, 'miss');
  assert.ok(refreshed.meta.notes.includes('Manual refresh bypassed the cached slate.'));
  assert.ok(refreshed.meta.notes.includes('call 2'));
});
