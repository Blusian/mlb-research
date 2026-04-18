export const parseCliArgs = (argv: string[]): Record<string, string> =>
  argv.reduce<Record<string, string>>((parsed, argument) => {
    if (!argument.startsWith('--')) {
      return parsed;
    }

    const [rawKey = '', ...valueParts] = argument.slice(2).split('=');
    const key = rawKey.trim();

    if (!key) {
      return parsed;
    }

    parsed[key] = valueParts.length > 0 ? valueParts.join('=').trim() : 'true';
    return parsed;
  }, {});

export const listDateRange = (dateFrom: string, dateTo: string): string[] => {
  const dates: string[] = [];
  const current = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
};
