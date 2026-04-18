import type { RankedHitter, RankedPitcher } from '@mlb-analyzer/shared';

import { average, clamp } from '../providers/live/statsApiUtils.js';
import {
  predictHomeRunProbability,
  type HomeRunModel,
} from './homeRunModel.js';
import type { OddsRecord } from './types.js';
import type {
  AnalysisSnapshot,
  BacktestMarket,
  DerivedPrediction,
  ResolvedDailyResults,
  SettledPrediction,
} from './types.js';

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

const clampProbability = (value: number): number => clamp(value, 0.001, 0.999);

const scaleToScore = (value: number, lower: number, upper: number): number => {
  if (upper <= lower) {
    return 50;
  }

  return clamp(((value - lower) / (upper - lower)) * 100, 0, 100);
};

const inverseScaleToScore = (value: number, lower: number, upper: number): number =>
  100 - scaleToScore(value, lower, upper);

const weightedAverage = (
  entries: Array<[number | undefined | null, number]>,
  fallback = 50,
): number => {
  const usable = entries.filter(
    (entry): entry is [number, number] =>
      entry[0] !== undefined &&
      entry[0] !== null &&
      Number.isFinite(entry[0]) &&
      entry[1] > 0,
  );

  if (usable.length === 0) {
    return fallback;
  }

  const totalWeight = usable.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalWeight <= 0) {
    return fallback;
  }

  return usable.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
};

const erfApproximation = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const absoluteValue = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absoluteValue);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t);

  return sign * (1 - polynomial * Math.exp(-absoluteValue * absoluteValue));
};

const normalCdf = (value: number, mean: number, standardDeviation: number): number => {
  const adjustedStandardDeviation = Math.max(standardDeviation, 0.01);
  const z = (value - mean) / (adjustedStandardDeviation * Math.sqrt(2));

  return clamp(0.5 * (1 + erfApproximation(z)), 0, 1);
};

interface PitcherWorkloadProfile {
  expectedBattersFaced: number;
  baselineExpectedBattersFaced: number;
  pitchBudget: number;
  pitchesPerPlateAppearance: number;
  recentPitchesPerPlateAppearance: number;
  roleCertainty: number;
  quickHookRisk: number;
  inningsVolatility: number;
  pitchCountCap: number;
  earlyExitRisk: number;
  lineupConfidence: number;
}

interface PitcherWalkProjectionLayer {
  [key: string]: number;
  adjustedWalkProbability: number;
  projectedBattersFaced: number;
  seasonWalkRate: number;
  recentWalkRate: number;
  firstPitchStrikeRate: number;
  zoneRate: number;
  chaseInducedRate: number;
  calledStrikePlusWhiffRate: number;
  threeBallCountRate: number;
  opponentWalkRate: number;
  opponentChaseRate: number;
  opponentPatienceScore: number;
  walkEnvironmentScore: number;
  matchupAdjustedWalkRate: number;
  handednessSplitWalkRate: number;
}

interface PitcherWalkRiskLayer {
  [key: string]: number;
  roleCertainty: number;
  commandScore: number;
  inningsVolatility: number;
  pitchCountCap: number;
  earlyExitRisk: number;
  lineupConfidence: number;
  recentCommandTrend: number;
}

interface PitcherWalkModel {
  mean: number;
  median: number;
  overProbability: number;
  underProbability: number;
  confidenceScore: number;
  uncertaintyScore: number;
  projectionLayer: PitcherWalkProjectionLayer;
  riskLayer: PitcherWalkRiskLayer;
}

interface PitcherOutsProjectionLayer {
  [key: string]: number;
  expectedPitchBudget: number;
  expectedPitchesPerPlateAppearance: number;
  pitchBudgetBattersFaced: number;
  projectedBattersFaced: number;
  projectedWalks: number;
  baselineOutRate: number;
  contactManagementScore: number;
  supportScore: number;
  opponentResistance: number;
  survivalBattersFaced: number;
}

interface PitcherOutsRiskLayer {
  [key: string]: number;
  roleCertainty: number;
  quickHookRisk: number;
  inningsVolatility: number;
  pitchCountCap: number;
  earlyExitRisk: number;
  timesThroughOrderPenalty: number;
  lineupConfidence: number;
}

interface PitcherOutsModel {
  mean: number;
  median: number;
  overProbability: number;
  underProbability: number;
  confidenceScore: number;
  uncertaintyScore: number;
  projectionLayer: PitcherOutsProjectionLayer;
  riskLayer: PitcherOutsRiskLayer;
}

export interface PredictionModelContext {
  homeRunModel?: HomeRunModel | null;
}

export interface HomeRunProbabilityBreakdown {
  rawScore: number;
  heuristicProbability: number;
  learnedProbability?: number;
  blendedProbability: number;
  modelType: 'heuristic' | 'learned_logistic_blend';
  trainingSamples: number;
}

const preferredOdds = (
  odds: OddsRecord[],
  matcher: (record: OddsRecord) => boolean,
): OddsRecord | undefined =>
  odds
    .filter(matcher)
    .sort((left, right) => Number(right.isClosing) - Number(left.isClosing))[0];

const topTeamHitters = (snapshot: AnalysisSnapshot, gameId: string, teamAbbreviation: string) =>
  snapshot.analysis.rankings.hitters
    .filter(
      (hitter) =>
        hitter.gameId === gameId && hitter.team.abbreviation === teamAbbreviation,
    )
    .sort(
      (left, right) =>
        right.scores.overallHitScore - left.scores.overallHitScore,
    )
    .slice(0, 5);

