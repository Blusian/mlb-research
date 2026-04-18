import { parseInningsPitched, parseNumber } from '../providers/live/statsApiUtils.js';
import type {
  MlbFeedPlayer,
  MlbFeedResponse,
  MlbScheduleGame,
  MlbStatsApiSource,
} from '../sources/mlbStatsApiSource.js';
import type {
  ResolvedDailyResults,
  ResolvedGameResult,
  ResolvedHitterResult,
  ResolvedPitcherResult,
} from './types.js';

const isFinalGame = (game: MlbScheduleGame): boolean =>
  game.status?.abstractGameState?.toLowerCase() === 'final';

const matchupLabel = (game: MlbScheduleGame): string => {
  const away = game.teams?.away?.team?.abbreviation ?? 'AWAY';
  const home = game.teams?.home?.team?.abbreviation ?? 'HOME';
  return `${away} @ ${home}`;
};

const countPlateAppearances = (batting: Record<string, unknown>): number => {
  const providedPlateAppearances = parseNumber(
    batting.plateAppearances ?? batting.plate_appearances,
  );

  if (providedPlateAppearances > 0) {
    return providedPlateAppearances;
  }

  return (
    parseNumber(batting.atBats) +
    parseNumber(batting.baseOnBalls) +
    parseNumber(batting.hitByPitch) +
    parseNumber(batting.sacFlies) +
    parseNumber(batting.sacBunts)
  );
};

const hasBattingOutcome = (player: MlbFeedPlayer): boolean => {
  const batting = player.stats?.batting;

  if (!batting) {
    return false;
  }

  return [
    batting.atBats,
    batting.hits,
    batting.homeRuns,
    batting.strikeOuts,
    batting.baseOnBalls,
  ].some((value) => parseNumber(value) > 0);
};

const hasPitchingOutcome = (player: MlbFeedPlayer): boolean => {
  const pitching = player.stats?.pitching;

  if (!pitching) {
    return false;
  }

  return (
    parseInningsPitched(pitching.inningsPitched) > 0 ||
    parseNumber(pitching.strikeOuts) > 0 ||
    parseNumber(pitching.numberOfPitches) > 0
  );
};

const resolveGameResult = (
  analysisDate: string,
  game: MlbScheduleGame,
  feed: MlbFeedResponse,
): ResolvedGameResult => {
  const awayTeamAbbreviation = game.teams?.away?.team?.abbreviation ?? 'AWAY';
  const homeTeamAbbreviation = game.teams?.home?.team?.abbreviation ?? 'HOME';
  const awayRuns = parseNumber(
    feed.liveData?.linescore?.teams?.away?.runs ??
      feed.liveData?.boxscore?.teams?.away?.teamStats?.batting?.runs,
  );
  const homeRuns = parseNumber(
    feed.liveData?.linescore?.teams?.home?.runs ??
      feed.liveData?.boxscore?.teams?.home?.teamStats?.batting?.runs,
  );

  return {
    analysisDate,
    gameId: String(game.gamePk),
    matchupId: `${awayTeamAbbreviation}@${homeTeamAbbreviation}`,
    matchupLabel: matchupLabel(game),
    awayTeamAbbreviation,
    homeTeamAbbreviation,
    awayRuns,
    homeRuns,
    totalRuns: awayRuns + homeRuns,
    homeWon: homeRuns > awayRuns,
  };
};

const collectHitterResults = (
  analysisDate: string,
  gameId: string,
  teamAbbreviation: string,
  players: Record<string, MlbFeedPlayer>,
): ResolvedHitterResult[] =>
  Object.values(players)
    .filter(hasBattingOutcome)
    .map((player) => {
      const batting = player.stats?.batting ?? {};

      return {
        analysisDate,
        gameId,
        playerId: String(player.person?.id ?? 'unknown'),
        playerName: player.person?.fullName ?? 'Unknown Player',
        teamAbbreviation,
        homeRuns: parseNumber(batting.homeRuns),
        hits: parseNumber(batting.hits),
        walks: parseNumber(batting.baseOnBalls),
        strikeouts: parseNumber(batting.strikeOuts),
        atBats: parseNumber(batting.atBats),
        plateAppearances: countPlateAppearances(batting),
      };
    });

const collectPitcherResults = (
  analysisDate: string,
  gameId: string,
  teamAbbreviation: string,
  winnerPitcherId: string,
  players: Record<string, MlbFeedPlayer>,
): ResolvedPitcherResult[] =>
  Object.values(players)
    .filter(hasPitchingOutcome)
    .map((player) => {
      const pitching = player.stats?.pitching ?? {};
      const playerId = String(player.person?.id ?? 'unknown');

      return {
        analysisDate,
        gameId,
        playerId,
        playerName: player.person?.fullName ?? 'Unknown Player',
        teamAbbreviation,
        strikeouts: parseNumber(pitching.strikeOuts),
        walks: parseNumber(pitching.baseOnBalls),
        earnedRuns: parseNumber(pitching.earnedRuns),
        hitsAllowed: parseNumber(pitching.hits),
        inningsPitched: parseInningsPitched(pitching.inningsPitched),
        wonGame: winnerPitcherId.length > 0 && playerId === winnerPitcherId,
      };
    });

export const buildResolvedDailyResults = async (
  analysisDate: string,
  mlbStatsApi: MlbStatsApiSource,
): Promise<ResolvedDailyResults> => {
  const scheduledGames = await mlbStatsApi.getSchedule(analysisDate);
  const finalGames = scheduledGames.filter(isFinalGame);
  const feeds = await Promise.all(
    finalGames.map((game) => mlbStatsApi.getGameFeed(game.gamePk)),
  );
  const games: ResolvedGameResult[] = [];
  const hitters: ResolvedHitterResult[] = [];
  const pitchers: ResolvedPitcherResult[] = [];
  const notes: string[] = [];

  finalGames.forEach((game, index) => {
    const feed = feeds[index];

    if (!feed) {
      notes.push(`Live feed was unavailable for game ${game.gamePk}.`);
      return;
    }

    const gameId = String(game.gamePk);
    const winnerPitcherId = String(feed.liveData?.decisions?.winner?.id ?? '');
    const awayTeamAbbreviation = game.teams?.away?.team?.abbreviation ?? 'AWAY';
    const homeTeamAbbreviation = game.teams?.home?.team?.abbreviation ?? 'HOME';
    const awayPlayers = feed.liveData?.boxscore?.teams?.away?.players ?? {};
    const homePlayers = feed.liveData?.boxscore?.teams?.home?.players ?? {};

    games.push(resolveGameResult(analysisDate, game, feed));
    hitters.push(
      ...collectHitterResults(
        analysisDate,
        gameId,
        awayTeamAbbreviation,
        awayPlayers,
      ),
      ...collectHitterResults(
        analysisDate,
        gameId,
        homeTeamAbbreviation,
        homePlayers,
      ),
    );
    pitchers.push(
      ...collectPitcherResults(
        analysisDate,
        gameId,
        awayTeamAbbreviation,
        winnerPitcherId,
        awayPlayers,
      ),
      ...collectPitcherResults(
        analysisDate,
        gameId,
        homeTeamAbbreviation,
        winnerPitcherId,
        homePlayers,
      ),
    );
  });

  if (finalGames.length === 0) {
    notes.push(`No final MLB games were available for ${analysisDate}.`);
  }

  return {
    analysisDate,
    capturedAt: new Date().toISOString(),
    source: 'mlb_stats_api',
    notes,
    games,
    hitters,
    pitchers,
  };
};
