import type { RankedHitter } from '@mlb-analyzer/shared';

import { clamp } from '../providers/live/statsApiUtils.js';

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

const featureKeys = [
  'homeRunUpsideScore',
  'isoVsHandedness',
  'xslgVsHandedness',
  'barrelRate',
  'hardHitRate',
  'averageExitVelocity',
  'averageBatSpeed',
  'hardSwingRate',
  'squaredUpRate',
  'blastRate',
  'batTrackingRunValue',
  'homeRunParkFactorVsHandedness',
  'opponentPitcherPowerAllowed',
  'recentForm',
  'batterVsPitcherScore',
  'pitchMixMatchupScore',
  'lineupAdvantage',
] as const;

type HomeRunFeatureKey = (typeof featureKeys)[number];

export type HomeRunFeatureVector = Record<HomeRunFeatureKey, number>;

const featureFallbacks: HomeRunFeatureVector = {
  homeRunUpsideScore: 50,
  isoVsHandedness: 0.165,
  xslgVsHandedness: 0.405,
  barrelRate: 7,
  hardHitRate: 38,
  averageExitVelocity: 89,
  averageBatSpeed: 72,
  hardSwingRate: 18,
  squaredUpRate: 28,
  blastRate: 8,
  batTrackingRunValue: 0,
  homeRunParkFactorVsHandedness: 100,
  opponentPitcherPowerAllowed: 7,
  recentForm: 50,
  batterVsPitcherScore: 50,
  pitchMixMatchupScore: 50,
  lineupAdvantage: 0.35,
};

export interface HomeRunTrainingExample {
  analysisDate: string;
  playerId: string;
  gameId: string;
  features: HomeRunFeatureVector;
  outcome: 0 | 1;
}

export interface HomeRunModel {
  intercept: number;
  weights: Record<HomeRunFeatureKey, number>;
  means: Record<HomeRunFeatureKey, number>;
  scales: Record<HomeRunFeatureKey, number>;
  trainingSamples: number;
  positiveRate: number;
}

const finiteValue = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return fallback;
};

const lineupAdvantage = (hitter: RankedHitter): number => {
  const spot = finiteValue(hitter.metrics.lineupSpot, 6);

  if (spot <= 2) {
    return 1;
  }

  if (spot <= 4) {
    return 0.75;
  }

  if (spot <= 6) {
    return 0.35;
  }

  return 0;
};

export const buildHomeRunFeatureVector = (
  hitter: RankedHitter,
): HomeRunFeatureVector => ({
  homeRunUpsideScore: finiteValue(
    hitter.scores.homeRunUpsideScore,
    featureFallbacks.homeRunUpsideScore,
  ),
  isoVsHandedness: finiteValue(
    hitter.metrics.isoVsHandedness,
    featureFallbacks.isoVsHandedness,
  ),
  xslgVsHandedness: finiteValue(
    hitter.metrics.xslgVsHandedness,
    featureFallbacks.xslgVsHandedness,
  ),
  barrelRate: finiteValue(hitter.metrics.barrelRate, featureFallbacks.barrelRate),
  hardHitRate: finiteValue(hitter.metrics.hardHitRate, featureFallbacks.hardHitRate),
  averageExitVelocity: finiteValue(
    hitter.metrics.averageExitVelocity,
    featureFallbacks.averageExitVelocity,
  ),
  averageBatSpeed: finiteValue(
    hitter.metrics.averageBatSpeed,
    featureFallbacks.averageBatSpeed,
  ),
  hardSwingRate: finiteValue(
    hitter.metrics.hardSwingRate,
    featureFallbacks.hardSwingRate,
  ),
  squaredUpRate: finiteValue(
    hitter.metrics.squaredUpRate,
    featureFallbacks.squaredUpRate,
  ),
  blastRate: finiteValue(hitter.metrics.blastRate, featureFallbacks.blastRate),
  batTrackingRunValue: finiteValue(
    hitter.metrics.batTrackingRunValue,
    featureFallbacks.batTrackingRunValue,
  ),
  homeRunParkFactorVsHandedness: finiteValue(
    hitter.metrics.homeRunParkFactorVsHandedness,
    featureFallbacks.homeRunParkFactorVsHandedness,
  ),
  opponentPitcherPowerAllowed: finiteValue(
    hitter.metrics.opponentPitcherPowerAllowed,
    featureFallbacks.opponentPitcherPowerAllowed,
  ),
  recentForm: finiteValue(hitter.metrics.recentForm, featureFallbacks.recentForm),
  batterVsPitcherScore: finiteValue(
    hitter.metrics.batterVsPitcherScore,
    featureFallbacks.batterVsPitcherScore,
  ),
  pitchMixMatchupScore: finiteValue(
    hitter.metrics.pitchMixMatchupScore,
    featureFallbacks.pitchMixMatchupScore,
  ),
  lineupAdvantage: finiteValue(lineupAdvantage(hitter), featureFallbacks.lineupAdvantage),
});

