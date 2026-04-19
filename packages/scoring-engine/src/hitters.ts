import type { RankedHitter, HitterCandidate, HitterScores } from '@mlb-analyzer/shared';

import { hitterWeights } from './config/weights.js';
import {
  clampScore,
  formatPercent,
  formatRate,
  inverseScaleToScore,
  lineupSpotScore,
  scaleToScore,
  weightedAverage,
} from './utils/math.js';

const scoreHitter = (hitter: HitterCandidate): HitterScores => {
  const hitsProjection = hitter.metrics.propModeling?.hitterHits;
  const totalBasesProjection = hitter.metrics.propModeling?.hitterTotalBases;
  const contactScore = weightedAverage([
    [scaleToScore(hitter.metrics.averageVsHandedness, 0.21, 0.34), 0.25],
    [scaleToScore(hitter.metrics.wobaVsHandedness, 0.28, 0.45), 0.25],
    [scaleToScore(hitter.metrics.xbaVsHandedness, 0.21, 0.34), 0.2],
    [scaleToScore(hitter.metrics.xwobaVsHandedness, 0.28, 0.45), 0.3],
  ]);
  const powerScore = weightedAverage([
    [scaleToScore(hitter.metrics.isoVsHandedness, 0.1, 0.34), 0.35],
    [scaleToScore(hitter.metrics.xslgVsHandedness, 0.32, 0.7), 0.3],
    [scaleToScore(hitter.metrics.barrelRate, 2, 20), 0.35],
  ]);
  const batTrackingScore = weightedAverage([
    [scaleToScore(hitter.metrics.averageBatSpeed, 68, 79), 0.28],
    [scaleToScore(hitter.metrics.hardSwingRate, 8, 35), 0.18],
    [scaleToScore(hitter.metrics.squaredUpRate, 18, 42), 0.26],
    [scaleToScore(hitter.metrics.blastRate, 3, 20), 0.2],
    [inverseScaleToScore(hitter.metrics.swingLength, 6, 9.5), 0.08],
  ]);
  const disciplineScore = weightedAverage([
    [inverseScaleToScore(hitter.metrics.strikeoutRate, 12, 35), 0.55],
    [scaleToScore(hitter.metrics.walkRate, 4, 16), 0.45],
  ]);
  const contactQualityScore = weightedAverage([
    [scaleToScore(hitter.metrics.hardHitRate, 28, 58), 0.4],
    [scaleToScore(hitter.metrics.barrelRate, 2, 20), 0.35],
    [scaleToScore(hitter.metrics.averageExitVelocity, 86, 96), 0.25],
    [batTrackingScore, 0.2],
  ]);
  const recentFormScore = clampScore(hitter.metrics.recentForm);
  const pitcherVulnerabilityScore = weightedAverage([
    [scaleToScore(hitter.metrics.opponentPitcherContactAllowed, 28, 50), 0.5],
    [scaleToScore(hitter.metrics.opponentPitcherPowerAllowed, 3, 14), 0.5],
  ]);
  const parkBoostScore = weightedAverage([
    [scaleToScore(hitter.metrics.parkFactor, 88, 116), 0.45],
    [scaleToScore(hitter.metrics.homeRunParkFactor, 84, 120), 0.55],
    [scaleToScore(hitter.metrics.parkFactorVsHandedness, 88, 120), 0.25],
    [scaleToScore(hitter.metrics.homeRunParkFactorVsHandedness, 84, 126), 0.3],
    [scaleToScore(hitter.metrics.hitParkFactorVsHandedness, 88, 120), 0.15],
  ]);
  const lineupContextScore = weightedAverage([
    [lineupSpotScore(hitter.metrics.lineupSpot), 0.6],
    [hitter.metrics.lineupConfirmed ? 100 : 68, 0.15],
    [clampScore(hitter.metrics.playingTimeConfidence), 0.25],
  ]);
  const probabilisticHitScore = hitsProjection
    ? weightedAverage([
        [scaleToScore(hitsProjection.meanValue ?? hitsProjection.projectionValue, 0.8, 2.4), 0.34],
        [((hitsProjection.overLineProbability ?? 0.5) * 100), 0.38],
        [hitsProjection.confidenceScore ?? 50, 0.28],
      ])
    : undefined;
  const probabilisticTotalBasesScore = totalBasesProjection
    ? weightedAverage([
        [scaleToScore(totalBasesProjection.meanValue ?? totalBasesProjection.projectionValue, 1.0, 3.8), 0.34],
        [((totalBasesProjection.overLineProbability ?? 0.5) * 100), 0.38],
        [totalBasesProjection.confidenceScore ?? 50, 0.28],
      ])
    : undefined;
  const matchupIntelligenceScore = weightedAverage([
    [clampScore(hitter.metrics.batterVsPitcherScore), 0.42],
    [clampScore(hitter.metrics.pitchMixMatchupScore), 0.58],
  ]);

  const overallEntries: Array<[number, number]> = [
    [contactScore, hitterWeights.overall.splitSkill],
    [weightedAverage([[powerScore, 0.72], [batTrackingScore, 0.28]]), hitterWeights.overall.power],
    [disciplineScore, hitterWeights.overall.discipline],
    [contactQualityScore, hitterWeights.overall.contactQuality],
    [recentFormScore, hitterWeights.overall.recentForm],
    [pitcherVulnerabilityScore, hitterWeights.overall.pitcherVulnerability],
    [parkBoostScore, hitterWeights.overall.parkBoost],
    [lineupContextScore, hitterWeights.overall.lineupContext],
    [matchupIntelligenceScore, 0.1],
  ];
  if (probabilisticHitScore !== undefined) {
    overallEntries.push([probabilisticHitScore, 0.12]);
  }
  if (probabilisticTotalBasesScore !== undefined) {
    overallEntries.push([probabilisticTotalBasesScore, 0.10]);
  }
  const overallHitScore = weightedAverage(overallEntries);

  const homeRunEntries: Array<[number, number]> = [
    [powerScore, hitterWeights.homeRun.power],
    [scaleToScore(hitter.metrics.barrelRate, 2, 20), hitterWeights.homeRun.barrel],
    [scaleToScore(hitter.metrics.hardHitRate, 28, 58), hitterWeights.homeRun.hardHit],
    [batTrackingScore, 0.22],
    [
      scaleToScore(hitter.metrics.opponentPitcherPowerAllowed, 3, 14),
      hitterWeights.homeRun.pitcherPowerAllowed,
    ],
    [scaleToScore(hitter.metrics.homeRunParkFactor, 84, 120), hitterWeights.homeRun.homeRunParkBoost],
    [scaleToScore(hitter.metrics.homeRunParkFactorVsHandedness, 84, 126), 0.12],
    [weightedAverage([[clampScore(hitter.metrics.pitchMixMatchupScore), 0.64], [clampScore(hitter.metrics.batterVsPitcherScore), 0.36]]), 0.16],
  ];
  if (probabilisticTotalBasesScore !== undefined) {
    homeRunEntries.push([probabilisticTotalBasesScore, 0.10]);
  }
  const homeRunUpsideScore = weightedAverage(homeRunEntries);

  const floorEntries: Array<[number, number]> = [
    [contactScore, hitterWeights.floor.contact],
    [disciplineScore, hitterWeights.floor.discipline],
    [recentFormScore, hitterWeights.floor.recentForm],
    [lineupContextScore, hitterWeights.floor.lineupContext],
    [pitcherVulnerabilityScore, hitterWeights.floor.pitcherVulnerability],
    [parkBoostScore, hitterWeights.floor.parkBoost],
    [matchupIntelligenceScore, 0.08],
  ];
  if (probabilisticHitScore !== undefined) {
    floorEntries.push([probabilisticHitScore, 0.16]);
  }
  const floorScore = weightedAverage(floorEntries);

  const riskEntries: Array<[number, number]> = [
    [scaleToScore(hitter.metrics.strikeoutRate, 15, 36), hitterWeights.risk.strikeoutRisk],
    [100 - lineupContextScore, hitterWeights.risk.lineupVolatility],
    [100 - contactScore, hitterWeights.risk.weakSplit],
    [100 - recentFormScore, hitterWeights.risk.weakForm],
    [100 - pitcherVulnerabilityScore, hitterWeights.risk.pitcherDifficulty],
    [inverseScaleToScore(hitter.metrics.squaredUpRate, 18, 42), 0.12],
    [100 - matchupIntelligenceScore, 0.1],
  ];
  if (probabilisticHitScore !== undefined) {
    riskEntries.push([100 - probabilisticHitScore, 0.10]);
  }
  const riskScore = weightedAverage(riskEntries);

  return {
    overallHitScore,
    homeRunUpsideScore,
    floorScore,
    riskScore,
  };
};

