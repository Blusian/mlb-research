import type { PlayerRole } from '@mlb-analyzer/shared';

export interface PlayerDetailSelection {
  playerId: string;
  role: PlayerRole;
  gameId: string;
  date: string;
}
