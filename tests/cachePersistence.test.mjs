import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';

test('DailySlateCache persists entries across instances', () => {
  const cacheDirectory = mkdtempSync(path.join(os.tmpdir(), 'mlb-cache-'));

  try {
    const firstCache = new DailySlateCache(60_000, { cacheDirectory });
    firstCache.set('mock:2026-04-13', {
      games: 4,
      provider: 'mock',
    });

    const secondCache = new DailySlateCache(60_000, { cacheDirectory });

    assert.deepEqual(secondCache.get('mock:2026-04-13'), {
      games: 4,
      provider: 'mock',
    });
  } finally {
    rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test('DailySlateCache expires stale entries from disk', async () => {
  const cacheDirectory = mkdtempSync(path.join(os.tmpdir(), 'mlb-cache-'));

  try {
    const cache = new DailySlateCache(5, { cacheDirectory });
    cache.set('live:2026-04-13', {
      games: 9,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(cache.get('live:2026-04-13'), null);
  } finally {
    rmSync(cacheDirectory, { recursive: true, force: true });
  }
});