const findTeamPitcher = (
  snapshot: AnalysisSnapshot,
  gameId: string,
  teamAbbreviation: string,
) =>
  snapshot.analysis.rankings.pitchers.find(
    (pitcher) =>
      pitcher.gameId === gameId && pitcher.team.abbreviation === teamAbbreviation,
  );

const teamOffenseScore = (
  snapshot: AnalysisSnapshot,
  gameId: string,
  teamAbbreviation: string,
): number => {
  const hitters = topTeamHitters(snapshot, gameId, teamAbbreviation);

  if (hitters.length === 0) {
    return 50;
  }

  return average(
    hitters.map(
      (hitter) =>
        hitter.scores.overallHitScore * 0.58 +
        hitter.scores.homeRunUpsideScore * 0.22 +
        hitter.scores.floorScore * 0.2,
    ),
  );
};

const teamStarterScore = (
  snapshot: AnalysisSnapshot,
  gameId: string,
  teamAbbreviation: string,
): number => {
  const pitcher = findTeamPitcher(snapshot, gameId, teamAbbreviation);

  if (!pitcher) {
    return 50;
  }

  return (
    pitcher.scores.overallPitcherScore * 0.6 +
    pitcher.scores.strikeoutUpsideScore * 0.2 +
    pitcher.scores.safetyScore * 0.2
  );
};

const teamStrength = (
  snapshot: AnalysisSnapshot,
  gameId: string,
  teamAbbreviation: string,
  isHome: boolean,
): number =>
  teamOffenseScore(snapshot, gameId, teamAbbreviation) * 0.56 +
  teamStarterScore(snapshot, gameId, teamAbbreviation) * 0.34 +
  (isHome ? 3 : 0) +
  10;

const deriveMoneylinePredictions = (
  snapshot: AnalysisSnapshot,
  odds: OddsRecord[],
): DerivedPrediction[] =>
  snapshot.analysis.games.map((game) => {
    const awayStrength = teamStrength(
      snapshot,
      game.gameId,
      game.awayTeam.abbreviation,
      false,
    );
    const homeStrength = teamStrength(
      snapshot,
      game.gameId,
      game.homeTeam.abbreviation,
      true,
    );
    const rawScore = homeStrength - awayStrength;
    const rawProbability = clampProbability(logistic(rawScore / 8));
    const attachedOdds = preferredOdds(
      odds,
      (record) =>
        record.market === 'game_moneyline_home' &&
        record.gameId === game.gameId &&
        record.selection === 'home',
    );

    return {
      analysisDate: snapshot.analysisDate,
      market: 'game_moneyline_home',
      entityId: game.gameId,
      gameId: game.gameId,
      label: `${game.homeTeam.abbreviation} moneyline`,
      selection: 'home',
      rawScore,
      rawProbability,
      decimalOdds: attachedOdds?.decimalOdds,
      impliedProbability: attachedOdds?.impliedProbability,
      sportsbook: attachedOdds?.sportsbook,
      metadata: {
        awayTeam: game.awayTeam.abbreviation,
        homeTeam: game.homeTeam.abbreviation,
        awayStrength: Number(awayStrength.toFixed(2)),
        homeStrength: Number(homeStrength.toFixed(2)),
      },
    };
  });

export const deriveHomeRunProbabilityBreakdown = (
  hitter: RankedHitter,
  context: PredictionModelContext = {},
): HomeRunProbabilityBreakdown => {
  const lineupAdjustment =
    hitter.metrics.lineupSpot <= 4 ? 0.18 : hitter.metrics.lineupSpot <= 6 ? 0.06 : -0.08;
  const parkAdjustment =
    (hitter.metrics.homeRunParkFactor - 100) * 0.008 +
    (hitter.metrics.homeRunParkFactorVsHandedness - 100) * 0.01;
  const riskAdjustment = (hitter.scores.riskScore - 50) * 0.008;
  const batterVsPitcherAdjustment =
    (hitter.metrics.batterVsPitcherScore - 50) *
    clamp(hitter.metrics.batterVsPitcherPlateAppearances / 10, 0, 1) *
    0.0075;
  const pitchMixAdjustment =
    (hitter.metrics.pitchMixMatchupScore - 50) *
    clamp(hitter.metrics.pitchMixMatchupSample / 12, 0, 1) *
    0.0085;
  const rawScore = hitter.scores.homeRunUpsideScore;
  const heuristicProbability = clamp(
    logistic(
      -4.25 +
        rawScore * 0.052 +
        lineupAdjustment +
        parkAdjustment -
        riskAdjustment +
        batterVsPitcherAdjustment +
        pitchMixAdjustment +
        (hitter.metrics.averageBatSpeed - 72) * 0.055 +
        (hitter.metrics.squaredUpRate - 28) * 0.018 +
        (hitter.metrics.blastRate - 8) * 0.028,
    ),
    0.01,
    0.5,
  );
  const learnedProbability =
    context.homeRunModel &&
    context.homeRunModel.trainingSamples >= 40
      ? predictHomeRunProbability(hitter, context.homeRunModel)
      : undefined;
  const blendedProbability = clamp(
    learnedProbability === undefined
      ? heuristicProbability
      : heuristicProbability * 0.3 + learnedProbability * 0.7,
    0.01,
    0.55,
  );

  return {
    rawScore,
    heuristicProbability,
    learnedProbability,
    blendedProbability,
    modelType:
      learnedProbability === undefined ? 'heuristic' : 'learned_logistic_blend',
    trainingSamples: context.homeRunModel?.trainingSamples ?? 0,
  };
};

