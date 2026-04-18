import type {
  DailyAnalysisResponse,
  DailyPropBoards,
  HitterHomeRunProp,
  PitcherLineProp,
  PitcherStrikeoutProp,
} from '@mlb-analyzer/shared';

import {
  buildHomeRunFeatureVector,
  trainHomeRunModel,
  type HomeRunModel,
  type HomeRunTrainingExample,
} from '../modeling/homeRunModel.js';
import {
  deriveHomeRunProbabilityBreakdown,
  derivePitcherOutsModel,
  derivePitcherWalkModel,
  estimatePitcherOuts,
  estimatePitcherStrikeouts,
  estimatePitcherWalks,
} from '../modeling/marketModels.js';
import { ResolvedResultArchive } from '../modeling/resolvedResultArchive.js';
import { SnapshotArchive } from '../modeling/snapshotArchive.js';
import type { AnalysisSnapshot, ResolvedDailyResults } from '../modeling/types.js';
import { createEmptyPropBoards } from './propBoardDefaults.js';

const buildHomeRunTrainingExamples = (
  snapshot: AnalysisSnapshot,
  results: ResolvedDailyResults,
): HomeRunTrainingExample[] => {
  const hitterOutcomes = new Map<string, 0 | 1>(
    results.hitters.map((hitter) => [
      `${hitter.gameId}:${hitter.playerId}`,
      hitter.homeRuns > 0 ? 1 : 0,
    ]),
  );

  return snapshot.analysis.rankings.hitters.flatMap((hitter) => {
    const outcome = hitterOutcomes.get(`${hitter.gameId}:${hitter.playerId}`);

    if (outcome === undefined) {
      return [];
    }

    return [
      {
        analysisDate: snapshot.analysisDate,
        playerId: hitter.playerId,
        gameId: hitter.gameId,
        features: buildHomeRunFeatureVector(hitter),
        outcome,
      } satisfies HomeRunTrainingExample,
    ];
  });
};

const uniqueReasons = (reasons: string[], extra: string[]): string[] =>
  Array.from(new Set([...reasons, ...extra])).slice(0, 4);

const homeRunConfidence = (
  blendedProbability: number,
  homeRunScore: number,
): HitterHomeRunProp['confidence'] => {
  if (blendedProbability >= 0.21 || homeRunScore >= 80) {
    return 'core';
  }

  if (blendedProbability >= 0.15 || homeRunScore >= 70) {
    return 'strong';
  }

  return 'watch';
};

const strikeoutConfidence = (
  projectedStrikeouts: number,
  strikeoutScore: number,
): PitcherStrikeoutProp['confidence'] => {
  if (projectedStrikeouts >= 7.1 || strikeoutScore >= 78) {
    return 'core';
  }

  if (projectedStrikeouts >= 5.9 || strikeoutScore >= 68) {
    return 'strong';
  }

  return 'watch';
};

const strikeoutOverProbability = (
  projectedStrikeouts: number,
  threshold: number,
): number => {
  const edge = projectedStrikeouts - threshold;
  const probability = 1 / (1 + Math.exp(-(edge * 1.15 - 0.15)));

  return Math.max(0.01, Math.min(0.99, probability));
};

const pitcherLineConfidence = (
  confidenceScore: number,
): PitcherLineProp['confidence'] => {
  if (confidenceScore >= 80) {
    return 'elite';
  }

  if (confidenceScore >= 68) {
    return 'strong';
  }

  if (confidenceScore >= 55) {
    return 'watch';
  }

  return 'thin';
};

const hitterLineupSource = (
  lineupConfirmed: boolean,
  explicitSource?: 'official' | 'projected',
): HitterHomeRunProp['lineupSource'] => explicitSource ?? (lineupConfirmed ? 'official' : 'projected');

const pitcherLineupSource = (
  opponentLineupCount: number,
  opponentConfirmedHitterCount: number,
  explicitSource?: 'official' | 'projected' | 'mixed',
): PitcherLineProp['lineupSource'] => {
  if (explicitSource) {
    return explicitSource;
  }
  if (opponentLineupCount >= 9 && opponentConfirmedHitterCount >= 9) {
    return 'official';
  }
  if (opponentConfirmedHitterCount <= 0) {
    return 'projected';
  }
  return 'mixed';
};

export class PropBoardService {
  private readonly homeRunModelCache = new Map<string, HomeRunModel | null>();

