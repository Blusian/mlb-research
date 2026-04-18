import type { DailyDataProvider } from './types.js';
import { LiveMlbStatsApiProvider } from './live/mlbStatsApiProvider.js';
import { MockDailyDataProvider } from './mock/mockDataProvider.js';

export const createDailyDataProvider = (config: {
  dataProvider: 'mock' | 'live';
  mlbStatsApiBaseUrl: string;
  baseballSavantBaseUrl: string;
  fangraphsBaseUrl: string;
  openMeteoBaseUrl: string;
  timeoutMs: number;
  enableOpenMeteoWeather: boolean;
  enableFanGraphsSupport: boolean;
}): DailyDataProvider => {
  if (config.dataProvider === 'live') {
    return new LiveMlbStatsApiProvider(config);
  }

  return new MockDailyDataProvider();
};