const deriveHitterHomeRunPredictions = (
  snapshot: AnalysisSnapshot,
  odds: OddsRecord[],
  context: PredictionModelContext,
): DerivedPrediction[] =>
  snapshot.analysis.rankings.hitters.map((hitter) => {
    const breakdown = deriveHomeRunProbabilityBreakdown(hitter, context);
    const attachedOdds = preferredOdds(
      odds,
      (record) =>
        record.market === 'hitter_home_run' &&
        record.gameId === hitter.gameId &&
        record.entityId === hitter.playerId &&
        record.selection === 'yes',
    );

    return {
      analysisDate: snapshot.analysisDate,
      market: 'hitter_home_run',
      entityId: hitter.playerId,
      gameId: hitter.gameId,
      label: `${hitter.playerName} to hit a home run`,
      selection: 'yes',
      rawScore: breakdown.rawScore,
      rawProbability: breakdown.blendedProbability,
      decimalOdds: attachedOdds?.decimalOdds,
      impliedProbability: attachedOdds?.impliedProbability,
      sportsbook: attachedOdds?.sportsbook,
      metadata: {
        playerName: hitter.playerName,
        team: hitter.team.abbreviation,
        lineupSpot: hitter.metrics.lineupSpot,
        batterVsPitcherScore: Number(hitter.metrics.batterVsPitcherScore.toFixed(1)),
        batterVsPitcherPlateAppearances: hitter.metrics.batterVsPitcherPlateAppearances,
        pitchMixMatchupScore: Number(hitter.metrics.pitchMixMatchupScore.toFixed(1)),
        pitchMixMatchupSample: Number(hitter.metrics.pitchMixMatchupSample.toFixed(1)),
        heuristicProbability: Number(breakdown.heuristicProbability.toFixed(4)),
        learnedProbability:
          breakdown.learnedProbability === undefined
            ? null
            : Number(breakdown.learnedProbability.toFixed(4)),
        modelType: breakdown.modelType,
        trainingSamples: breakdown.trainingSamples,
      },
    };
  });

export const estimatePitcherStrikeouts = (pitcher: RankedPitcher): number => {
  const swingingStrikeEquivalent = clamp(
    pitcher.metrics.swingingStrikeRate * 1.55,
    10,
    38,
  );
  const strikeoutRate =
    pitcher.metrics.strikeoutRate * 0.45 +
    pitcher.metrics.opponentStrikeoutRate * 0.35 +
    swingingStrikeEquivalent * 0.2;
  const parkAdjustment = clamp(
    1 + (pitcher.metrics.strikeoutParkFactor - 100) * 0.012,
    0.9,
    1.12,
  );

  return (
    pitcher.metrics.inningsProjection *
    4.2 *
    (strikeoutRate / 100) *
    parkAdjustment
  );
};

const buildPitcherWorkloadProfile = (pitcher: RankedPitcher): PitcherWorkloadProfile => {
  const averageBattersFaced = Math.max(
    pitcher.metrics.averageBattersFaced ??
      pitcher.metrics.recentBattersFaced ??
      pitcher.metrics.projectedBattersFaced ??
      pitcher.metrics.inningsProjection * 4.15,
    16,
  );
  const recentBattersFaced = Math.max(
    pitcher.metrics.recentBattersFaced ?? averageBattersFaced,
    14,
  );
  const averagePitchCount = pitcher.metrics.averagePitchCount ?? pitcher.metrics.inningsProjection * 15.8;
  const lastPitchCount = pitcher.metrics.lastPitchCount ?? averagePitchCount;
  const pitchesPerPlateAppearance = clamp(
    pitcher.metrics.pitchesPerPlateAppearance ?? averagePitchCount / Math.max(averageBattersFaced, 1),
    3.55,
    4.45,
  );
  const recentPitchesPerPlateAppearance = clamp(
    pitcher.metrics.recentPitchesPerPlateAppearance ?? pitchesPerPlateAppearance,
    3.5,
    4.6,
  );
  const pitchBudget = weightedAverage(
    [
      [averagePitchCount, 0.48],
      [lastPitchCount, 0.22],
      [pitcher.metrics.inningsProjection * 15.8, 0.3],
    ],
    averagePitchCount,
  );
  const baselineExpectedBattersFaced = weightedAverage(
    [
      [averageBattersFaced, 0.34],
      [recentBattersFaced, 0.28],
      [pitcher.metrics.projectedBattersFaced ?? pitcher.metrics.inningsProjection * 4.12, 0.38],
    ],
    pitcher.metrics.inningsProjection * 4.12,
  );
  const recentLeashTrend = clamp(
    pitcher.metrics.recentLeashTrend ?? 50 + (lastPitchCount - averagePitchCount) * 2.1,
    15,
    85,
  );
  const quickHookRisk = clamp(
    pitcher.metrics.quickHookRisk ??
      weightedAverage(
        [
          [scaleToScore(pitcher.metrics.recentInningsStd ?? 0.9, 0.15, 1.8), 0.24],
          [100 - recentLeashTrend, 0.18],
          [
            scaleToScore(
              Math.max(
                (pitcher.metrics.averageInningsPerStart ?? pitcher.metrics.inningsProjection) -
                  pitcher.metrics.inningsProjection,
                0,
              ),
              0,
              1.2,
            ),
            0.18,
          ],
          [100 - (pitcher.metrics.recentForm ?? 50), 0.2],
          [scaleToScore(pitcher.metrics.walkRate, 4, 12), 0.2],
        ],
        48,
      ),
    12,
    88,
  );
  const roleCertainty = weightedAverage(
    [
      [scaleToScore(pitcher.metrics.inningsProjection, 4.3, 6.9), 0.28],
      [scaleToScore(pitchBudget, 72, 102), 0.24],
      [inverseScaleToScore(pitcher.metrics.recentInningsStd ?? 0.9, 0.15, 1.8), 0.16],
      [recentLeashTrend, 0.16],
      [pitcher.metrics.opponentLineupConfidenceScore ?? (pitcher.metrics.opponentLineupConfirmed ? 100 : 64), 0.16],
    ],
    58,
  );
  const inningsVolatility = weightedAverage(
    [
      [scaleToScore(pitcher.metrics.recentInningsStd ?? 0.9, 0.15, 1.8), 0.54],
      [scaleToScore(Math.abs((pitcher.metrics.recentForm ?? 50) - 55), 0, 18), 0.18],
      [scaleToScore(Math.abs(recentBattersFaced - averageBattersFaced), 0, 4.5), 0.14],
      [quickHookRisk, 0.14],
    ],
    40,
  );
  const pitchCountCap = weightedAverage(
    [
      [inverseScaleToScore(pitchBudget, 72, 102), 0.54],
      [inverseScaleToScore(lastPitchCount, 70, 108), 0.18],
      [scaleToScore(Math.max(5.9 - pitcher.metrics.inningsProjection, 0), 0, 1.8), 0.14],
      [100 - recentLeashTrend, 0.14],
    ],
    42,
  );
  const earlyExitRisk = weightedAverage(
    [
      [scaleToScore(pitcher.metrics.walkRate, 4, 12), 0.24],
      [scaleToScore(pitcher.metrics.opponentContactQuality ?? 50, 40, 65), 0.18],
      [scaleToScore(pitcher.metrics.hardHitAllowed, 28, 48), 0.16],
      [100 - (pitcher.metrics.recentForm ?? 50), 0.18],
      [scaleToScore(pitcher.metrics.homeRunParkFactor, 90, 120), 0.12],
      [quickHookRisk, 0.12],
    ],
    44,
  );
  const expectedBattersFaced = clamp(
    weightedAverage(
      [
        [baselineExpectedBattersFaced, 0.62],
        [pitchBudget / Math.max(recentPitchesPerPlateAppearance, 3.4), 0.38],
      ],
      baselineExpectedBattersFaced,
    ) *
      clamp(
        0.92 + roleCertainty * 0.0009 - pitchCountCap * 0.0005 - earlyExitRisk * 0.0006,
        0.78,
        1.08,
      ),
    12,
    30,
  );

  return {
    expectedBattersFaced,
    baselineExpectedBattersFaced,
    pitchBudget,
    pitchesPerPlateAppearance,
    recentPitchesPerPlateAppearance,
    roleCertainty,
    quickHookRisk,
    inningsVolatility,
    pitchCountCap,
    earlyExitRisk,
    lineupConfidence:
      pitcher.metrics.opponentLineupConfidenceScore ??
      (pitcher.metrics.opponentLineupConfirmed ? 100 : 64),
  };
};

