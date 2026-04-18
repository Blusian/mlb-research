import type {
  CreateSelectedPropInput,
  GameInfo,
  HitterHomeRunProp,
  HitterStatProp,
  PitcherLineProp,
  PitcherStrikeoutProp,
  RankedHitter,
  SelectionSide,
} from '@mlb-analyzer/shared';

export const HITTER_HITS_TRACKING_LINE = 1.5;
export const HITTER_RUNS_TRACKING_LINE = 0.5;
export const HITTER_RBIS_TRACKING_LINE = 0.5;
export const HITTER_TOTAL_BASES_TRACKING_LINE = 1.5;
export const HITTER_WALKS_TRACKING_LINE = 0.5;

const GAME_TOTAL_MIN_LINE = 0.5;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const summarizeReasons = (reasons: string[]): string | undefined => {
  if (reasons.length === 0) {
    return undefined;
  }

  return reasons.slice(0, 2).join(' ');
};

const expectedPlateAppearances = (lineupSpot: number, lineupConfirmed: boolean): number => {
  const baseline =
    lineupSpot <= 2 ? 4.7 : lineupSpot <= 5 ? 4.45 : lineupSpot <= 7 ? 4.15 : 3.95;
  return lineupConfirmed ? baseline : baseline - 0.2;
};

const hitterProjectionMultiplier = (score: number): number =>
  clamp(0.82 + (score - 50) * 0.0065, 0.65, 1.32);

const approximateHomeRunProbability = (homeRunScore: number): number =>
  clamp((homeRunScore - 25) / 250, 0.04, 0.42);

const formatSelectionSide = (selectionSide: SelectionSide): string =>
  selectionSide === 'under' ? 'under' : 'over';

const hitterMarketStatLabel = (market: HitterStatProp['market']): string => {
  if (market === 'hitter_hits') {
    return 'hits';
  }
  if (market === 'hitter_runs') {
    return 'runs';
  }
  if (market === 'hitter_rbis') {
    return 'runs batted in';
  }
  if (market === 'hitter_total_bases') {
    return 'total bases';
  }
  return 'walks';
};

const pitcherMarketStatLabel = (
  market: PitcherStrikeoutProp['market'] | PitcherLineProp['market'],
): string => {
  if (market === 'pitcher_walks') {
    return 'walks allowed';
  }
  if (market === 'pitcher_outs') {
    return 'outs recorded';
  }
  return 'strikeouts';
};

const lineSelectionLabel = (
  playerName: string,
  selectionSide: SelectionSide,
  lineValue: number,
  statLabel: string,
): string => `${playerName} ${formatSelectionSide(selectionSide)} ${lineValue.toFixed(1)} ${statLabel}`;

const totalRunsSelectionLabel = (
  selectionSide: SelectionSide,
  lineValue: number,
): string => `${selectionSide === 'under' ? 'Under' : 'Over'} ${lineValue.toFixed(1)} total runs`;

export const defaultGameTotalTrackingLine = (game: GameInfo): number =>
  clamp(
    Math.round((game.runProjection?.totalRuns ?? 8.5) * 2) / 2,
    GAME_TOTAL_MIN_LINE,
    20,
  );

export const deriveHitsProjection = (hitter: RankedHitter): number => {
  const expectedPa = expectedPlateAppearances(
    hitter.metrics.lineupSpot,
    hitter.metrics.lineupConfirmed,
  );
  const expectedAtBats = expectedPa * (1 - hitter.metrics.walkRate / 100 * 0.65);
  return Number(
    (
      hitter.metrics.averageVsHandedness *
      expectedAtBats *
      hitterProjectionMultiplier(hitter.scores.totalHitPotentialScore ?? hitter.scores.floorScore)
    ).toFixed(2),
  );
};

export const deriveTotalBasesProjection = (hitter: RankedHitter): number => {
  const expectedPa = expectedPlateAppearances(
    hitter.metrics.lineupSpot,
    hitter.metrics.lineupConfirmed,
  );
  const expectedAtBats = expectedPa * (1 - hitter.metrics.walkRate / 100 * 0.58);
  const scoreBlend =
    (hitter.scores.totalHitPotentialScore ?? hitter.scores.floorScore) * 0.55 +
    hitter.scores.homeRunUpsideScore * 0.45;
  const sluggingVsHandedness =
    hitter.metrics.sluggingVsHandedness ??
    hitter.metrics.xslgVsHandedness ??
    hitter.metrics.averageVsHandedness + hitter.metrics.isoVsHandedness;
  return Number(
    (
      sluggingVsHandedness *
      expectedAtBats *
      hitterProjectionMultiplier(scoreBlend)
    ).toFixed(2),
  );
};

export const createSelectedPropFromHomeRunProp = (
  prop: HitterHomeRunProp,
  date: string,
): CreateSelectedPropInput => ({
  date,
  gameId: prop.gameId,
  playerId: prop.entityId,
  playerName: prop.playerName,
  team: prop.teamAbbreviation,
  opponent: prop.opponentAbbreviation,
  matchupLabel: prop.matchupLabel,
  propType: 'hitter_home_run',
  selectionSide: 'over',
  selectionLabel: `${prop.playerName} to hit a home run`,
  lineValue: 0.5,
  projectionValue: Number(prop.blendedProbability.toFixed(4)),
  confidence: prop.confidence,
  explanationSummary: summarizeReasons(prop.reasons),
});

