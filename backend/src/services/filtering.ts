import type {
  AttackablePitcher,
  DailyAnalysisQuery,
  GameInfo,
  RankedHitter,
  RankedPitcher,
} from '@mlb-analyzer/shared';

const matchesTeam = (teamFilter: string | undefined, teamCode: string, opponentCode: string): boolean => {
  if (!teamFilter) {
    return true;
  }

  return teamCode === teamFilter || opponentCode === teamFilter;
};

const matchesHandedness = (filter: DailyAnalysisQuery['handedness'], handedness: string): boolean =>
  !filter || filter === 'ALL' || filter === handedness;

const matchesMatchup = (
  matchupFilter: string | undefined,
  matchupId: string,
  matchupLabel: string,
): boolean => !matchupFilter || matchupId === matchupFilter || matchupLabel === matchupFilter;

export const filterGames = (games: GameInfo[], query: DailyAnalysisQuery): GameInfo[] =>
  games.filter(
    (game) =>
      matchesTeam(query.team, game.homeTeam.abbreviation, game.awayTeam.abbreviation) &&
      matchesMatchup(query.matchup, game.matchupId, game.matchupLabel),
  );

export const filterHitters = (hitters: RankedHitter[], query: DailyAnalysisQuery): RankedHitter[] =>
  hitters.filter(
    (hitter) =>
      matchesTeam(query.team, hitter.team.abbreviation, hitter.opponent.abbreviation) &&
      matchesMatchup(query.matchup, hitter.matchupId, hitter.matchupLabel) &&
      matchesHandedness(query.handedness, hitter.bats),
  );

export const filterPitchers = <
  T extends RankedPitcher | AttackablePitcher,
>(
  pitchers: T[],
  query: DailyAnalysisQuery,
): T[] =>
  pitchers.filter(
    (pitcher) =>
      matchesTeam(query.team, pitcher.team.abbreviation, pitcher.opponent.abbreviation) &&
      matchesMatchup(query.matchup, pitcher.matchupId, pitcher.matchupLabel) &&
      matchesHandedness(query.handedness, pitcher.throwingHand),
  );