export const derivePitcherWalkModel = (
  pitcher: RankedPitcher,
  lineValue = 2.5,
): PitcherWalkModel => {
  const workload = buildPitcherWorkloadProfile(pitcher);
  const recentWalkRate = pitcher.metrics.recentWalkRate ?? pitcher.metrics.walkRate;
  const cswRate = pitcher.metrics.calledStrikePlusWhiffRate ?? 26;
  const firstPitchStrikeRate = clamp(
    pitcher.metrics.firstPitchStrikeRate ??
      (60.5 -
        (pitcher.metrics.walkRate - 8) * 1.6 +
        (cswRate - 28) * 0.35 +
        ((pitcher.metrics.framingSupportScore ?? 50) - 50) * 0.05 +
        ((pitcher.metrics.umpireZoneScore ?? 50) - 50) * 0.05),
    54,
    69,
  );
  const zoneRate = clamp(
    pitcher.metrics.zoneRate ??
      (48.5 -
        (pitcher.metrics.walkRate - 8) * 0.8 +
        (firstPitchStrikeRate - 61) * 0.32 +
        ((pitcher.metrics.umpireZoneScore ?? 50) - 50) * 0.03),
    42,
    56,
  );
  const chaseInducedRate = clamp(
    pitcher.metrics.chaseInducedRate ??
      (28 +
        (pitcher.metrics.swingingStrikeRate - 11.5) * 0.75 +
        ((pitcher.metrics.pitchMixAdvantageScore ?? 50) - 50) * 0.06),
    22,
    38,
  );
  const opponentChaseRate = pitcher.metrics.opponentChaseRate ?? 29.5;
  const opponentPatienceScore = clamp(
    pitcher.metrics.opponentPatienceScore ??
      weightedAverage(
        [
          [scaleToScore(pitcher.metrics.opponentWalkRate, 5, 12), 0.58],
          [inverseScaleToScore(opponentChaseRate, 22, 36), 0.42],
        ],
        50,
      ),
    10,
    90,
  );
  const threeBallCountRate = clamp(
    pitcher.metrics.threeBallCountRate ??
      (16.5 +
        (pitcher.metrics.walkRate - 8) * 1.35 -
        (firstPitchStrikeRate - 61) * 0.22 +
        (opponentPatienceScore - 50) * 0.05),
    10,
    30,
  );
  const recentCommandTrend = clamp(
    pitcher.metrics.recentCommandTrend ?? 50 + (pitcher.metrics.walkRate - recentWalkRate) * 4,
    15,
    85,
  );
  const handednessSplitWalkRate = pitcher.metrics.walkRate;
  const walkParkFactor = pitcher.metrics.walkParkFactor ?? pitcher.metrics.parkFactor;
  const commandScore = weightedAverage(
    [
      [inverseScaleToScore(pitcher.metrics.walkRate, 4, 12), 0.22],
      [inverseScaleToScore(recentWalkRate, 4, 12), 0.2],
      [scaleToScore(firstPitchStrikeRate, 55, 69), 0.16],
      [scaleToScore(zoneRate, 42, 56), 0.12],
      [scaleToScore(chaseInducedRate, 22, 38), 0.12],
      [scaleToScore(cswRate, 20, 33), 0.1],
      [inverseScaleToScore(threeBallCountRate, 10, 30), 0.08],
    ],
    50,
  );
  const lineupPatienceScore = weightedAverage(
    [
      [scaleToScore(pitcher.metrics.opponentWalkRate, 5, 12), 0.42],
      [inverseScaleToScore(opponentChaseRate, 22, 36), 0.28],
      [opponentPatienceScore, 0.18],
      [scaleToScore(handednessSplitWalkRate, 4, 11), 0.12],
    ],
    50,
  );
  const environmentScore = weightedAverage(
    [
      [inverseScaleToScore(walkParkFactor, 96, 104), 0.3],
      [pitcher.metrics.framingSupportScore ?? 50, 0.34],
      [pitcher.metrics.umpireZoneScore ?? 50, 0.28],
      [pitcher.metrics.defenseSupportScore ?? 50, 0.08],
    ],
    50,
  );
  const baseWalkProbability = clamp(
    (pitcher.metrics.walkRate * 0.44 +
      recentWalkRate * 0.22 +
      pitcher.metrics.opponentWalkRate * 0.18 +
      handednessSplitWalkRate * 0.1 +
      Math.max(threeBallCountRate - 16, 0) * 0.22) /
      100,
    0.025,
    0.18,
  );
  const adjustedWalkProbability = clamp(
    baseWalkProbability *
      clamp(
        1 +
          (lineupPatienceScore - 50) * 0.0048 -
          (commandScore - 50) * 0.0058 -
          (environmentScore - 50) * 0.0026 -
          (recentCommandTrend - 50) * 0.0016,
        0.62,
        1.42,
      ),
    0.02,
    0.2,
  );
  const mean = clamp(workload.expectedBattersFaced * adjustedWalkProbability, 0.35, 6.5);
  const uncertaintyScore = weightedAverage(
    [
      [100 - commandScore, 0.22],
      [workload.inningsVolatility, 0.2],
      [workload.earlyExitRisk, 0.18],
      [scaleToScore(Math.abs(recentWalkRate - pitcher.metrics.walkRate), 0, 3.2), 0.18],
      [lineupPatienceScore, 0.12],
      [100 - workload.lineupConfidence, 0.1],
    ],
    46,
  );
  const standardDeviation = clamp(0.5 + uncertaintyScore / 100 * 1.3, 0.45, 1.9);
  const overProbability = clampProbability(1 - normalCdf(lineValue, mean, standardDeviation));
  const underProbability = clampProbability(1 - overProbability);
  const confidenceScore = weightedAverage(
    [
      [pitcher.metrics.historicalConfidenceScore ?? 68, 0.18],
      [recentCommandTrend, 0.16],
      [workload.roleCertainty, 0.18],
      [100 - uncertaintyScore, 0.2],
      [workload.lineupConfidence, 0.12],
      [pitcher.metrics.opponentLineupConfirmed ? 100 : 70, 0.16],
    ],
    58,
  );

  return {
    mean,
    median: mean,
    overProbability,
    underProbability,
    confidenceScore,
    uncertaintyScore,
    projectionLayer: {
      adjustedWalkProbability,
      projectedBattersFaced: workload.expectedBattersFaced,
      seasonWalkRate: pitcher.metrics.walkRate,
      recentWalkRate,
      firstPitchStrikeRate,
      zoneRate,
      chaseInducedRate,
      calledStrikePlusWhiffRate: cswRate,
      threeBallCountRate,
      opponentWalkRate: pitcher.metrics.opponentWalkRate,
      opponentChaseRate,
      opponentPatienceScore,
      walkEnvironmentScore: environmentScore,
      matchupAdjustedWalkRate: adjustedWalkProbability * 100,
      handednessSplitWalkRate,
    },
    riskLayer: {
      roleCertainty: workload.roleCertainty,
      commandScore,
      inningsVolatility: workload.inningsVolatility,
      pitchCountCap: workload.pitchCountCap,
      earlyExitRisk: workload.earlyExitRisk,
      lineupConfidence: workload.lineupConfidence,
      recentCommandTrend,
    },
  };
};

