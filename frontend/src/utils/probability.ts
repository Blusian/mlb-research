export type ProbabilityTone =
  | 'probability-strong'
  | 'probability-medium'
  | 'probability-watch'
  | 'probability-low'
  | 'probability-unknown';

export const formatProbability = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : '--';

export const getProbabilityTone = (
  value: number | null | undefined,
): ProbabilityTone => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'probability-unknown';
  }

  if (value >= 0.3) {
    return 'probability-strong';
  }

  if (value >= 0.18) {
    return 'probability-medium';
  }

  if (value >= 0.1) {
    return 'probability-watch';
  }

  return 'probability-low';
};
