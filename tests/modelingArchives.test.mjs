import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';
import { OddsArchive } from '../backend/dist/backend/src/modeling/oddsArchive.js';
import { ResolvedResultArchive } from '../backend/dist/backend/src/modeling/resolvedResultArchive.js';
import { SnapshotArchive } from '../backend/dist/backend/src/modeling/snapshotArchive.js';
import { MockDailyDataProvider } from '../backend/dist/backend/src/providers/mock/mockDataProvider.js';
import { DailyAnalysisService } from '../backend/dist/backend/src/services/dailyAnalysisService.js';

const buildAnalysis = async (date) => {
  const service = new DailyAnalysisService(
    new MockDailyDataProvider(),
    new DailySlateCache(60_000),
  );

  return service.getDailyAnalysis({ date });
};

test('modeling archives persist snapshots, results, and odds', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'mlb-modeling-'));
  const analysis = await buildAnalysis('2026-04-13');
  const snapshotDirectory = path.join(tempRoot, 'snapshots');
  const resultDirectory = path.join(tempRoot, 'results');
  const oddsDirectory = path.join(tempRoot, 'odds');

  try {
    const snapshotArchive = new SnapshotArchive(snapshotDirectory);
    const resultArchive = new ResolvedResultArchive(resultDirectory);
    const oddsArchive = new OddsArchive(oddsDirectory);

    snapshotArchive.save({
      analysisDate: '2026-04-13',
      capturedAt: '2026-04-13T16:00:00.000Z',
      providerName: analysis.meta.providerName,
      source: analysis.meta.source,
      analysis,
    });
    resultArchive.save({
      analysisDate: '2026-04-13',
      capturedAt: '2026-04-13T23:59:59.000Z',
      source: 'mlb_stats_api',
      notes: [],
      games: [],
      hitters: [],
      pitchers: [],
    });
    oddsArchive.upsert([
      {
        analysisDate: '2026-04-13',
        market: 'hitter_home_run',
        entityId: 'h-judge',
        gameId: 'game-002',
        selection: 'yes',
        decimalOdds: 4.1,
        impliedProbability: 1 / 4.1,
        sportsbook: 'test-book',
        capturedAt: '2026-04-13T15:30:00.000Z',
        isClosing: true,
      },
    ]);

    const reloadedSnapshotArchive = new SnapshotArchive(snapshotDirectory);
    const reloadedResultArchive = new ResolvedResultArchive(resultDirectory);
    const reloadedOddsArchive = new OddsArchive(oddsDirectory);

    assert.equal(
      reloadedSnapshotArchive.get('2026-04-13')?.analysis.meta.analysisDate,
      '2026-04-13',
    );
    assert.equal(reloadedResultArchive.get('2026-04-13')?.source, 'mlb_stats_api');
    assert.equal(reloadedOddsArchive.getByDate('2026-04-13').length, 1);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
