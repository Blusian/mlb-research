import type {
  AttackablePitcher,
  PitcherCandidate,
  PitcherScores,
  RankedPitcher,
} from '@mlb-analyzer/shared';

import { pitcherWeights } from './config/weights.js';
import {
  clampScore,
  formatPercent,
  inverseScaleToScore,
  scaleToScore,
  weightedAverage,
} from './utils/math.js';

const scorePitcher = (pitcher: PitcherCandidate): PitcherScores => {
  const strikeoutSkillScore = scaleToScore(pitcher.metrics.strikeoutRate, 16, 36);
  const controlScore = inverseScaleToScore(pitcher.metrics.walkRate, 3, 12);
  const swingMissScore = scaleToScore(pitcher.metrics.swingingStrikeRate, 9, 18);
  const contactSuppressionScore = weightedAverage([
    [inverseScaleToScore(pitcher.metrics.hardHitAllowed, 26, 48), 0.25],
    [inverseScaleToScore(pitcher.metrics.barrelAllowed, 3, 14), 0.2],
    [inverseScaleToScore(pitcher.metrics.xwobaAllowed, 0.26, 0.39), 0.25],
    [inverseScaleToScore(pitcher.metrics.xslgAllowed, 0.31, 0.55), 0.15],
    [inverseScaleToScore(pitcher.metrics.averageExitVelocityAllowed, 86, 96), 0.15],
  ]);
  const recentFormScore = clampScore(pitcher.metrics.recentForm);
  const workloadScore = scaleToScore(pitcher.metrics.inningsProjection, 4.5, 7.5);
  const matchupScore = weightedAverage([
    [scaleToScore(pitcher.metrics.opponentStrikeoutRate, 18, 29), 0.55],
    [inverseScaleToScore(pitcher.metrics.opponentWalkRate, 5, 11), 0.15],
    [inverseScaleToScore(pitcher.metrics.opponentPowerRating, 35, 80), 0.3],
  ]);
  const environmentScore = weightedAverage([
    [inverseScaleToScore(pitcher.metrics.parkFactor, 88, 116), 0.55],
    [scaleToScore(pitcher.metrics.strikeoutParkFactor, 90, 110), 0.2],
    [clampScore(pitcher.metrics.winSupportRating), 0.45],
  ]);

  const overallPitcherScore = weightedAverage([
    [strikeoutSkillScore, pitcherWeights.overall.strikeoutSkill],
    [controlScore, pitcherWeights.overall.control],
    [contactSuppressionScore, pitcherWeights.overall.contactSuppression],
    [recentFormScore, pitcherWeights.overall.recentForm],
    [workloadScore, pitcherWeights.overall.workload],
    [matchupScore, pitcherWeights.overall.matchup],
    [environmentScore, pitcherWeights.overall.environment],
  ]);

  const strikeoutUpsideScore = weightedAverage([
    [strikeoutSkillScore, pitcherWeights.strikeoutUpside.strikeoutSkill],
    [swingMissScore, pitcherWeights.strikeoutUpside.swingMiss],
    [scaleToScore(pitcher.metrics.opponentStrikeoutRate, 18, 29), pitcherWeights.strikeoutUpside.opponentStrikeouts],
    [workloadScore, pitcherWeights.strikeoutUpside.workload],
    [scaleToScore(pitcher.metrics.strikeoutParkFactor, 90, 110), 0.12],
  ]);

  const safetyScore = weightedAverage([
    [controlScore, pitcherWeights.safety.control],
    [contactSuppressionScore, pitcherWeights.safety.contactSuppression],
    [recentFormScore, pitcherWeights.safety.recentForm],
    [workloadScore, pitcherWeights.safety.workload],
    [environmentScore, pitcherWeights.safety.environment],
  ]);

  const blowupRiskScore = weightedAverage([
    [scaleToScore(pitcher.metrics.hardHitAllowed, 26, 48), pitcherWeights.blowupRisk.hardHitAllowed],
    [scaleToScore(pitcher.metrics.barrelAllowed, 3, 14), pitcherWeights.blowupRisk.barrelAllowed],
    [scaleToScore(pitcher.metrics.walkRate, 3, 12), pitcherWeights.blowupRisk.walkRisk],
    [scaleToScore(pitcher.metrics.opponentPowerRating, 35, 80), pitcherWeights.blowupRisk.opponentPower],
    [scaleToScore(pitcher.metrics.parkFactor, 88, 116), pitcherWeights.blowupRisk.environmentRisk],
    [scaleToScore(pitcher.metrics.homeRunParkFactor, 84, 124), 0.1],
  ]);

  return {
    overallPitcherScore,
    strikeoutUpsideScore,
    safetyScore,
    blowupRiskScore,
  };
};

