import type {
  DailySlateModel,
  HitterMetricSet,
  PitcherMetricSet,
  GameInfo,
  HitterCandidate,
  PitcherCandidate,
} from '@mlb-analyzer/shared';

import type { RawDailySlate, RawGame, RawHitterCandidate, RawPitcherCandidate } from '../providers/types.js';

const defaultHitterMetrics: HitterMetricSet = {
  averageVsHandedness: 0.245,
  isoVsHandedness: 0.165,
  wobaVsHandedness: 0.315,
  xwobaVsHandedness: 0.32,
  xbaVsHandedness: 0.245,
  xslgVsHandedness: 0.405,
  strikeoutRate: 22,
  walkRate: 8,
  hardHitRate: 38,
  barrelRate: 7,
  averageExitVelocity: 89,
  averageBatSpeed: 72,
  hardSwingRate: 18,
  squaredUpRate: 28,
  blastRate: 8,
  swingLength: 7.2,
  batTrackingRunValue: 0,
  recentForm: 50,
  opponentPitcherContactAllowed: 36,
  opponentPitcherPowerAllowed: 7,
  batterVsPitcherPlateAppearances: 0,
  batterVsPitcherOps: 0.72,
  batterVsPitcherHomeRuns: 0,
  batterVsPitcherStrikeoutRate: 22,
  batterVsPitcherScore: 50,
  pitchMixMatchupScore: 50,
  pitchMixMatchupSample: 0,
  primaryPitchTypeCode: 'UNK',
  primaryPitchTypeDescription: 'Unknown',
  primaryPitchUsage: 0,
  secondaryPitchTypeCode: 'UNK',
  secondaryPitchTypeDescription: 'Unknown',
  secondaryPitchUsage: 0,
  parkFactor: 100,
  parkFactorVsHandedness: 100,
  hitParkFactorVsHandedness: 100,
  singleParkFactorVsHandedness: 100,
  doubleParkFactorVsHandedness: 100,
  tripleParkFactorVsHandedness: 100,
  homeRunParkFactor: 100,
  homeRunParkFactorVsHandedness: 100,
  walkParkFactorVsHandedness: 100,
  strikeoutParkFactorVsHandedness: 100,
  lineupSpot: 6,
  lineupConfirmed: false,
  playingTimeConfidence: 75,
};

const defaultPitcherMetrics: PitcherMetricSet = {
  strikeoutRate: 22,
  walkRate: 7.5,
  swingingStrikeRate: 11.5,
  hardHitAllowed: 37,
  barrelAllowed: 7,
  xwobaAllowed: 0.32,
  xbaAllowed: 0.245,
  xslgAllowed: 0.405,
  averageExitVelocityAllowed: 89,
  recentForm: 50,
  inningsProjection: 5.5,
  opponentStrikeoutRate: 22,
  opponentWalkRate: 8,
  opponentPowerRating: 55,
  parkFactor: 100,
  homeRunParkFactor: 100,
  strikeoutParkFactor: 100,
  winSupportRating: 50,
};

const normalizeGame = (game: RawGame): GameInfo => ({
  ...game,
  officials: game.officials ?? [],
  lineups: {
    away: game.lineups?.away ?? [],
    home: game.lineups?.home ?? [],
  },
  source: game.source ?? 'mock',
});

const normalizeHitter = (hitter: RawHitterCandidate): HitterCandidate => ({
  ...hitter,
  notes: hitter.notes ?? [],
  source: hitter.source ?? 'mock',
  metrics: {
    ...defaultHitterMetrics,
    ...hitter.metrics,
  },
});

const normalizePitcher = (pitcher: RawPitcherCandidate): PitcherCandidate => ({
  ...pitcher,
  notes: pitcher.notes ?? [],
  source: pitcher.source ?? 'mock',
  metrics: {
    ...defaultPitcherMetrics,
    ...pitcher.metrics,
  },
});

export const normalizeDailySlate = (rawSlate: RawDailySlate): DailySlateModel => ({
  analysisDate: rawSlate.analysisDate,
  generatedAt: rawSlate.generatedAt ?? new Date().toISOString(),
  providerName: rawSlate.providerName,
  source: rawSlate.source,
  notes: rawSlate.notes ?? [],
  games: rawSlate.games.map(normalizeGame),
  hitters: rawSlate.hitters.map(normalizeHitter),
  pitchers: rawSlate.pitchers.map(normalizePitcher),
});
