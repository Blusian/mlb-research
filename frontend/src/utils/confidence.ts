type CardConfidence = 'elite' | 'core' | 'strong' | 'watch' | 'thin';

const confidenceLabels: Record<CardConfidence, string> = {
  elite: 'Elite',
  core: 'Core',
  strong: 'Strong',
  watch: 'Medium',
  thin: 'Low',
};

export const formatConfidenceLabel = (value?: string | null): string => {
  const normalized = String(value ?? '').toLowerCase() as CardConfidence;
  return confidenceLabels[normalized] ?? 'Unknown';
};

export const confidenceChipClass = (value?: string | null): string => {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'elite' || normalized === 'core' || normalized === 'strong') {
    return 'chip chip-confidence-good';
  }
  if (normalized === 'watch') {
    return 'chip chip-confidence-medium';
  }
  return 'chip chip-confidence-low';
};

export const formatTrendLabel = (value?: number | null): string => {
  if (value == null || Number.isNaN(value)) {
    return 'Trend --';
  }
  return `Trend ${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

export const trendChipClass = (value?: number | null): string => {
  if (value == null || Number.isNaN(value)) {
    return 'chip chip-muted';
  }
  if (value >= 6) {
    return 'chip chip-trend-up';
  }
  if (value <= -6) {
    return 'chip chip-trend-down';
  }
  return 'chip chip-trend-flat';
};