export const derivePitcherOutsModel = (
  pitcher: RankedPitcher,
  lineValue = 15.5,
): PitcherOutsModel => {
  const workload = buildPitcherWorkloadProfile(pitcher);
  const walkModel = derivePitcherWalkModel(pitcher, 2.5);
  const opponentPatienceScore =
    pitcher.metrics.opponentPatienceScore ??
    weightedAverage(
      [
        [scaleToScore(pitcher.metrics.opponentWalkRate, 5, 12), 0.58],
        [inverseScaleToScore(pitcher.metrics.opponentChaseRate ?? 29.5, 22, 36), 0.42],
      ],
      50,
    );
  const opponentResistance = weightedAverage(
    [
      [scaleToScore(pitcher.metrics.opponentWalkRate, 5, 12), 0.24],
      [inverseScaleToScore(pitcher.metrics.opponentStrikeoutRate, 18, 28), 0.24],
      [scaleToScore(pitcher.metrics.opponentContactQuality ?? 50, 40, 65), 0.22],
      [opponentPatienceScore, 0.18],
      [scaleToScore(pitcher.metrics.parkFactor, 95, 112), 0.12],
    ],
    50,
  );
  const generatedPitchesPerPlateAppearance = clamp(
    3.7 +
      walkModel.mean * 0.11 +
      (pitcher.metrics.strikeoutRate - 22) * 0.018 +
      (opponentResistance - 50) * 0.006 +
      (workload.recentPitchesPerPlateAppearance - workload.pitchesPerPlateAppearance) * 0.4,
    3.55,
    4.65,
  );
  const expectedPitchesPerPlateAppearance = clamp(
    weightedAverage(
      [
        [workload.pitchesPerPlateAppearance, 0.38],
        [workload.recentPitchesPerPlateAppearance, 0.3],
        [generatedPitchesPerPlateAppearance, 0.32],
      ],
      generatedPitchesPerPlateAppearance,
    ),
    3.55,
    4.65,
  );
  const pitchBudgetBattersFaced =
    workload.pitchBudget / Math.max(expectedPitchesPerPlateAppearance, 3.4);
  const survivalBattersFaced = clamp(
    weightedAverage(
      [
        [workload.expectedBattersFaced, 0.52],
        [pitchBudgetBattersFaced, 0.48],
      ],
      workload.expectedBattersFaced,
    ) *
      clamp(
        0.95 +
          workload.roleCertainty * 0.0008 -
          workload.quickHookRisk * 0.0008 -
          workload.pitchCountCap * 0.0005,
        0.82,
        1.06,
      ),
    12,
    30,
  );
  const baselineOutRate = clamp(
    (pitcher.metrics.inningsProjection * 3) / Math.max(workload.baselineExpectedBattersFaced, 1),
    0.62,
    0.76,
  );
  const contactManagementScore = weightedAverage(
    [
      [inverseScaleToScore(pitcher.metrics.hardHitAllowed, 28, 48), 0.36],
      [inverseScaleToScore(pitcher.metrics.barrelAllowed, 3, 12), 0.32],
      [inverseScaleToScore(pitcher.metrics.averageExitVelocityAllowed, 85, 93), 0.2],
      [scaleToScore((pitcher.metrics as { groundBallRate?: number }).groundBallRate ?? 43, 30, 56), 0.12],
    ],
    50,
  );
  const supportScore = weightedAverage(
    [
      [pitcher.metrics.defenseSupportScore ?? 50, 0.34],
      [pitcher.metrics.bullpenContextScore ?? 50, 0.18],
      [inverseScaleToScore(pitcher.metrics.parkFactor, 95, 112), 0.24],
      [inverseScaleToScore(pitcher.metrics.homeRunParkFactor, 90, 120), 0.14],
      [50, 0.1],
    ],
    50,
  );
  const timesThroughOrderPenalty = weightedAverage(
    [
      [scaleToScore(Math.max(survivalBattersFaced - 18, 0), 0, 6), 0.44],
      [scaleToScore(Math.max(survivalBattersFaced - 27, 0), 0, 3), 0.2],
      [scaleToScore((pitcher.metrics as { timesThroughOrderPenalty?: number }).timesThroughOrderPenalty ?? 50, 35, 80), 0.36],
    ],
    40,
  );
  const outConversionMultiplier = clamp(
    0.98 +
      (contactManagementScore - 50) * 0.0022 +
      (supportScore - 50) * 0.0014 -
      Math.max(walkModel.mean - 2.2, 0) * 0.03 -
      (opponentResistance - 50) * 0.0018 -
      (timesThroughOrderPenalty - 40) * 0.0024,
    0.78,
    1.08,
  );
  const mean = clamp(
    survivalBattersFaced * baselineOutRate * outConversionMultiplier,
    6,
    24.5,
  );
  const uncertaintyScore = weightedAverage(
    [
      [workload.inningsVolatility, 0.24],
      [workload.quickHookRisk, 0.22],
      [timesThroughOrderPenalty, 0.16],
      [opponentResistance, 0.14],
      [scaleToScore(expectedPitchesPerPlateAppearance, 3.6, 4.5), 0.12],
      [scaleToScore(Math.abs(walkModel.mean - 2), 0, 2.5), 0.12],
    ],
    44,
  );
  const standardDeviation = clamp(1.45 + uncertaintyScore / 100 * 2.9, 1.4, 4.7);
  const overProbability = clampProbability(1 - normalCdf(lineValue, mean, standardDeviation));
  const underProbability = clampProbability(1 - overProbability);
  const confidenceScore = weightedAverage(
    [
      [pitcher.metrics.historicalConfidenceScore ?? 68, 0.18],
      [workload.roleCertainty, 0.18],
      [100 - uncertaintyScore, 0.2],
      [100 - workload.quickHookRisk, 0.16],
      [workload.lineupConfidence, 0.12],
      [pitcher.metrics.opponentLineupConfirmed ? 100 : 70, 0.16],
    ],
    58,
  );

  return {
    mean,
    median: mean,
    overProbability,
    underProbability,
    confidenceScore,
    uncertaintyScore,
    projectionLayer: {
      expectedPitchBudget: workload.pitchBudget,
      expectedPitchesPerPlateAppearance,
      pitchBudgetBattersFaced,
      projectedBattersFaced: workload.expectedBattersFaced,
      projectedWalks: walkModel.mean,
      baselineOutRate,
      contactManagementScore,
      supportScore,
      opponentResistance,
      survivalBattersFaced,
    },
    riskLayer: {
      roleCertainty: workload.roleCertainty,
      quickHookRisk: workload.quickHookRisk,
      inningsVolatility: workload.inningsVolatility,
      pitchCountCap: workload.pitchCountCap,
      earlyExitRisk: workload.earlyExitRisk,
      timesThroughOrderPenalty,
      lineupConfidence: workload.lineupConfidence,
    },
  };
};

