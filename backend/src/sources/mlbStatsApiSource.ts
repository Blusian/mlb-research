import { chunk } from '../providers/live/statsApiUtils.js';
import { fetchJson } from './http.js';

export interface MlbApiTeam {
  id?: number;
  name?: string;
  abbreviation?: string;
  locationName?: string;
  teamName?: string;
}

export interface MlbScheduleProbablePitcher {
  id?: number;
  fullName?: string;
  link?: string;
  pitchHand?: { code?: string };
}

export interface MlbScheduleGame {
  gamePk: number;
  gameDate?: string;
  status?: { abstractGameState?: string };
  teams?: {
    away?: { team?: MlbApiTeam; probablePitcher?: MlbScheduleProbablePitcher };
    home?: { team?: MlbApiTeam; probablePitcher?: MlbScheduleProbablePitcher };
  };
  venue?: { name?: string; location?: { city?: string } };
}

export interface MlbScheduleResponse {
  dates?: Array<{
    games?: MlbScheduleGame[];
  }>;
}

export interface MlbFeedPlayer {
  person?: { id?: number; fullName?: string };
  batSide?: { code?: string };
  position?: { abbreviation?: string };
  stats?: {
    batting?: Record<string, unknown>;
    pitching?: Record<string, unknown>;
  };
}

interface MlbFeedTeamBoxscore {
  battingOrder?: number[];
  players?: Record<string, MlbFeedPlayer>;
  teamStats?: {
    batting?: Record<string, unknown>;
    pitching?: Record<string, unknown>;
  };
}

export interface MlbFeedResponse {
  gamePk?: number;
  gameData?: {
    weather?: {
      condition?: string;
      temp?: string;
      wind?: string;
    };
  };
  liveData?: {
    linescore?: {
      teams?: {
        away?: { runs?: number };
        home?: { runs?: number };
      };
    };
    decisions?: {
      winner?: { id?: number; fullName?: string };
      loser?: { id?: number; fullName?: string };
    };
    boxscore?: {
      officials?: Array<{
        official?: { id?: number; fullName?: string };
        officialType?: string;
      }>;
      teams?: {
        away?: MlbFeedTeamBoxscore;
        home?: MlbFeedTeamBoxscore;
      };
    };
  };
}

export interface MlbApiStatBlock {
  type?: { displayName?: string };
  splits?: MlbApiStatSplit[];
}

export interface MlbApiStatSplit {
  split?: { code?: string };
  date?: string;
  stat?: Record<string, unknown>;
}

export interface MlbApiPerson {
  id?: number;
  fullName?: string;
  batSide?: { code?: string };
  pitchHand?: { code?: string };
  stats?: MlbApiStatBlock[];
}

interface MlbPeopleResponse {
  people?: MlbApiPerson[];
}

export class MlbStatsApiSource {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async getSchedule(date: string): Promise<MlbScheduleGame[]> {
    const schedule = await fetchJson<MlbScheduleResponse>(
      `${this.baseUrl}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue`,
      this.timeoutMs,
    );

    return schedule.dates?.[0]?.games ?? [];
  }

  public async getGameFeed(gamePk: number): Promise<MlbFeedResponse | null> {
    try {
      return await fetchJson<MlbFeedResponse>(
        `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
        this.timeoutMs,
      );
    } catch {
      return null;
    }
  }

  public async getPeopleStats(
    personIds: string[],
    group: 'hitting' | 'pitching',
    season: string,
  ): Promise<Map<string, MlbApiPerson>> {
    const people = await this.getHydratedPeople(
      personIds,
      `stats(group=[${group}],type=[season,statSplits,gameLog],sitCodes=[vr,vl],season=${season})`,
    );

    return new Map(
      people
        .filter(
          (person): person is MlbApiPerson & { id: number } =>
            typeof person.id === 'number',
        )
        .map((person) => [String(person.id), person]),
    );
  }

  public async getPitchArsenalStats(
    personIds: string[],
    season: string,
  ): Promise<Map<string, MlbApiStatSplit[]>> {
    const people = await this.getHydratedPeople(
      personIds,
      `stats(group=[pitching],type=[pitchArsenal],season=${season})`,
    );

    return new Map(
      people
        .filter(
          (person): person is MlbApiPerson & { id: number } =>
            typeof person.id === 'number',
        )
        .map((person) => [
          String(person.id),
          this.getStatSplits(person, 'pitchArsenal'),
        ]),
    );
  }

  public async getPlayLogStats(
    personIds: string[],
    group: 'hitting' | 'pitching',
    season: string,
    limit: number,
  ): Promise<Map<string, MlbApiStatSplit[]>> {
    const people = await this.getHydratedPeople(
      personIds,
      `stats(group=[${group}],type=[playLog],season=${season},limit=${limit})`,
    );

    return new Map(
      people
        .filter(
          (person): person is MlbApiPerson & { id: number } =>
            typeof person.id === 'number',
        )
        .map((person) => [String(person.id), this.getStatSplits(person, 'playLog')]),
    );
  }

  public async getVsPlayerTotalStats(
    matchupGroups: Array<{ opposingPlayerId: string; personIds: string[] }>,
  ): Promise<Map<string, MlbApiStatSplit>> {
    const responses = await Promise.all(
      matchupGroups.flatMap(({ opposingPlayerId, personIds }) =>
        chunk(personIds, 25).map(async (personIdChunk) => {
          const people = await this.getHydratedPeople(
            personIdChunk,
            `stats(group=[hitting],type=[vsPlayerTotal],opposingPlayerId=${opposingPlayerId})`,
          );

          return people
            .filter(
              (person): person is MlbApiPerson & { id: number } =>
                typeof person.id === 'number',
            )
            .flatMap((person) => {
              const split = this.getStatSplits(person, 'vsPlayerTotal')[0];

              if (!split) {
                return [];
              }

              return [[`${person.id}:${opposingPlayerId}`, split] as const];
            });
        }),
      ),
    );

    return new Map(responses.flat());
  }

  private async getHydratedPeople(
    personIds: string[],
    hydrateExpression: string,
  ): Promise<MlbApiPerson[]> {
    if (personIds.length === 0) {
      return [];
    }

    const peopleResponses = await Promise.all(
      chunk(personIds, 25).map((personIdChunk) =>
        fetchJson<MlbPeopleResponse>(
          `${this.baseUrl}/people?personIds=${personIdChunk.join(',')}&hydrate=${hydrateExpression}`,
          this.timeoutMs,
        ),
      ),
    );

    return peopleResponses.flatMap((response) => response.people ?? []);
  }

  private getStatSplits(
    person: MlbApiPerson,
    displayName: string,
  ): MlbApiStatSplit[] {
    return (
      person.stats?.find((statBlock) => statBlock.type?.displayName === displayName)
        ?.splits ?? []
    );
  }
}
