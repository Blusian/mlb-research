export const formatHandedness = (value?: string | null): string => {
  if (!value) {
    return '--';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'L') {
    return 'Left';
  }
  if (normalized === 'R') {
    return 'Right';
  }
  if (normalized === 'S') {
    return 'Switch';
  }

  return value;
};