const hitterReasons = (hitter: HitterCandidate, scores: HitterScores): string[] => {
  const reasons: string[] = [];
  const hitsProjection = hitter.metrics.propModeling?.hitterHits;
  const totalBasesProjection = hitter.metrics.propModeling?.hitterTotalBases;

  if (scores.overallHitScore >= 70) {
    reasons.push(
      `Strong split profile with a ${formatRate(hitter.metrics.wobaVsHandedness)} wOBA and ${formatRate(hitter.metrics.isoVsHandedness)} ISO in this handedness matchup.`,
    );
  }

  if (hitter.metrics.xwobaVsHandedness >= 0.36 || hitter.metrics.xslgVsHandedness >= 0.5) {
    reasons.push(
      `Statcast quality of contact is strong here with a ${formatRate(hitter.metrics.xwobaVsHandedness)} xwOBA and ${formatRate(hitter.metrics.xslgVsHandedness)} xSLG.`,
    );
  }

  if (hitsProjection?.projectionLayer?.contactQualityEdge !== undefined) {
    reasons.push(
      `Contact-quality edge grades at ${Number(hitsProjection.projectionLayer.contactQualityEdge).toFixed(1)} in the hit model.`,
    );
  }

  if (
    hitter.metrics.batterVsPitcherPlateAppearances >= 6 &&
    hitter.metrics.batterVsPitcherScore >= 60
  ) {
    reasons.push(
      `Prior BvP history is encouraging with a ${formatRate(hitter.metrics.batterVsPitcherOps)} OPS across ${hitter.metrics.batterVsPitcherPlateAppearances} plate appearances against this starter.`,
    );
  } else if (
    hitter.metrics.batterVsPitcherPlateAppearances >= 8 &&
    hitter.metrics.batterVsPitcherScore <= 40
  ) {
    reasons.push(
      `Prior meetings have been tougher, with a ${formatRate(hitter.metrics.batterVsPitcherOps)} OPS across ${hitter.metrics.batterVsPitcherPlateAppearances} plate appearances against this starter.`,
    );
  }

  if (
    hitter.metrics.pitchMixMatchupSample >= 8 &&
    hitter.metrics.pitchMixMatchupScore >= 58
  ) {
    reasons.push(
      `The pitch mix fits well here, especially against ${hitter.metrics.primaryPitchTypeDescription} usage (${formatPercent(hitter.metrics.primaryPitchUsage)}).`,
    );
  } else if (
    hitter.metrics.pitchMixMatchupSample >= 10 &&
    hitter.metrics.pitchMixMatchupScore <= 42
  ) {
    reasons.push(
      `The pitch mix is a little less comfortable here against a ${hitter.metrics.primaryPitchTypeDescription}-leaning arsenal.`,
    );
  }

  if (scores.homeRunUpsideScore >= 70) {
    reasons.push(
      `Home run ceiling is backed by ${formatPercent(hitter.metrics.hardHitRate)} hard-hit, ${formatPercent(hitter.metrics.barrelRate)} barrel, and ${hitter.metrics.averageExitVelocity.toFixed(1)} mph average exit velocity.`,
    );
  }

  if (hitter.metrics.averageBatSpeed >= 74.5 || hitter.metrics.blastRate >= 12) {
    reasons.push(
      `Bat-tracking supports the power path with ${hitter.metrics.averageBatSpeed.toFixed(1)} mph bat speed and ${formatPercent(hitter.metrics.blastRate)} blasts per contact.`,
    );
  }

  if (hitter.metrics.opponentPitcherPowerAllowed >= 8.5) {
    reasons.push(
      `The opposing pitcher has allowed damaging contact lately, which keeps the power path open.`,
    );
  }

  if (hitsProjection?.projectionLayer?.projectedPlateAppearances !== undefined) {
    reasons.push(
      `Expected plate appearances sit around ${Number(hitsProjection.projectionLayer.projectedPlateAppearances).toFixed(2)}, which supports the hit floor.`,
    );
  }

  if (totalBasesProjection?.overLineProbability !== undefined) {
    reasons.push(
      `Total-base outlook is supported by a ${(totalBasesProjection.overLineProbability * 100).toFixed(1)}% calibrated over probability.`,
    );
  }

  if (hitter.metrics.lineupSpot <= 4) {
    reasons.push(
      `Projected lineup spot ${hitter.metrics.lineupSpot} should support volume and RBI opportunities.`,
    );
  }

  if (hitter.metrics.homeRunParkFactorVsHandedness >= 106) {
    reasons.push(`The handedness-specific park context is favorable for this hitter's power shape tonight.`);
  }

  if (!hitter.metrics.lineupConfirmed) {
    reasons.push(`Lineup is not confirmed yet, so playing-time certainty is a little lower.`);
  }

  if (scores.riskScore >= 60) {
    reasons.push(
      `There is real swing-and-miss risk here with a ${formatPercent(hitter.metrics.strikeoutRate)} strikeout rate.`,
    );
  }

  return reasons.slice(0, 3);
};

export const rankHitters = (hitters: HitterCandidate[]): RankedHitter[] =>
  hitters
    .map((hitter) => {
      const scores = scoreHitter(hitter);

      return {
        ...hitter,
        scores,
        reasons: hitterReasons(hitter, scores),
      };
    })
    .sort((left, right) => right.scores.overallHitScore - left.scores.overallHitScore);