export const createSelectedPropFromStrikeoutProp = (
  prop: PitcherStrikeoutProp,
  date: string,
  lineValue: number,
  selectionSide: SelectionSide = 'over',
): CreateSelectedPropInput => ({
  date,
  gameId: prop.gameId,
  playerId: prop.entityId,
  playerName: prop.playerName,
  team: prop.teamAbbreviation,
  opponent: prop.opponentAbbreviation,
  matchupLabel: prop.matchupLabel,
  propType: 'pitcher_strikeouts',
  selectionSide,
  selectionLabel: lineSelectionLabel(
    prop.playerName,
    selectionSide,
    lineValue,
    pitcherMarketStatLabel(prop.market),
  ),
  lineValue,
  projectionValue: Number(prop.meanKs.toFixed(2)),
  confidence: prop.confidence,
  explanationSummary: summarizeReasons(prop.reasons),
});

export const createSelectedPropFromHitterStatProp = (
  prop: HitterStatProp,
  date: string,
  lineValue = prop.lineValue,
  selectionSide: SelectionSide = 'over',
): CreateSelectedPropInput => ({
  date,
  gameId: prop.gameId,
  playerId: prop.entityId,
  playerName: prop.playerName,
  team: prop.teamAbbreviation,
  opponent: prop.opponentAbbreviation,
  matchupLabel: prop.matchupLabel,
  propType: prop.market,
  selectionSide,
  selectionLabel: lineSelectionLabel(
    prop.playerName,
    selectionSide,
    lineValue,
    hitterMarketStatLabel(prop.market),
  ),
  lineValue,
  projectionValue: prop.projectionValue,
  confidence: prop.confidence,
  explanationSummary: summarizeReasons(prop.reasons),
});

export const createSelectedPropFromPitcherLineProp = (
  prop: PitcherLineProp,
  date: string,
  lineValue = prop.lineValue,
  selectionSide: SelectionSide = 'over',
): CreateSelectedPropInput => ({
  date,
  gameId: prop.gameId,
  playerId: prop.entityId,
  playerName: prop.playerName,
  team: prop.teamAbbreviation,
  opponent: prop.opponentAbbreviation,
  matchupLabel: prop.matchupLabel,
  propType: prop.market,
  selectionSide,
  selectionLabel: lineSelectionLabel(
    prop.playerName,
    selectionSide,
    lineValue,
    pitcherMarketStatLabel(prop.market),
  ),
  lineValue,
  projectionValue: prop.projectionValue,
  confidence: prop.confidence,
  explanationSummary: summarizeReasons(prop.reasons),
});

export const createSelectedPropFromGameTotal = (
  game: GameInfo,
  date: string,
  lineValue = defaultGameTotalTrackingLine(game),
  selectionSide: SelectionSide = 'over',
): CreateSelectedPropInput => ({
  date,
  gameId: game.gameId,
  playerId: `game-total:${game.gameId}`,
  playerName: game.matchupLabel,
  team: game.awayTeam.abbreviation,
  opponent: game.homeTeam.abbreviation,
  matchupLabel: game.matchupLabel,
  propType: 'game_total_runs',
  selectionSide,
  selectionLabel: totalRunsSelectionLabel(selectionSide, lineValue),
  lineValue,
  projectionValue: Number((game.runProjection?.totalRuns ?? 0).toFixed(1)),
  confidence: game.runProjection?.confidenceRating ?? null,
  explanationSummary: game.runProjection?.summary ?? summarizeReasons(game.runProjection?.reasons ?? []),
});

export const createSelectedPropFromHitter = (
  hitter: RankedHitter,
  date: string,
  propType: 'hitter_home_run' | 'hitter_hits' | 'hitter_total_bases',
): CreateSelectedPropInput => {
  if (propType === 'hitter_home_run') {
    return {
      date,
      gameId: hitter.gameId,
      playerId: hitter.playerId,
      playerName: hitter.playerName,
      team: hitter.team.abbreviation,
      opponent: hitter.opponent.abbreviation,
      matchupLabel: hitter.matchupLabel,
      propType,
      selectionSide: 'over',
      selectionLabel: `${hitter.playerName} to hit a home run`,
      lineValue: 0.5,
      projectionValue: Number(
        approximateHomeRunProbability(hitter.scores.homeRunUpsideScore).toFixed(4),
      ),
      confidence: hitter.scores.confidenceRating,
      explanationSummary: summarizeReasons(hitter.reasons),
    };
  }

  if (propType === 'hitter_hits') {
    return {
      date,
      gameId: hitter.gameId,
      playerId: hitter.playerId,
      playerName: hitter.playerName,
      team: hitter.team.abbreviation,
      opponent: hitter.opponent.abbreviation,
      matchupLabel: hitter.matchupLabel,
      propType,
      selectionSide: 'over',
      selectionLabel: lineSelectionLabel(
        hitter.playerName,
        'over',
        HITTER_HITS_TRACKING_LINE,
        'hits',
      ),
      lineValue: HITTER_HITS_TRACKING_LINE,
      projectionValue: deriveHitsProjection(hitter),
      confidence:
        hitter.scores.marketConfidence?.hits.confidenceRating ?? hitter.scores.confidenceRating,
      explanationSummary: summarizeReasons(hitter.reasons),
    };
  }

  return {
    date,
    gameId: hitter.gameId,
    playerId: hitter.playerId,
    playerName: hitter.playerName,
    team: hitter.team.abbreviation,
    opponent: hitter.opponent.abbreviation,
    matchupLabel: hitter.matchupLabel,
    propType,
    selectionSide: 'over',
    selectionLabel: lineSelectionLabel(
      hitter.playerName,
      'over',
      HITTER_TOTAL_BASES_TRACKING_LINE,
      'total bases',
    ),
    lineValue: HITTER_TOTAL_BASES_TRACKING_LINE,
    projectionValue: deriveTotalBasesProjection(hitter),
    confidence:
      hitter.scores.marketConfidence?.totalBases.confidenceRating
      ?? hitter.scores.confidenceRating,
    explanationSummary: summarizeReasons(hitter.reasons),
  };
};