const pitcherReasons = (pitcher: PitcherCandidate, scores: PitcherScores): string[] => {
  const reasons: string[] = [];

  if (scores.overallPitcherScore >= 70) {
    reasons.push(
      `The profile is stable right now with a ${formatPercent(pitcher.metrics.strikeoutRate)} strikeout rate and only ${formatPercent(pitcher.metrics.walkRate)} walks.`,
    );
  }

  if (scores.strikeoutUpsideScore >= 70) {
    reasons.push(
      `Swing-and-miss upside stands out thanks to a ${formatPercent(pitcher.metrics.swingingStrikeRate)} swinging-strike rate.`,
    );
  }

  if (pitcher.metrics.xwobaAllowed <= 0.31) {
    reasons.push(
      `Statcast contact quality is controlled well with just ${pitcher.metrics.xwobaAllowed.toFixed(3)} xwOBA allowed.`,
    );
  }

  if (pitcher.metrics.opponentStrikeoutRate >= 23) {
    reasons.push(`The opposing lineup can feed punchouts, which lifts the strikeout ceiling.`);
  }

  if (pitcher.metrics.strikeoutParkFactor >= 103) {
    reasons.push(`The park environment leans slightly toward strikeouts, which helps the prop ceiling.`);
  }

  if (scores.blowupRiskScore >= 60) {
    reasons.push(
      `Damage risk stays alive because the contact profile includes ${formatPercent(pitcher.metrics.hardHitAllowed)} hard-hit allowed and ${pitcher.metrics.xslgAllowed.toFixed(3)} xSLG allowed.`,
    );
  }

  return reasons.slice(0, 3);
};

export const rankPitchers = (pitchers: PitcherCandidate[]): RankedPitcher[] =>
  pitchers
    .map((pitcher) => {
      const scores = scorePitcher(pitcher);

      return {
        ...pitcher,
        scores,
        reasons: pitcherReasons(pitcher, scores),
      };
    })
    .sort((left, right) => right.scores.overallPitcherScore - left.scores.overallPitcherScore);

export const buildPitchersToAttack = (pitchers: RankedPitcher[]): AttackablePitcher[] =>
  pitchers
    .map((pitcher) => {
      const attackScore = weightedAverage([
        [pitcher.scores.blowupRiskScore, 0.55],
        [scaleToScore(pitcher.metrics.opponentPowerRating, 35, 80), 0.2],
        [scaleToScore(pitcher.metrics.parkFactor, 88, 116), 0.15],
        [scaleToScore(pitcher.metrics.walkRate, 3, 12), 0.1],
      ]);

      const attackReasons = [
        `Blowup risk sits at ${pitcher.scores.blowupRiskScore.toFixed(1)} for this slate.`,
        `The matchup brings a ${pitcher.metrics.opponentPowerRating.toFixed(0)} opponent power rating.`,
        `Run environment is less forgiving with a ${pitcher.metrics.parkFactor.toFixed(0)} park factor.`,
      ];

      return {
        ...pitcher,
        attackScore,
        attackReasons,
      };
    })
    .sort((left, right) => right.attackScore - left.attackScore);