  public constructor(
    private readonly snapshotArchive: SnapshotArchive,
    private readonly resultArchive: ResolvedResultArchive,
  ) {}

  public build(response: DailyAnalysisResponse): DailyPropBoards {
    const homeRunModel = this.getHomeRunModel(response.meta.analysisDate);

    return {
      ...createEmptyPropBoards(),
      hitterHomeRuns: response.rankings.homeRunCandidates
        .map((hitter) => {
          const breakdown = deriveHomeRunProbabilityBreakdown(hitter, { homeRunModel });
          const confidence = homeRunConfidence(
            breakdown.blendedProbability,
            hitter.scores.homeRunUpsideScore,
          );

          return {
            market: 'hitter_home_run',
            entityId: hitter.playerId,
            gameId: hitter.gameId,
            label: `${hitter.playerName} to hit a home run`,
            playerName: hitter.playerName,
            teamAbbreviation: hitter.team.abbreviation,
            opponentAbbreviation: hitter.opponent.abbreviation,
            matchupLabel: hitter.matchupLabel,
            lineupSpot: hitter.metrics.lineupSpot,
            lineupConfirmed: hitter.metrics.lineupConfirmed,
            lineupSource: hitterLineupSource(
              hitter.metrics.lineupConfirmed,
              hitter.metrics.lineupSource,
            ),
            homeRunScore: hitter.scores.homeRunUpsideScore,
            blendedProbability: breakdown.blendedProbability,
            heuristicProbability: breakdown.heuristicProbability,
            learnedProbability: breakdown.learnedProbability ?? null,
            modelType: breakdown.modelType,
            trainingSamples: breakdown.trainingSamples,
            confidence,
            reasons: uniqueReasons(hitter.reasons, [
              hitter.metrics.averageBatSpeed >= 74.5
                ? `Bat speed is ${hitter.metrics.averageBatSpeed.toFixed(1)} mph, which supports this power look.`
                : '',
              hitter.metrics.batterVsPitcherPlateAppearances >= 6 &&
              hitter.metrics.batterVsPitcherScore >= 60
                ? `Direct BvP history is favorable with a ${hitter.metrics.batterVsPitcherOps.toFixed(3)} OPS across ${hitter.metrics.batterVsPitcherPlateAppearances} plate appearances.`
                : '',
              hitter.metrics.pitchMixMatchupSample >= 8 &&
              hitter.metrics.pitchMixMatchupScore >= 58
                ? `The pitch mix grades well against ${hitter.metrics.primaryPitchTypeDescription} usage (${hitter.metrics.primaryPitchUsage.toFixed(1)}%).`
                : '',
              hitter.metrics.homeRunParkFactorVsHandedness >= 106
                ? `The handedness-adjusted park factor is favorable for home runs.`
                : '',
              breakdown.modelType === 'learned_logistic_blend'
                ? `The learned model is active with ${breakdown.trainingSamples} archived training examples.`
                : 'The probability is using the current heuristic curve because there is not enough archived history yet.',
            ].filter(Boolean)),
            metrics: {
              hardHitRate: hitter.metrics.hardHitRate,
              barrelRate: hitter.metrics.barrelRate,
              averageBatSpeed: hitter.metrics.averageBatSpeed,
              blastRate: hitter.metrics.blastRate,
              squaredUpRate: hitter.metrics.squaredUpRate,
              batterVsPitcherPlateAppearances:
                hitter.metrics.batterVsPitcherPlateAppearances,
              batterVsPitcherOps: hitter.metrics.batterVsPitcherOps,
              batterVsPitcherHomeRuns: hitter.metrics.batterVsPitcherHomeRuns,
              batterVsPitcherScore: hitter.metrics.batterVsPitcherScore,
              pitchMixMatchupScore: hitter.metrics.pitchMixMatchupScore,
              pitchMixMatchupSample: hitter.metrics.pitchMixMatchupSample,
              primaryPitchTypeDescription: hitter.metrics.primaryPitchTypeDescription,
              primaryPitchUsage: hitter.metrics.primaryPitchUsage,
              secondaryPitchTypeDescription: hitter.metrics.secondaryPitchTypeDescription,
              secondaryPitchUsage: hitter.metrics.secondaryPitchUsage,
              homeRunParkFactor: hitter.metrics.homeRunParkFactor,
              homeRunParkFactorVsHandedness: hitter.metrics.homeRunParkFactorVsHandedness,
              opponentPitcherPowerAllowed: hitter.metrics.opponentPitcherPowerAllowed,
              recentForm: hitter.metrics.recentForm,
            },
          } satisfies HitterHomeRunProp;
        })
        .sort((left, right) => right.blendedProbability - left.blendedProbability),
      pitcherStrikeouts: response.rankings.pitchers
        .map((pitcher) => {
          const projectedStrikeouts = estimatePitcherStrikeouts(pitcher);
          const meanKs = projectedStrikeouts;
          const medianKs = Math.max(0, Math.round(projectedStrikeouts - 0.2));
          const over3_5Probability = strikeoutOverProbability(projectedStrikeouts, 3.5);
          const over4_5Probability = strikeoutOverProbability(projectedStrikeouts, 4.5);
          const confidence = strikeoutConfidence(
            projectedStrikeouts,
            pitcher.scores.strikeoutUpsideScore,
          );
          const lineupVsPitcherHandKRate =
            pitcher.metrics.lineupVsPitcherHandKRate ??
            pitcher.metrics.lineupStrikeoutRateVsHand ??
            pitcher.metrics.opponentStrikeoutRate;
          const pitchMixAdvantageScore =
            pitcher.metrics.pitchMixAdvantageScore ?? pitcher.scores.strikeoutUpsideScore;
          const opponentLineupCount = pitcher.metrics.opponentLineupCount ?? 9;
          const opponentConfirmedHitterCount =
            pitcher.metrics.opponentConfirmedHitterCount ??
            (pitcher.metrics.opponentLineupConfirmed ? opponentLineupCount : 0);
          const opponentLineupConfidenceScore =
            pitcher.metrics.opponentLineupConfidenceScore ??
            (pitcher.metrics.opponentLineupConfirmed ? 100 : 55);
          const expectedBattersFaced =
            pitcher.metrics.projectedBattersFaced ?? pitcher.metrics.inningsProjection * 4.2;
          const matchupAdjustedKRate =
            pitcher.metrics.matchupAdjustedKRate ?? lineupVsPitcherHandKRate;
          const lineupSource = pitcherLineupSource(
            opponentLineupCount,
            opponentConfirmedHitterCount,
            pitcher.metrics.opponentLineupSource,
          );

          return {
            market: 'pitcher_strikeouts',
            entityId: pitcher.playerId,
            gameId: pitcher.gameId,
            label: `${pitcher.playerName} strikeout projection`,
            playerName: pitcher.playerName,
            teamAbbreviation: pitcher.team.abbreviation,
            opponentAbbreviation: pitcher.opponent.abbreviation,
            matchupLabel: pitcher.matchupLabel,
            lineupConfirmed: lineupSource === 'official',
            lineupSource,
            strikeoutScore: pitcher.scores.strikeoutUpsideScore,
            projectedStrikeouts,
            meanKs,
            medianKs,
            over3_5Probability,
            over4_5Probability,
            inningsProjection: pitcher.metrics.inningsProjection,
            confidence,
            reasons: uniqueReasons(pitcher.reasons, [
              `The current projection sits at ${projectedStrikeouts.toFixed(1)} strikeouts.`,
              pitcher.metrics.strikeoutParkFactor >= 103
                ? `The strikeout park factor is ${pitcher.metrics.strikeoutParkFactor.toFixed(0)}.`
                : '',
              pitcher.metrics.opponentStrikeoutRate >= 23
                ? `The opposing lineup strikeout rate is ${pitcher.metrics.opponentStrikeoutRate.toFixed(1)}%.`
                : '',
            ].filter(Boolean)),
            metrics: {
              strikeoutRate: pitcher.metrics.strikeoutRate,
              swingingStrikeRate: pitcher.metrics.swingingStrikeRate,
              opponentStrikeoutRate: pitcher.metrics.opponentStrikeoutRate,
              lineupVsPitcherHandKRate,
              pitchMixAdvantageScore,
              opponentLineupCount,
              opponentConfirmedHitterCount,
              opponentLineupConfidenceScore,
              strikeoutParkFactor: pitcher.metrics.strikeoutParkFactor,
              walkRate: pitcher.metrics.walkRate,
              projectionLayer: {
                trueTalentKAbility: pitcher.scores.strikeoutUpsideScore,
                opponentKTendencies: pitcher.metrics.opponentStrikeoutRate * 4,
                umpireParkLineup: Math.max(
                  0,
                  Math.min(100, (pitcher.metrics.strikeoutParkFactor - 90) * 5),
                ),
                expectedBattersFaced,
                lineupVsPitcherHandKRate,
                matchupAdjustedKRate,
                pitchMixAdvantage: pitchMixAdvantageScore,
                lineupConfidence: opponentLineupConfidenceScore,
                trackedLineupSpots: opponentLineupCount,
                confirmedLineupSpots: opponentConfirmedHitterCount,
              },
              riskLayer: {
                roleCertainty: Math.max(0, Math.min(100, pitcher.metrics.inningsProjection * 14)),
                inningsVolatility: Math.max(
                  0,
                  Math.min(100, Math.abs((pitcher.metrics.recentForm ?? 50) - 60) * 2.5),
                ),
                pitchCountCap: Math.max(0, Math.min(100, 100 - pitcher.metrics.inningsProjection * 12)),
                earlyExitRisk: Math.max(
                  0,
                  Math.min(100, pitcher.metrics.walkRate * 5 + (pitcher.metrics.homeRunParkFactor - 100) * 1.5),
                ),
                recentWorkload: Math.max(0, Math.min(100, (pitcher.metrics.inningsProjection - 4.5) * 18)),
                contactHeavyOpponentPenalty: Math.max(
                  0,
                  Math.min(100, 100 - pitcher.metrics.opponentStrikeoutRate * 3.5),
                ),
              },
            },
          } satisfies PitcherStrikeoutProp;
        })
        .sort((left, right) => right.projectedStrikeouts - left.projectedStrikeouts),
      pitcherWalks: response.rankings.pitchers
        .map((pitcher) => {
          const model = derivePitcherWalkModel(pitcher, 2.5);
          const projectedWalks = estimatePitcherWalks(pitcher);
          const confidence = pitcherLineConfidence(model.confidenceScore);
          const lineupSource = pitcherLineupSource(
            pitcher.metrics.opponentLineupCount ?? 0,
            pitcher.metrics.opponentConfirmedHitterCount ?? 0,
            pitcher.metrics.opponentLineupSource,
          );

          return {
            market: 'pitcher_walks',
            entityId: pitcher.playerId,
            gameId: pitcher.gameId,
            label: `${pitcher.playerName} over 2.5 walks allowed`,
            playerName: pitcher.playerName,
            teamAbbreviation: pitcher.team.abbreviation,
            opponentAbbreviation: pitcher.opponent.abbreviation,
            matchupLabel: pitcher.matchupLabel,
            lineupConfirmed: lineupSource === 'official',
            lineupSource,
            marketScore: Number(
              Math.max(
                0,
                Math.min(
                  100,
                  projectedWalks * 18 +
                    model.overProbability * 52 +
                    model.confidenceScore * 0.3,
                ),
              ).toFixed(1),
            ),
            lineValue: 2.5,
            projectionValue: Number(projectedWalks.toFixed(2)),
            meanValue: Number(projectedWalks.toFixed(2)),
            medianValue: Number(model.median.toFixed(1)),
            deltaVsLine: Number((projectedWalks - 2.5).toFixed(2)),
            overLineProbability: Number(model.overProbability.toFixed(4)),
            underLineProbability: Number(model.underProbability.toFixed(4)),
            confidenceScore: Number(model.confidenceScore.toFixed(1)),
            uncertaintyScore: Number(model.uncertaintyScore.toFixed(1)),
            modelType: 'hybrid_workload_command',
            confidence,
            reasons: uniqueReasons(pitcher.reasons, [
              `The walk projection sits at ${projectedWalks.toFixed(2)} over ${model.projectionLayer.projectedBattersFaced.toFixed(1)} projected batters faced.`,
              model.projectionLayer.opponentPatienceScore >= 55
                ? 'The opposing lineup grades patient enough to extend counts.'
                : '',
              model.riskLayer.commandScore <= 46
                ? 'Pitcher command indicators lean below average in this matchup.'
                : '',
            ].filter(Boolean)),
            metrics: {
              inningsProjection: pitcher.metrics.inningsProjection,
              projectedOuts: pitcher.metrics.inningsProjection * 3,
              expectedBattersFaced: model.projectionLayer.projectedBattersFaced,
              strikeoutRate: pitcher.metrics.strikeoutRate,
              walkRate: pitcher.metrics.walkRate,
              opponentWalkRate: pitcher.metrics.opponentWalkRate,
              recentForm: pitcher.metrics.recentForm,
              roleCertainty: model.riskLayer.roleCertainty,
              inningsVolatility: model.riskLayer.inningsVolatility,
              pitchCountCap: model.riskLayer.pitchCountCap,
              earlyExitRisk: model.riskLayer.earlyExitRisk,
              lineupConfidence: model.riskLayer.lineupConfidence,
              trackedLineupSpots: pitcher.metrics.opponentLineupCount ?? 0,
              confirmedLineupSpots: pitcher.metrics.opponentConfirmedHitterCount ?? 0,
              averagePitchCount: pitcher.metrics.averagePitchCount,
              lastPitchCount: pitcher.metrics.lastPitchCount,
              averageBattersFaced: pitcher.metrics.averageBattersFaced,
              averageInningsPerStart: pitcher.metrics.averageInningsPerStart,
              pitchesPerPlateAppearance: pitcher.metrics.pitchesPerPlateAppearance,
              recentPitchesPerPlateAppearance: pitcher.metrics.recentPitchesPerPlateAppearance,
              recentWalkRate: pitcher.metrics.recentWalkRate,
              recentCommandTrend: pitcher.metrics.recentCommandTrend,
              recentLeashTrend: pitcher.metrics.recentLeashTrend,
              quickHookRisk: pitcher.metrics.quickHookRisk,
              walkParkFactor: pitcher.metrics.walkParkFactor,
              opponentChaseRate: pitcher.metrics.opponentChaseRate,
              opponentPatienceScore: pitcher.metrics.opponentPatienceScore,
              framingSupportScore: pitcher.metrics.framingSupportScore,
              umpireZoneScore: pitcher.metrics.umpireZoneScore,
              defenseSupportScore: pitcher.metrics.defenseSupportScore,
              bullpenContextScore: pitcher.metrics.bullpenContextScore,
              firstPitchStrikeRate: pitcher.metrics.firstPitchStrikeRate,
              zoneRate: pitcher.metrics.zoneRate,
              chaseInducedRate: pitcher.metrics.chaseInducedRate,
              threeBallCountRate: pitcher.metrics.threeBallCountRate,
              matchupAdjustedWalkRate: Number(
                model.projectionLayer.matchupAdjustedWalkRate.toFixed(1),
              ),
              projectionLayer: model.projectionLayer,
              riskLayer: model.riskLayer,
            },
          } satisfies PitcherLineProp;
        })
        .sort(
          (left, right) =>
            (right.overLineProbability ?? 0) - (left.overLineProbability ?? 0),
        ),
      pitcherOuts: response.rankings.pitchers
        .map((pitcher) => {
          const model = derivePitcherOutsModel(pitcher, 15.5);
          const projectedOuts = estimatePitcherOuts(pitcher);
          const confidence = pitcherLineConfidence(model.confidenceScore);
          const lineupSource = pitcherLineupSource(
            pitcher.metrics.opponentLineupCount ?? 0,
            pitcher.metrics.opponentConfirmedHitterCount ?? 0,
            pitcher.metrics.opponentLineupSource,
          );

          return {
            market: 'pitcher_outs',
            entityId: pitcher.playerId,
            gameId: pitcher.gameId,
            label: `${pitcher.playerName} over 15.5 outs recorded`,
            playerName: pitcher.playerName,
            teamAbbreviation: pitcher.team.abbreviation,
            opponentAbbreviation: pitcher.opponent.abbreviation,
            matchupLabel: pitcher.matchupLabel,
            lineupConfirmed: lineupSource === 'official',
            lineupSource,
            marketScore: Number(
              Math.max(
                0,
                Math.min(
                  100,
                  projectedOuts * 4.2 +
                    model.overProbability * 52 +
                    model.confidenceScore * 0.3,
                ),
              ).toFixed(1),
            ),
            lineValue: 15.5,
            projectionValue: Number(projectedOuts.toFixed(2)),
            meanValue: Number(projectedOuts.toFixed(2)),
            medianValue: Number(model.median.toFixed(1)),
            deltaVsLine: Number((projectedOuts - 15.5).toFixed(2)),
            overLineProbability: Number(model.overProbability.toFixed(4)),
            underLineProbability: Number(model.underProbability.toFixed(4)),
            confidenceScore: Number(model.confidenceScore.toFixed(1)),
            uncertaintyScore: Number(model.uncertaintyScore.toFixed(1)),
            modelType: 'hybrid_workload_survival',
            confidence,
            reasons: uniqueReasons(pitcher.reasons, [
              `The outs projection sits at ${projectedOuts.toFixed(2)} with a ${model.projectionLayer.expectedPitchBudget.toFixed(1)} pitch budget.`,
              model.riskLayer.quickHookRisk >= 58
                ? 'Quick-hook risk is meaningful, which keeps the innings leash in check.'
                : '',
              model.projectionLayer.projectedWalks >= 2.8
                ? 'Projected walks are raising the pitch-cost side of the outs model.'
                : '',
            ].filter(Boolean)),
            metrics: {
              inningsProjection: pitcher.metrics.inningsProjection,
              projectedOuts: pitcher.metrics.inningsProjection * 3,
              expectedBattersFaced: model.projectionLayer.projectedBattersFaced,
              strikeoutRate: pitcher.metrics.strikeoutRate,
              walkRate: pitcher.metrics.walkRate,
              opponentWalkRate: pitcher.metrics.opponentWalkRate,
              recentForm: pitcher.metrics.recentForm,
              roleCertainty: model.riskLayer.roleCertainty,
              inningsVolatility: model.riskLayer.inningsVolatility,
              pitchCountCap: model.riskLayer.pitchCountCap,
              earlyExitRisk: model.riskLayer.earlyExitRisk,
              lineupConfidence: model.riskLayer.lineupConfidence,
              trackedLineupSpots: pitcher.metrics.opponentLineupCount ?? 0,
              confirmedLineupSpots: pitcher.metrics.opponentConfirmedHitterCount ?? 0,
              averagePitchCount: pitcher.metrics.averagePitchCount,
              lastPitchCount: pitcher.metrics.lastPitchCount,
              averageBattersFaced: pitcher.metrics.averageBattersFaced,
              averageInningsPerStart: pitcher.metrics.averageInningsPerStart,
              pitchesPerPlateAppearance: pitcher.metrics.pitchesPerPlateAppearance,
              recentPitchesPerPlateAppearance: pitcher.metrics.recentPitchesPerPlateAppearance,
              recentWalkRate: pitcher.metrics.recentWalkRate,
              recentCommandTrend: pitcher.metrics.recentCommandTrend,
              recentLeashTrend: pitcher.metrics.recentLeashTrend,
              quickHookRisk: pitcher.metrics.quickHookRisk,
              walkParkFactor: pitcher.metrics.walkParkFactor,
              opponentChaseRate: pitcher.metrics.opponentChaseRate,
              opponentPatienceScore: pitcher.metrics.opponentPatienceScore,
              framingSupportScore: pitcher.metrics.framingSupportScore,
              umpireZoneScore: pitcher.metrics.umpireZoneScore,
              defenseSupportScore: pitcher.metrics.defenseSupportScore,
              bullpenContextScore: pitcher.metrics.bullpenContextScore,
              firstPitchStrikeRate: pitcher.metrics.firstPitchStrikeRate,
              zoneRate: pitcher.metrics.zoneRate,
              chaseInducedRate: pitcher.metrics.chaseInducedRate,
              threeBallCountRate: pitcher.metrics.threeBallCountRate,
              projectionLayer: model.projectionLayer,
              riskLayer: model.riskLayer,
            },
          } satisfies PitcherLineProp;
        })
        .sort(
          (left, right) =>
            (right.overLineProbability ?? 0) - (left.overLineProbability ?? 0),
        ),
    };
  }

  private getHomeRunModel(analysisDate: string): HomeRunModel | null {
    const cached = this.homeRunModelCache.get(analysisDate);

    if (cached !== undefined) {
      return cached;
    }

    const snapshotMap = new Map(
      this.snapshotArchive
        .list()
        .filter((snapshot) => snapshot.analysisDate < analysisDate)
        .map((snapshot) => [snapshot.analysisDate, snapshot]),
    );
    const resultMap = new Map(
      this.resultArchive
        .list()
        .filter((result) => result.analysisDate < analysisDate)
        .map((result) => [result.analysisDate, result]),
    );
    const trainingExamples = Array.from(snapshotMap.keys())
      .filter((date) => resultMap.has(date))
      .sort()
      .flatMap((date) =>
        buildHomeRunTrainingExamples(
          snapshotMap.get(date)!,
          resultMap.get(date)!,
        ),
      );
    const model = trainHomeRunModel(trainingExamples);

    this.homeRunModelCache.set(analysisDate, model);
    return model;
  }
}
