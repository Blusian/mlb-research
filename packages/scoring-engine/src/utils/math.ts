export const clampScore = (value: number): number =>
  Math.max(0, Math.min(100, Number(value.toFixed(1))));

export const scaleToScore = (value: number, min: number, max: number): number => {
  if (max === min) {
    return 50;
  }

  const ratio = ((value - min) / (max - min)) * 100;
  return clampScore(ratio);
};

export const inverseScaleToScore = (value: number, min: number, max: number): number =>
  clampScore(100 - scaleToScore(value, min, max));

export const weightedAverage = (entries: Array<[number, number]>): number => {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalWeight === 0) {
    return 0;
  }

  const total = entries.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return clampScore(total / totalWeight);
};

export const lineupSpotScore = (spot: number): number => {
  const scoreMap = new Map<number, number>([
    [1, 100],
    [2, 95],
    [3, 92],
    [4, 90],
    [5, 82],
    [6, 74],
    [7, 66],
    [8, 58],
    [9, 52],
  ]);

  return scoreMap.get(spot) ?? 55;
};

export const formatPercent = (value: number, digits = 1): string => `${value.toFixed(digits)}%`;

export const formatRate = (value: number, digits = 3): string => value.toFixed(digits);
