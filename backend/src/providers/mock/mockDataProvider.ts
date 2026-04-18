import type { DailyDataProvider, RawDailySlate } from '../types.js';

import { createMockDailySlate } from './mockDailySlate.js';

export class MockDailyDataProvider implements DailyDataProvider {
  public readonly name = 'mock';

  public async getDailySlate(date: string): Promise<RawDailySlate> {
    return createMockDailySlate(date);
  }
}