export const estimatePitcherWalks = (pitcher: RankedPitcher): number =>
  derivePitcherWalkModel(pitcher).mean;

export const estimatePitcherOuts = (pitcher: RankedPitcher): number =>
  derivePitcherOutsModel(pitcher).mean;

const expectedPitcherStrikeouts = (
  snapshot: AnalysisSnapshot,
  pitcherId: string,
): number | null => {
  const pitcher = snapshot.analysis.rankings.pitchers.find(
    (entry) => entry.playerId === pitcherId,
  );

  if (!pitcher) {
    return null;
  }

  return estimatePitcherStrikeouts(pitcher);
};

const expectedPitcherWalks = (
  snapshot: AnalysisSnapshot,
  pitcherId: string,
): number | null => {
  const pitcher = snapshot.analysis.rankings.pitchers.find(
    (entry) => entry.playerId === pitcherId,
  );

  if (!pitcher) {
    return null;
  }

  return estimatePitcherWalks(pitcher);
};

const expectedPitcherOuts = (
  snapshot: AnalysisSnapshot,
  pitcherId: string,
): number | null => {
  const pitcher = snapshot.analysis.rankings.pitchers.find(
    (entry) => entry.playerId === pitcherId,
  );

  if (!pitcher) {
    return null;
  }

  return estimatePitcherOuts(pitcher);
};

