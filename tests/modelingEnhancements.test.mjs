import assert from 'node:assert/strict';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';
import {
  buildHomeRunFeatureVector,
  predictHomeRunProbability,
  trainHomeRunModel,
} from '../backend/dist/backend/src/modeling/homeRunModel.js';
import {
  parseOddsCsv,
  resolveOddsRecords,
} from '../backend/dist/backend/src/modeling/odds.js';
import { MockDailyDataProvider } from '../backend/dist/backend/src/providers/mock/mockDataProvider.js';
import { DailyAnalysisService } from '../backend/dist/backend/src/services/dailyAnalysisService.js';

const buildAnalysis = async (date) => {
  const service = new DailyAnalysisService(
    new MockDailyDataProvider(),
    new DailySlateCache(60_000),
  );

  return service.getDailyAnalysis({ date });
};

test('odds rows can resolve pitcher strikeout props from player name and team', async () => {
  const analysis = await buildAnalysis('2026-04-13');
  const snapshot = {
    analysisDate: '2026-04-13',
    capturedAt: '2026-04-13T16:00:00.000Z',
    providerName: analysis.meta.providerName,
    source: analysis.meta.source,
    analysis,
  };
  const parsed = parseOddsCsv(`date,market,player_name,team,selection,line,price
2026-04-13,pitcher_strikeouts,Gerrit Cole,NYY,over,6.5,-115
`);
  const resolved = resolveOddsRecords(
    parsed,
    new Map([['2026-04-13', snapshot]]),
  );

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.entityId, 'p-cole');
  assert.equal(resolved[0]?.gameId, 'game-002');
  assert.equal(resolved[0]?.selection, 'over');
});

test('odds rows can resolve pitcher walk and outs props from player name and team', async () => {
  const analysis = await buildAnalysis('2026-04-13');
  const snapshot = {
    analysisDate: '2026-04-13',
    capturedAt: '2026-04-13T16:00:00.000Z',
    providerName: analysis.meta.providerName,
    source: analysis.meta.source,
    analysis,
  };
  const parsed = parseOddsCsv(`date,market,player_name,team,selection,line,price
2026-04-13,pitcher_walks,Gerrit Cole,NYY,under,2.5,-110
2026-04-13,pitcher_outs,Gerrit Cole,NYY,over,17.5,-105
`);
  const resolved = resolveOddsRecords(
    parsed,
    new Map([['2026-04-13', snapshot]]),
  );

  assert.equal(resolved.length, 2);
  assert.equal(resolved[0]?.entityId, 'p-cole');
  assert.equal(resolved[0]?.market, 'pitcher_walks');
  assert.equal(resolved[1]?.market, 'pitcher_outs');
});

test('home-run learner gives a stronger probability to elite power profiles', async () => {
  const analysis = await buildAnalysis('2026-04-13');
  const sorted = [...analysis.rankings.hitters].sort(
    (left, right) => right.scores.homeRunUpsideScore - left.scores.homeRunUpsideScore,
  );
  const hotHitters = sorted.slice(0, 6);
  const coldHitters = sorted.slice(-6);
  const examples = [
    ...hotHitters.flatMap((hitter, index) =>
      Array.from({ length: 4 }, (_, repeatIndex) => ({
        analysisDate: `2026-04-${10 + repeatIndex}`,
        playerId: `${hitter.playerId}-hot-${repeatIndex}`,
        gameId: `${hitter.gameId}-hot-${index}-${repeatIndex}`,
        features: buildHomeRunFeatureVector(hitter),
        outcome: 1,
      })),
    ),
    ...coldHitters.flatMap((hitter, index) =>
      Array.from({ length: 4 }, (_, repeatIndex) => ({
        analysisDate: `2026-04-${10 + repeatIndex}`,
        playerId: `${hitter.playerId}-cold-${repeatIndex}`,
        gameId: `${hitter.gameId}-cold-${index}-${repeatIndex}`,
        features: buildHomeRunFeatureVector(hitter),
        outcome: 0,
      })),
    ),
  ];
  const model = trainHomeRunModel(examples);
  const elite = analysis.rankings.hitters.find(
    (hitter) => hitter.playerName === 'Aaron Judge',
  );
  const weak = analysis.rankings.hitters.find(
    (hitter) => hitter.playerName === 'Trevor Story',
  );

  assert.ok(model);
  assert.ok(elite);
  assert.ok(weak);
  assert.ok(
    predictHomeRunProbability(elite, model) >
      predictHomeRunProbability(weak, model),
  );
});

test('home-run learner tolerates legacy snapshots without newer feature fields', async () => {
  const analysis = await buildAnalysis('2026-04-13');
  const legacyHitter = structuredClone(analysis.rankings.hitters[0]);

  delete legacyHitter.metrics.averageBatSpeed;
  delete legacyHitter.metrics.hardSwingRate;
  delete legacyHitter.metrics.squaredUpRate;
  delete legacyHitter.metrics.blastRate;
  delete legacyHitter.metrics.batTrackingRunValue;
  delete legacyHitter.metrics.homeRunParkFactorVsHandedness;

  const vector = buildHomeRunFeatureVector(legacyHitter);
  const examples = Array.from({ length: 40 }, (_, index) => ({
    analysisDate: `2026-04-${String(1 + index).padStart(2, '0')}`,
    playerId: `${legacyHitter.playerId}-${index}`,
    gameId: `${legacyHitter.gameId}-${index}`,
    features: vector,
    outcome: index < 20 ? 1 : 0,
  }));
  const model = trainHomeRunModel(examples);
  const probability = model
    ? predictHomeRunProbability(legacyHitter, model)
    : null;

  assert.equal(vector.averageBatSpeed, 72);
  assert.equal(vector.blastRate, 8);
  assert.equal(vector.homeRunParkFactorVsHandedness, 100);
  assert.ok(model);
  assert.equal(typeof probability, 'number');
  assert.ok(Number.isFinite(probability));
});
