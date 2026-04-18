import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';
import { BacktestService } from '../backend/dist/backend/src/modeling/backtestService.js';
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

test('backtest service settles stored snapshots against results and odds', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'mlb-backtest-'));
  const snapshotArchive = new SnapshotArchive(path.join(tempRoot, 'snapshots'));
  const resultArchive = new ResolvedResultArchive(path.join(tempRoot, 'results'));
  const oddsArchive = new OddsArchive(path.join(tempRoot, 'odds'));
  const analysis = await buildAnalysis('2026-04-13');

  try {
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
      games: [
        {
          analysisDate: '2026-04-13',
          gameId: 'game-002',
          matchupId: 'NYY@BOS',
          matchupLabel: 'NYY @ BOS',
          awayTeamAbbreviation: 'NYY',
          homeTeamAbbreviation: 'BOS',
          awayRuns: 5,
          homeRuns: 2,
          totalRuns: 7,
          homeWon: false,
        },
      ],
      hitters: [
        {
          analysisDate: '2026-04-13',
          gameId: 'game-002',
          playerId: 'h-judge',
          playerName: 'Aaron Judge',
          teamAbbreviation: 'NYY',
          homeRuns: 1,
          hits: 2,
          walks: 1,
          strikeouts: 1,
          atBats: 4,
          plateAppearances: 5,
        },
      ],
      pitchers: [
        {
          analysisDate: '2026-04-13',
          gameId: 'game-002',
          playerId: 'p-cole',
          playerName: 'Gerrit Cole',
          teamAbbreviation: 'NYY',
          strikeouts: 8,
          walks: 1,
          earnedRuns: 2,
          hitsAllowed: 5,
          inningsPitched: 6,
          wonGame: true,
        },
      ],
    });
    oddsArchive.upsert([
      {
        analysisDate: '2026-04-13',
        market: 'game_moneyline_home',
        entityId: 'game-002',
        gameId: 'game-002',
        selection: 'home',
        decimalOdds: 2.4,
        impliedProbability: 1 / 2.4,
        sportsbook: 'test-book',
        capturedAt: '2026-04-13T15:30:00.000Z',
        isClosing: true,
      },
      {
        analysisDate: '2026-04-13',
        market: 'hitter_home_run',
        entityId: 'h-judge',
        gameId: 'game-002',
        selection: 'yes',
        decimalOdds: 4,
        impliedProbability: 0.25,
        sportsbook: 'test-book',
        capturedAt: '2026-04-13T15:30:00.000Z',
        isClosing: true,
      },
      {
        analysisDate: '2026-04-13',
        market: 'pitcher_strikeouts',
        entityId: 'p-cole',
        gameId: 'game-002',
        selection: 'over',
        line: 6.5,
        decimalOdds: 2.1,
        impliedProbability: 1 / 2.1,
        sportsbook: 'test-book',
        capturedAt: '2026-04-13T15:30:00.000Z',
        isClosing: true,
      },
      {
        analysisDate: '2026-04-13',
        market: 'pitcher_walks',
        entityId: 'p-cole',
        gameId: 'game-002',
        selection: 'under',
        line: 2.5,
        decimalOdds: 1.95,
        impliedProbability: 1 / 1.95,
        sportsbook: 'test-book',
        capturedAt: '2026-04-13T15:30:00.000Z',
        isClosing: true,
      },
      {
        analysisDate: '2026-04-13',
        market: 'pitcher_outs',
        entityId: 'p-cole',
        gameId: 'game-002',
        selection: 'over',
        line: 17.5,
        decimalOdds: 2.0,
        impliedProbability: 0.5,
        sportsbook: 'test-book',
        capturedAt: '2026-04-13T15:30:00.000Z',
        isClosing: true,
      },
    ]);

    const service = new BacktestService(snapshotArchive, resultArchive, oddsArchive);
    const moneylineReport = service.runBacktest({ market: 'game_moneyline_home' });
    const homeRunReport = service.runBacktest({ market: 'hitter_home_run' });
    const strikeoutReport = service.runBacktest({
      market: 'pitcher_strikeouts',
      minEdge: 0,
    });
    const walkReport = service.runBacktest({
      market: 'pitcher_walks',
      minEdge: 0,
    });
    const outsReport = service.runBacktest({
      market: 'pitcher_outs',
      minEdge: 0,
    });

    assert.equal(moneylineReport.sampleSize, 1);
    assert.equal(moneylineReport.raw.actualRate, 0);
    assert.equal(moneylineReport.strategy?.eligiblePredictions, 1);

    assert.equal(homeRunReport.sampleSize, 1);
    assert.equal(homeRunReport.raw.actualRate, 1);
    assert.equal(homeRunReport.strategy?.eligiblePredictions, 1);

    assert.equal(strikeoutReport.sampleSize, 1);
    assert.equal(strikeoutReport.raw.actualRate, 1);
    assert.equal(strikeoutReport.strategy?.eligiblePredictions, 1);
    assert.ok(strikeoutReport.assumptions.length > 0);

    assert.equal(walkReport.sampleSize, 1);
    assert.equal(walkReport.raw.actualRate, 1);
    assert.equal(walkReport.strategy?.eligiblePredictions, 1);
    assert.ok(walkReport.assumptions.length > 0);

    assert.equal(outsReport.sampleSize, 1);
    assert.equal(outsReport.raw.actualRate, 1);
    assert.equal(outsReport.strategy?.eligiblePredictions, 1);
    assert.ok(outsReport.assumptions.length > 0);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
