import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DailySlateCache } from '../backend/dist/backend/src/cache/dailySlateCache.js';
import { ResolvedResultArchive } from '../backend/dist/backend/src/modeling/resolvedResultArchive.js';
import { SnapshotArchive } from '../backend/dist/backend/src/modeling/snapshotArchive.js';
import { MockDailyDataProvider } from '../backend/dist/backend/src/providers/mock/mockDataProvider.js';
import { DailyAnalysisService } from '../backend/dist/backend/src/services/dailyAnalysisService.js';
import { PropBoardService } from '../backend/dist/backend/src/services/propBoardService.js';

test('daily analysis response includes organized prop boards', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'mlb-props-'));
  const propBoardService = new PropBoardService(
    new SnapshotArchive(path.join(tempRoot, 'snapshots')),
    new ResolvedResultArchive(path.join(tempRoot, 'results')),
  );
  const service = new DailyAnalysisService(
    new MockDailyDataProvider(),
    new DailySlateCache(60_000),
    propBoardService,
  );

  try {
    const analysis = await service.getDailyAnalysis({ date: '2026-04-13' });

    assert.ok(analysis.props.hitterHomeRuns.length > 0);
    assert.ok(analysis.props.pitcherStrikeouts.length > 0);
    assert.ok(analysis.props.pitcherWalks.length > 0);
    assert.ok(analysis.props.pitcherOuts.length > 0);
    assert.equal(analysis.props.hitterHomeRuns[0]?.market, 'hitter_home_run');
    assert.equal(analysis.props.pitcherStrikeouts[0]?.market, 'pitcher_strikeouts');
    assert.equal(analysis.props.pitcherWalks[0]?.market, 'pitcher_walks');
    assert.equal(analysis.props.pitcherOuts[0]?.market, 'pitcher_outs');
    assert.ok(analysis.props.hitterHomeRuns[0]?.lineupSource);
    assert.ok(analysis.props.pitcherStrikeouts[0]?.lineupSource);
    assert.ok(analysis.props.pitcherWalks[0]?.lineupSource);
    assert.ok(analysis.props.pitcherOuts[0]?.lineupSource);
    assert.ok(
      analysis.props.hitterHomeRuns[0]?.blendedProbability >=
        (analysis.props.hitterHomeRuns[1]?.blendedProbability ?? 0),
    );
    assert.ok(
      analysis.props.pitcherStrikeouts[0]?.projectedStrikeouts >=
        (analysis.props.pitcherStrikeouts[1]?.projectedStrikeouts ?? 0),
    );
    assert.equal(
      typeof analysis.props.pitcherWalks[0]?.overLineProbability,
      'number',
    );
    assert.equal(
      typeof analysis.props.pitcherOuts[0]?.overLineProbability,
      'number',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