const derivePitcherStrikeoutPredictions = (
  snapshot: AnalysisSnapshot,
  odds: OddsRecord[],
): DerivedPrediction[] =>
  odds
    .filter((record) => record.market === 'pitcher_strikeouts')
    .flatMap((record) => {
      if (record.line === undefined) {
        return [];
      }

      const expectedStrikeouts = expectedPitcherStrikeouts(snapshot, record.entityId);
      const pitcher = snapshot.analysis.rankings.pitchers.find(
        (entry) => entry.playerId === record.entityId,
      );

      if (expectedStrikeouts === null) {
        return [];
      }

      const overProbability = clampProbability(
        logistic((expectedStrikeouts - record.line) / 0.9),
      );
      const rawProbability =
        record.selection === 'under' ? 1 - overProbability : overProbability;

      return [
        {
          analysisDate: snapshot.analysisDate,
          market: 'pitcher_strikeouts',
          entityId: record.entityId,
          gameId: record.gameId,
          label: `${pitcher?.playerName ?? record.entityId} ${record.selection} ${record.line} strikeouts`,
          selection: record.selection,
          rawScore: Number(expectedStrikeouts.toFixed(2)),
          rawProbability,
          line: record.line,
          decimalOdds: record.decimalOdds,
          impliedProbability: record.impliedProbability,
          sportsbook: record.sportsbook,
          metadata: {
            playerName: pitcher?.playerName ?? record.entityId,
            expectedStrikeouts: Number(expectedStrikeouts.toFixed(2)),
            strikeoutParkFactor: pitcher?.metrics.strikeoutParkFactor ?? 100,
          },
        },
      ];
    });

const derivePitcherWalkPredictions = (
  snapshot: AnalysisSnapshot,
  odds: OddsRecord[],
): DerivedPrediction[] =>
  odds
    .filter((record) => record.market === 'pitcher_walks')
    .flatMap((record) => {
      if (record.line === undefined) {
        return [];
      }

      const pitcher = snapshot.analysis.rankings.pitchers.find(
        (entry) => entry.playerId === record.entityId,
      );
      const expectedWalks = expectedPitcherWalks(snapshot, record.entityId);

      if (!pitcher || expectedWalks === null) {
        return [];
      }

      const model = derivePitcherWalkModel(pitcher, record.line);
      const rawProbability =
        record.selection === 'under' ? model.underProbability : model.overProbability;

      return [
        {
          analysisDate: snapshot.analysisDate,
          market: 'pitcher_walks',
          entityId: record.entityId,
          gameId: record.gameId,
          label: `${pitcher.playerName} ${record.selection} ${record.line} walks`,
          selection: record.selection,
          rawScore: Number(expectedWalks.toFixed(2)),
          rawProbability,
          line: record.line,
          decimalOdds: record.decimalOdds,
          impliedProbability: record.impliedProbability,
          sportsbook: record.sportsbook,
          metadata: {
            playerName: pitcher.playerName,
            expectedWalks: Number(expectedWalks.toFixed(2)),
            matchupAdjustedWalkRate: Number(
              model.projectionLayer.matchupAdjustedWalkRate.toFixed(1),
            ),
            projectedBattersFaced: Number(
              model.projectionLayer.projectedBattersFaced.toFixed(1),
            ),
          },
        },
      ];
    });

const derivePitcherOutsPredictions = (
  snapshot: AnalysisSnapshot,
  odds: OddsRecord[],
): DerivedPrediction[] =>
  odds
    .filter((record) => record.market === 'pitcher_outs')
    .flatMap((record) => {
      if (record.line === undefined) {
        return [];
      }

      const pitcher = snapshot.analysis.rankings.pitchers.find(
        (entry) => entry.playerId === record.entityId,
      );
      const expectedOuts = expectedPitcherOuts(snapshot, record.entityId);

      if (!pitcher || expectedOuts === null) {
        return [];
      }

      const model = derivePitcherOutsModel(pitcher, record.line);
      const rawProbability =
        record.selection === 'under' ? model.underProbability : model.overProbability;

      return [
        {
          analysisDate: snapshot.analysisDate,
          market: 'pitcher_outs',
          entityId: record.entityId,
          gameId: record.gameId,
          label: `${pitcher.playerName} ${record.selection} ${record.line} outs`,
          selection: record.selection,
          rawScore: Number(expectedOuts.toFixed(2)),
          rawProbability,
          line: record.line,
          decimalOdds: record.decimalOdds,
          impliedProbability: record.impliedProbability,
          sportsbook: record.sportsbook,
          metadata: {
            playerName: pitcher.playerName,
            expectedOuts: Number(expectedOuts.toFixed(2)),
            expectedPitchBudget: Number(model.projectionLayer.expectedPitchBudget.toFixed(1)),
            projectedWalks: Number(model.projectionLayer.projectedWalks.toFixed(2)),
          },
        },
      ];
    });

