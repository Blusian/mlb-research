import type { DailyPropBoards } from '@mlb-analyzer/shared';

export const createEmptyPropBoards = (): DailyPropBoards => ({
  hitterHomeRuns: [],
  hitterHits: [],
  hitterRuns: [],
  hitterRbis: [],
  hitterTotalBases: [],
  hitterWalks: [],
  pitcherStrikeouts: [],
  pitcherWalks: [],
  pitcherOuts: [],
});