const mean = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const standardDeviation = (values: number[], averageValue: number): number => {
  if (values.length <= 1) {
    return 1;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - averageValue) ** 2, 0) / values.length;

  return variance > 0 ? Math.sqrt(variance) : 1;
};

const standardizedFeature = (
  value: number,
  meanValue: number,
  scale: number,
): number => (value - meanValue) / scale;

export const trainHomeRunModel = (
  examples: HomeRunTrainingExample[],
): HomeRunModel | null => {
  if (examples.length < 40) {
    return null;
  }

  const positives = examples.filter((example) => example.outcome === 1).length;
  const negatives = examples.length - positives;

  if (positives < 8 || negatives < 8) {
    return null;
  }

  const means = {} as Record<HomeRunFeatureKey, number>;
  const scales = {} as Record<HomeRunFeatureKey, number>;

  featureKeys.forEach((key) => {
    const values = examples.map((example) => example.features[key]);
    const averageValue = mean(values);
    means[key] = averageValue;
    scales[key] = standardDeviation(values, averageValue);
  });

  const standardizedExamples = examples.map((example) => ({
    outcome: example.outcome,
    features: featureKeys.map((key) =>
      standardizedFeature(example.features[key], means[key], scales[key]),
    ),
  }));
  const positiveWeight = negatives / positives;
  let intercept = Math.log((positives + 1) / (negatives + 1));
  const weights = new Array(featureKeys.length).fill(0);
  const learningRate = 0.045;
  const regularization = 0.012;

  for (let epoch = 0; epoch < 650; epoch += 1) {
    let interceptGradient = 0;
    const weightGradients = new Array(featureKeys.length).fill(0);

    standardizedExamples.forEach((example) => {
      const linearScore = example.features.reduce(
        (sum, value, index) => sum + value * weights[index],
        intercept,
      );
      const probability = logistic(linearScore);
      const exampleWeight = example.outcome === 1 ? positiveWeight : 1;
      const error = (probability - example.outcome) * exampleWeight;

      interceptGradient += error;
      example.features.forEach((value, index) => {
        weightGradients[index] += error * value;
      });
    });

    intercept -= (learningRate * interceptGradient) / standardizedExamples.length;
    weights.forEach((weight, index) => {
      weights[index] =
        weight -
        learningRate *
          ((weightGradients[index] / standardizedExamples.length) +
            regularization * weight);
    });
  }

  return {
    intercept,
    weights: Object.fromEntries(
      featureKeys.map((key, index) => [key, weights[index] ?? 0]),
    ) as Record<HomeRunFeatureKey, number>,
    means,
    scales,
    trainingSamples: examples.length,
    positiveRate: positives / examples.length,
  };
};

export const predictHomeRunProbability = (
  hitter: RankedHitter,
  model: HomeRunModel,
): number => {
  const features = buildHomeRunFeatureVector(hitter);
  const linearScore = featureKeys.reduce((sum, key) => {
    const standardizedValue = standardizedFeature(
      features[key],
      model.means[key],
      model.scales[key],
    );

    return sum + standardizedValue * model.weights[key];
  }, model.intercept);

  return clamp(logistic(linearScore), 0.01, 0.6);
};