export const derivePredictionsForMarket = (
  snapshot: AnalysisSnapshot,
  market: BacktestMarket,
  odds: OddsRecord[],
  context: PredictionModelContext = {},
): DerivedPrediction[] => {
  switch (market) {
    case 'game_moneyline_home':
      return deriveMoneylinePredictions(snapshot, odds);
    case 'hitter_home_run':
      return deriveHitterHomeRunPredictions(snapshot, odds, context);
    case 'pitcher_strikeouts':
      return derivePitcherStrikeoutPredictions(snapshot, odds);
    case 'pitcher_walks':
      return derivePitcherWalkPredictions(snapshot, odds);
    case 'pitcher_outs':
      return derivePitcherOutsPredictions(snapshot, odds);
  }
};

const settledMoneylineOutcome = (
  prediction: DerivedPrediction,
  results: ResolvedDailyResults,
): SettledPrediction | null => {
  const game = results.games.find((entry) => entry.gameId === prediction.gameId);

  if (!game) {
    return null;
  }

  return {
    ...prediction,
    outcome: game.homeWon ? 1 : 0,
    resolvedValue: game.homeRuns - game.awayRuns,
  };
};

const settledHomeRunOutcome = (
  prediction: DerivedPrediction,
  results: ResolvedDailyResults,
): SettledPrediction | null => {
  const hitter = results.hitters.find(
    (entry) =>
      entry.gameId === prediction.gameId && entry.playerId === prediction.entityId,
  );

  if (!hitter) {
    return null;
  }

  return {
    ...prediction,
    outcome: hitter.homeRuns > 0 ? 1 : 0,
    resolvedValue: hitter.homeRuns,
  };
};

const settledStrikeoutOutcome = (
  prediction: DerivedPrediction,
  results: ResolvedDailyResults,
): SettledPrediction | null => {
  if (prediction.line === undefined) {
    return null;
  }

  const pitcher = results.pitchers.find(
    (entry) =>
      entry.gameId === prediction.gameId && entry.playerId === prediction.entityId,
  );

  if (!pitcher) {
    return null;
  }

  if (pitcher.strikeouts === prediction.line) {
    return null;
  }

  const overHit = pitcher.strikeouts > prediction.line;

  return {
    ...prediction,
    outcome:
      prediction.selection === 'under'
        ? overHit
          ? 0
          : 1
        : overHit
          ? 1
          : 0,
    resolvedValue: pitcher.strikeouts,
  };
};

const settledWalkOutcome = (
  prediction: DerivedPrediction,
  results: ResolvedDailyResults,
): SettledPrediction | null => {
  if (prediction.line === undefined) {
    return null;
  }

  const pitcher = results.pitchers.find(
    (entry) =>
      entry.gameId === prediction.gameId && entry.playerId === prediction.entityId,
  );

  if (!pitcher) {
    return null;
  }

  if (pitcher.walks === prediction.line) {
    return null;
  }

  const overHit = pitcher.walks > prediction.line;

  return {
    ...prediction,
    outcome:
      prediction.selection === 'under'
        ? overHit
          ? 0
          : 1
        : overHit
          ? 1
          : 0,
    resolvedValue: pitcher.walks,
  };
};

const settledOutsOutcome = (
  prediction: DerivedPrediction,
  results: ResolvedDailyResults,
): SettledPrediction | null => {
  if (prediction.line === undefined) {
    return null;
  }

  const pitcher = results.pitchers.find(
    (entry) =>
      entry.gameId === prediction.gameId && entry.playerId === prediction.entityId,
  );

  if (!pitcher) {
    return null;
  }

  const outsRecorded = pitcher.inningsPitched * 3;

  if (outsRecorded === prediction.line) {
    return null;
  }

  const overHit = outsRecorded > prediction.line;

  return {
    ...prediction,
    outcome:
      prediction.selection === 'under'
        ? overHit
          ? 0
          : 1
        : overHit
          ? 1
          : 0,
    resolvedValue: outsRecorded,
  };
};

export const settlePredictions = (
  predictions: DerivedPrediction[],
  results: ResolvedDailyResults,
): SettledPrediction[] =>
  predictions.flatMap((prediction) => {
    switch (prediction.market) {
      case 'game_moneyline_home': {
        const settled = settledMoneylineOutcome(prediction, results);
        return settled ? [settled] : [];
      }
      case 'hitter_home_run': {
        const settled = settledHomeRunOutcome(prediction, results);
        return settled ? [settled] : [];
      }
      case 'pitcher_strikeouts': {
        const settled = settledStrikeoutOutcome(prediction, results);
        return settled ? [settled] : [];
      }
      case 'pitcher_walks': {
        const settled = settledWalkOutcome(prediction, results);
        return settled ? [settled] : [];
      }
      case 'pitcher_outs': {
        const settled = settledOutsOutcome(prediction, results);
        return settled ? [settled] : [];
      }
    }
  });
