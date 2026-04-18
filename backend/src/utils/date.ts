const phoenixFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Phoenix',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const getAnalysisDate = (requestedDate?: string): string =>
  requestedDate?.trim() ? requestedDate : phoenixFormatter.format(new Date());
