export const toFiniteNumber = (
  value: number | null | undefined,
  fallback: number | null = null,
): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return fallback;
};

export const hasPositiveNumber = (value: number | null | undefined): boolean =>
  (toFiniteNumber(value, 0) ?? 0) > 0;

export const formatNumber = (
  value: number | null | undefined,
  digits = 1,
  suffix = '',
): string => {
  const numeric = toFiniteNumber(value);

  if (numeric === null) {
    return '--';
  }

  return `${numeric.toFixed(digits)}${suffix}`;
};

export const formatPercent = (value: number | null | undefined, digits = 1): string =>
  formatNumber(value, digits, '%');
