import type { RawGame } from '../providers/types.js';
import { fetchText } from './http.js';

export class FanGraphsSupportSource {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async getSupportNotes(games: RawGame[]): Promise<string[]> {
    const notes: string[] = [];

    try {
      const rosterResourceHtml = await fetchText(
        `${this.baseUrl}/roster-resource/probables-grid`,
        this.timeoutMs,
      );
      const rosterResourceText = rosterResourceHtml.toLowerCase();
      const probablePitcherNames = games
        .flatMap((game) => [game.probablePitchers.away?.name, game.probablePitchers.home?.name])
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      const matchedPitchers = probablePitcherNames.filter((name) =>
        rosterResourceText.includes(name.toLowerCase()),
      );

      if (probablePitcherNames.length > 0) {
        notes.push(
          `FanGraphs RosterResource matched ${matchedPitchers.length} of ${probablePitcherNames.length} probable pitcher names for support validation.`,
        );
      }
    } catch {
      notes.push('FanGraphs RosterResource support source was unavailable for this refresh.');
    }

    try {
      await fetchText(`${this.baseUrl}/leaders/splits-leaderboards`, this.timeoutMs);
      notes.push('FanGraphs splits support source is reachable for deeper split context if needed.');
    } catch {
      notes.push('FanGraphs splits support source was unavailable for this refresh.');
    }

    return notes;
  }
}
