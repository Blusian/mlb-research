import type {
  Handedness,
  LineupEntry,
  OfficialInfo,
  TeamInfo,
  WeatherInfo,
} from '@mlb-analyzer/shared';

import type {
  DailyDataProvider,
  RawDailySlate,
  RawGame,
  RawHitterCandidate,
  RawPitcherCandidate,
} from '../types.js';
import { createMockDailySlate } from '../mock/mockDailySlate.js';
import {
  average,
  clamp,
  inverseScaleToScore,
  parseDecimal,
  parseInningsPitched,
  parseNumber,
  parkFactorsByHomeTeam,
  resolveHandednessParkFactors,
  type ParkEventFactors,
  scaleToScore,
} from './statsApiUtils.js';
import {
  BaseballSavantSource,
  type SavantBatTrackingProfile,
  type SavantHitterProfile,
  type SavantPitcherProfile,
  type SavantStatRow,
} from '../../sources/baseballSavantSource.js';
import { FanGraphsSupportSource } from '../../sources/fanGraphsSupportSource.js';
import {
  MlbStatsApiSource,
  type MlbApiPerson,
  type MlbApiStatBlock,
  type MlbApiStatSplit,
  type MlbApiTeam,
  type MlbFeedResponse,
  type MlbScheduleProbablePitcher,
} from '../../sources/mlbStatsApiSource.js';
import { OpenMeteoSource } from '../../sources/openMeteoSource.js';

interface LivePitcherProfile {
  playerId: string;
  throwingHand: Handedness;
  contactAllowed: number;
  powerAllowed: number;
  xwobaAllowed: number;
  xbaAllowed: number;
  xslgAllowed: number;
  averageExitVelocityAllowed: number;
  strikeoutRate: number;
  walkRate: number;
  swingMissRate: number;
}

interface PitchArsenalEntry {
  code: string;
  description: string;
  usage: number;
  averageSpeed: number;
  count: number;
}

interface BatterVsPitcherHistory {
  plateAppearances: number;
  ops: number;
  homeRuns: number;
  strikeoutRate: number;
  score: number;
}

interface PitchTypePlateAppearanceStats {
  code: string;
  description: string;
  plateAppearances: number;
  atBats: number;
  hits: number;
  totalBases: number;
  walks: number;
  hitByPitch: number;
  strikeouts: number;
  homeRuns: number;
  score: number;
}

interface PitchMixMatchup {
  score: number;
  sample: number;
  primaryPitchTypeCode: string;
  primaryPitchTypeDescription: string;
  primaryPitchUsage: number;
  secondaryPitchTypeCode: string;
  secondaryPitchTypeDescription: string;
  secondaryPitchUsage: number;
}

const HITTER_PLAY_LOG_LIMIT = 140;

const weightedScore = (entries: Array<[number, number]>): number => {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalWeight === 0) {
    return 50;
  }

  return clamp(
    entries.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight,
    0,
    100,
  );
};

const sampleAdjustedScore = (
  rawScore: number,
  sample: number,
  fullConfidenceAt: number,
): number =>
  clamp(
    50 + (rawScore - 50) * clamp(sample / fullConfidenceAt, 0.15, 1),
    0,
    100,
  );

const buildMatchupGroups = (
  games: RawGame[],
): Array<{ opposingPlayerId: string; personIds: string[] }> => {
  const groups = new Map<string, Set<string>>();

  games.forEach((game) => {
    const homePitcherId = game.probablePitchers.home?.playerId;
    const awayPitcherId = game.probablePitchers.away?.playerId;

    if (homePitcherId) {
      const current = groups.get(homePitcherId) ?? new Set<string>();
      game.lineups.away.forEach((entry) => current.add(entry.playerId));
      groups.set(homePitcherId, current);
    }

    if (awayPitcherId) {
      const current = groups.get(awayPitcherId) ?? new Set<string>();
      game.lineups.home.forEach((entry) => current.add(entry.playerId));
      groups.set(awayPitcherId, current);
    }
  });

  return Array.from(groups.entries()).map(([opposingPlayerId, personIds]) => ({
    opposingPlayerId,
    personIds: Array.from(personIds),
  }));
};

const totalBasesForEvent = (eventType: string, isBaseHit: boolean): number => {
  switch (eventType) {
    case 'home_run':
      return 4;
    case 'triple':
      return 3;
    case 'double':
      return 2;
    case 'single':
      return 1;
    default:
      return isBaseHit ? 1 : 0;
  }
};

const buildBatterVsPitcherHistory = (
  split: MlbApiStatSplit | undefined,
): BatterVsPitcherHistory => {
  const stat = split?.stat ?? {};
  const plateAppearances = parseNumber(stat.plateAppearances, 0);
  const ops = parseDecimal(stat.ops, 0.72);
  const homeRuns = parseNumber(stat.homeRuns, 0);
  const strikeouts = parseNumber(stat.strikeOuts, 0);
  const strikeoutRate =
    plateAppearances > 0 ? (strikeouts / plateAppearances) * 100 : 22;
  const rawScore = weightedScore([
    [scaleToScore(ops, 0.55, 1.15), 0.5],
    [scaleToScore(plateAppearances > 0 ? homeRuns / plateAppearances : 0, 0, 0.12), 0.2],
    [inverseScaleToScore(strikeoutRate, 12, 42), 0.3],
  ]);

  return {
    plateAppearances,
    ops,
    homeRuns,
    strikeoutRate,
    score: sampleAdjustedScore(rawScore, plateAppearances, 18),
  };
};

const toPitchArsenal = (splits: MlbApiStatSplit[] | undefined): PitchArsenalEntry[] =>
  (splits ?? [])
    .map((split) => {
      const stat = split.stat ?? {};
      const type = (stat.type ?? {}) as { code?: string; description?: string };
      const code = type.code ?? 'UNK';

      return {
        code,
        description: type.description ?? code,
        usage: parseNumber(stat.percentage, 0),
        averageSpeed: parseNumber(stat.averageSpeed, 0),
        count: parseNumber(stat.count, 0),
      } satisfies PitchArsenalEntry;
    })
    .filter((pitch) => pitch.usage > 0)
    .sort((left, right) => right.usage - left.usage);

const scorePitchTypePlateAppearances = (
  stats: Omit<PitchTypePlateAppearanceStats, 'score'>,
): number => {
  const obp =
    stats.plateAppearances > 0
      ? (stats.hits + stats.walks + stats.hitByPitch) / stats.plateAppearances
      : 0.32;
  const slg = stats.atBats > 0 ? stats.totalBases / stats.atBats : 0.405;
  const hrRate =
    stats.plateAppearances > 0 ? stats.homeRuns / stats.plateAppearances : 0;
  const strikeoutRate =
    stats.plateAppearances > 0 ? (stats.strikeouts / stats.plateAppearances) * 100 : 22;
  const rawScore = weightedScore([
    [scaleToScore(obp, 0.24, 0.44), 0.35],
    [scaleToScore(slg, 0.28, 0.8), 0.35],
    [scaleToScore(hrRate, 0, 0.12), 0.15],
    [inverseScaleToScore(strikeoutRate, 12, 42), 0.15],
  ]);

  return sampleAdjustedScore(rawScore, stats.plateAppearances, 20);
};

const buildPitchTypePerformanceMap = (
  splits: MlbApiStatSplit[] | undefined,
  pitcherHand: Handedness,
): Map<string, PitchTypePlateAppearanceStats> => {
  const performance = new Map<string, Omit<PitchTypePlateAppearanceStats, 'score'>>();

  (splits ?? []).forEach((split) => {
    const play = (split.stat?.play ?? {}) as {
      details?: {
        eventType?: string;
        isPlateAppearance?: boolean;
        isAtBat?: boolean;
        isBaseHit?: boolean;
        type?: { code?: string; description?: string };
        pitchHand?: { code?: string };
      };
    };
    const details = play.details;

    if (!details?.isPlateAppearance) {
      return;
    }

    const observedPitchHand = safeHandedness(details.pitchHand?.code);

    if (
      pitcherHand !== 'U' &&
      observedPitchHand !== 'U' &&
      observedPitchHand !== pitcherHand
    ) {
      return;
    }

    const pitchTypeCode = details.type?.code ?? 'UNK';
    const eventType = (details.eventType ?? '').toLowerCase();
    const current = performance.get(pitchTypeCode) ?? {
      code: pitchTypeCode,
      description: details.type?.description ?? pitchTypeCode,
      plateAppearances: 0,
      atBats: 0,
      hits: 0,
      totalBases: 0,
      walks: 0,
      hitByPitch: 0,
      strikeouts: 0,
      homeRuns: 0,
    };

    current.plateAppearances += 1;

    if (details.isAtBat) {
      current.atBats += 1;
    }

    if (details.isBaseHit) {
      current.hits += 1;
    }

    current.totalBases += totalBasesForEvent(eventType, Boolean(details.isBaseHit));

    if (eventType.includes('walk')) {
      current.walks += 1;
    }

    if (eventType === 'hit_by_pitch') {
      current.hitByPitch += 1;
    }

    if (eventType.includes('strikeout')) {
      current.strikeouts += 1;
    }

    if (eventType === 'home_run') {
      current.homeRuns += 1;
    }

    performance.set(pitchTypeCode, current);
  });

  return new Map(
    Array.from(performance.entries()).map(([code, stats]) => [
      code,
      {
        ...stats,
        score: scorePitchTypePlateAppearances(stats),
      } satisfies PitchTypePlateAppearanceStats,
    ]),
  );
};

const buildPitchMixMatchup = (
  arsenal: PitchArsenalEntry[] | undefined,
  performanceByPitchType: Map<string, PitchTypePlateAppearanceStats>,
): PitchMixMatchup => {
  const topPitches = (arsenal ?? []).slice(0, 4);
  const primaryPitch = topPitches[0];
  const secondaryPitch = topPitches[1];

  if (topPitches.length === 0) {
    return {
      score: 50,
      sample: 0,
      primaryPitchTypeCode: 'UNK',
      primaryPitchTypeDescription: 'Unknown',
      primaryPitchUsage: 0,
      secondaryPitchTypeCode: 'UNK',
      secondaryPitchTypeDescription: 'Unknown',
      secondaryPitchUsage: 0,
    };
  }

  const weightedEntries = topPitches.map((pitch) => [
    performanceByPitchType.get(pitch.code)?.score ?? 50,
    pitch.usage,
  ] as [number, number]);
  const sample = topPitches.reduce(
    (sum, pitch) =>
      sum + (performanceByPitchType.get(pitch.code)?.plateAppearances ?? 0) * pitch.usage,
    0,
  );
  const rawScore = weightedScore(weightedEntries);

  return {
    score: sampleAdjustedScore(rawScore, sample, 18),
    sample: Number(sample.toFixed(1)),
    primaryPitchTypeCode: primaryPitch?.code ?? 'UNK',
    primaryPitchTypeDescription: primaryPitch?.description ?? 'Unknown',
    primaryPitchUsage: Number(((primaryPitch?.usage ?? 0) * 100).toFixed(1)),
    secondaryPitchTypeCode: secondaryPitch?.code ?? 'UNK',
    secondaryPitchTypeDescription: secondaryPitch?.description ?? 'Unknown',
    secondaryPitchUsage: Number(((secondaryPitch?.usage ?? 0) * 100).toFixed(1)),
  };
};

const safeHandedness = (value: string | undefined): Handedness => {
  if (value === 'R' || value === 'L' || value === 'S') {
    return value;
  }

  return 'U';
};

const buildTeamInfo = (team: MlbApiTeam | undefined): TeamInfo => ({
  id: String(team?.id ?? 'unknown'),
  city:
    team?.locationName ??
    team?.name?.split(' ').slice(0, -1).join(' ') ??
    'Unknown',
  name: team?.teamName ?? team?.name ?? 'Unknown Team',
  abbreviation: team?.abbreviation ?? 'TBD',
});

const buildScheduleProbablePitcherInfo = (
  probablePitcher: MlbScheduleProbablePitcher | undefined,
): RawGame['probablePitchers']['away'] | undefined => {
  if (!probablePitcher?.id && !probablePitcher?.fullName) {
    return undefined;
  }

  return {
    playerId: String(probablePitcher.id ?? ''),
    name: probablePitcher.fullName ?? 'TBD',
    throwingHand: safeHandedness(probablePitcher.pitchHand?.code),
  };
};

const hydrateProbablePitcherInfo = (
  probablePitcher: RawGame['probablePitchers']['away'] | undefined,
  pitcher: MlbApiPerson | undefined,
): RawGame['probablePitchers']['away'] | undefined => {
  if (!probablePitcher) {
    return undefined;
  }

  return {
    ...probablePitcher,
    playerId: probablePitcher.playerId || String(pitcher?.id ?? ''),
    name: pitcher?.fullName ?? probablePitcher.name,
    throwingHand: safeHandedness(
      pitcher?.pitchHand?.code ?? probablePitcher.throwingHand,
    ),
  };
};

const buildGameStatus = (state: string | undefined): RawGame['status'] => {
  const lowered = state?.toLowerCase();

  if (lowered === 'final') {
    return 'final';
  }

  if (lowered === 'live') {
    return 'in_progress';
  }

  return 'scheduled';
};

const buildWeatherFromFeed = (
  feed: MlbFeedResponse | null | undefined,
): WeatherInfo | undefined => {
  const weather = feed?.gameData?.weather;

  if (!weather?.condition && !weather?.temp && !weather?.wind) {
    return undefined;
  }

  return {
    condition: weather.condition ?? 'Conditions unavailable',
    temperatureF: weather.temp ? Number.parseInt(weather.temp, 10) : undefined,
    wind: weather.wind,
  };
};

const mergeWeather = (
  primary: WeatherInfo | undefined,
  fallback: WeatherInfo | undefined,
): WeatherInfo | undefined => {
  if (!primary) {
    return fallback;
  }

  return {
    condition: primary.condition || fallback?.condition || 'Conditions unavailable',
    temperatureF: primary.temperatureF ?? fallback?.temperatureF,
    wind: primary.wind ?? fallback?.wind,
    precipitationProbability:
      primary.precipitationProbability ?? fallback?.precipitationProbability,
  };
};

const buildOfficials = (feed: MlbFeedResponse | null | undefined): OfficialInfo[] =>
  (feed?.liveData?.boxscore?.officials ?? [])
    .filter((official) => official.official?.fullName && official.officialType)
    .map((official) => ({
      type: official.officialType ?? 'Unknown',
      name: official.official?.fullName ?? 'Unknown',
      id: official.official?.id ? String(official.official.id) : undefined,
    }));

const extractLineup = (
  feed: MlbFeedResponse | null | undefined,
  side: 'away' | 'home',
): LineupEntry[] => {
  const teamBoxscore = feed?.liveData?.boxscore?.teams?.[side];
  const battingOrder = teamBoxscore?.battingOrder ?? [];
  const players = teamBoxscore?.players ?? {};
  const status: LineupEntry['status'] =
    battingOrder.length >= 9 ? 'confirmed' : 'projected';
  const lineup: LineupEntry[] = [];

  battingOrder.forEach((playerId, index) => {
    const player = players[`ID${playerId}`];

    if (!player?.person?.fullName) {
      return;
    }

    lineup.push({
      playerId: String(player.person.id ?? playerId),
      playerName: player.person.fullName,
      battingOrder: index + 1,
      bats: safeHandedness(player.batSide?.code),
      position: player.position?.abbreviation,
      status,
    });
  });

  return lineup;
};

const buildLineupStatus = (
  awayLineup: LineupEntry[],
  homeLineup: LineupEntry[],
): RawGame['lineupStatus'] => {
  if (awayLineup.length >= 9 && homeLineup.length >= 9) {
    return 'confirmed';
  }

  if (awayLineup.length > 0 || homeLineup.length > 0) {
    return 'partial';
  }

  return 'projected';
};

const getStatBlock = (
  person: MlbApiPerson | undefined,
  blockName: string,
): MlbApiStatBlock | undefined =>
  person?.stats?.find((statBlock) => statBlock.type?.displayName === blockName);

const getSeasonStat = (person: MlbApiPerson | undefined): Record<string, unknown> =>
  getStatBlock(person, 'season')?.splits?.[0]?.stat ?? {};

const getSplitStat = (
  person: MlbApiPerson | undefined,
  splitCode: 'vl' | 'vr',
): Record<string, unknown> =>
  getStatBlock(person, 'statSplits')
    ?.splits?.find((split) => split.split?.code === splitCode)?.stat ?? {};

const getGameLogs = (person: MlbApiPerson | undefined): Record<string, unknown>[] =>
  (getStatBlock(person, 'gameLog')?.splits ?? []).map((split) => split.stat ?? {});

const toRecentHitterScore = (gameLogs: Record<string, unknown>[]): number => {
  const recentGames = gameLogs.slice(-5);
  const averageOps = average(
    recentGames.map((game) => parseDecimal(game.ops, 0.68)),
  );
  const averageHits = average(recentGames.map((game) => parseNumber(game.hits)));
  const homeRuns = recentGames.reduce(
    (total, game) => total + parseNumber(game.homeRuns),
    0,
  );

  return clamp(
    scaleToScore(averageOps, 0.45, 1.1) * 0.7 +
      scaleToScore(averageHits, 0, 2.4) * 0.2 +
      homeRuns * 3,
    0,
    100,
  );
};

const toRecentPitcherScore = (gameLogs: Record<string, unknown>[]): number => {
  const recentStarts = gameLogs.slice(-4);
  const era = average(recentStarts.map((game) => parseNumber(game.era, 4)));
  const whip = average(recentStarts.map((game) => parseNumber(game.whip, 1.3)));
  const strikeoutsPer9 = average(
    recentStarts.map((game) => parseNumber(game.strikeoutsPer9Inn, 8)),
  );

  return clamp(
    inverseScaleToScore(era, 1.8, 6.2) * 0.45 +
      inverseScaleToScore(whip, 0.85, 1.6) * 0.3 +
      scaleToScore(strikeoutsPer9, 4.5, 13.5) * 0.25,
    0,
    100,
  );
};

const adjustParkFactorsForWeather = (
  baseFactors: ParkEventFactors,
  weather: WeatherInfo | undefined,
): ParkEventFactors => {
  if (!weather) {
    return baseFactors;
  }

  let parkFactor = baseFactors.parkFactor;
  let hitFactor = baseFactors.hitFactor;
  let singleFactor = baseFactors.singleFactor;
  let doubleFactor = baseFactors.doubleFactor;
  let tripleFactor = baseFactors.tripleFactor;
  let homeRunFactor = baseFactors.homeRunFactor;
  let walkFactor = baseFactors.walkFactor;
  let strikeoutFactor = baseFactors.strikeoutFactor;
  const wind = weather.wind?.toLowerCase() ?? '';

  if (weather.temperatureF) {
    parkFactor += clamp((weather.temperatureF - 70) * 0.12, -3, 4);
    hitFactor += clamp((weather.temperatureF - 70) * 0.08, -2, 3);
    doubleFactor += clamp((weather.temperatureF - 70) * 0.06, -2, 2);
    tripleFactor += clamp((weather.temperatureF - 70) * 0.04, -2, 2);
    homeRunFactor += clamp((weather.temperatureF - 70) * 0.18, -4, 6);
  }

  if (typeof weather.precipitationProbability === 'number') {
    parkFactor -= clamp(weather.precipitationProbability * 0.03, 0, 4);
    hitFactor -= clamp(weather.precipitationProbability * 0.02, 0, 3);
    singleFactor -= clamp(weather.precipitationProbability * 0.02, 0, 3);
    homeRunFactor -= clamp(weather.precipitationProbability * 0.04, 0, 5);
    walkFactor += clamp(weather.precipitationProbability * 0.01, 0, 2);
  }

  if (wind.includes('out')) {
    homeRunFactor += 5;
    parkFactor += 2;
    hitFactor += 1;
    doubleFactor += 1;
  }

  if (wind.includes('in')) {
    homeRunFactor -= 5;
    parkFactor -= 1;
    hitFactor -= 1;
    doubleFactor -= 1;
    strikeoutFactor += 1;
  }

  return {
    parkFactor: Math.round(parkFactor),
    hitFactor: Math.round(hitFactor),
    singleFactor: Math.round(singleFactor),
    doubleFactor: Math.round(doubleFactor),
    tripleFactor: Math.round(tripleFactor),
    homeRunFactor: Math.round(homeRunFactor),
    walkFactor: Math.round(walkFactor),
    strikeoutFactor: Math.round(strikeoutFactor),
  };
};

const buildPitcherFacingProfile = (input: {
  pitcher: MlbApiPerson | undefined;
  savantSplit: SavantStatRow | undefined;
  savantOverall: SavantStatRow | undefined;
}): LivePitcherProfile => {
  const season = getSeasonStat(input.pitcher);
  const statcast = input.savantSplit ?? input.savantOverall;
  const ba = statcast?.ba ?? parseDecimal(season.avg, 0.245);
  const xba = statcast?.xba ?? ba;
  const xwoba = statcast?.xwoba ?? parseDecimal(season.obp, 0.32);
  const xslg = statcast?.xslg ?? parseDecimal(season.slg, 0.405);
  const hardHitRate = statcast?.hardHitRate ?? 38;
  const barrelRate = statcast?.barrelRate ?? 7;

  return {
    playerId: String(input.pitcher?.id ?? 'unknown'),
    throwingHand: safeHandedness(input.pitcher?.pitchHand?.code),
    contactAllowed: clamp(24 + xba * 65 + hardHitRate * 0.2, 25, 50),
    powerAllowed: clamp(2 + barrelRate * 0.32 + xslg * 18, 2, 14),
    xwobaAllowed: xwoba,
    xbaAllowed: xba,
    xslgAllowed: xslg,
    averageExitVelocityAllowed: statcast?.averageExitVelocity ?? 89,
    strikeoutRate: statcast?.strikeoutRate ?? 22,
    walkRate: statcast?.walkRate ?? 8,
    swingMissRate: statcast?.swingMissRate ?? 24,
  };
};

const buildWeightedPitcherSplit = (
  profile: SavantPitcherProfile | undefined,
  lineup: LineupEntry[],
): SavantStatRow | undefined => {
  if (!profile?.overall) {
    return undefined;
  }

  const leftWeight = lineup.filter((entry) => entry.bats === 'L').length;
  const rightWeight = lineup.filter((entry) => entry.bats !== 'L').length;
  const totalWeight = leftWeight + rightWeight;

  if (totalWeight === 0) {
    return profile.overall;
  }

  const vsLeft = profile.vsLeft ?? profile.overall;
  const vsRight = profile.vsRight ?? profile.overall;
  const weighted = (selector: (row: SavantStatRow) => number): number =>
    (selector(vsLeft) * leftWeight + selector(vsRight) * rightWeight) / totalWeight;

  return {
    ...profile.overall,
    ba: weighted((row) => row.ba),
    iso: weighted((row) => row.iso),
    woba: weighted((row) => row.woba),
    xwoba: weighted((row) => row.xwoba),
    xba: weighted((row) => row.xba),
    xslg: weighted((row) => row.xslg),
    hardHitRate: weighted((row) => row.hardHitRate),
    barrelRate: weighted((row) => row.barrelRate),
    averageExitVelocity: weighted((row) => row.averageExitVelocity),
    strikeoutRate: weighted((row) => row.strikeoutRate),
    walkRate: weighted((row) => row.walkRate),
    swingMissRate: weighted((row) => row.swingMissRate),
    plateAppearances: weighted((row) => row.plateAppearances),
    homeRuns: weighted((row) => row.homeRuns),
  };
};

const buildHitterCandidate = (input: {
  lineupEntry: LineupEntry;
  game: RawGame;
  team: TeamInfo;
  opponent: TeamInfo;
  opposingPitcherHand: Handedness;
  hitter: MlbApiPerson | undefined;
  savantSplit: SavantStatRow | undefined;
  savantOverall: SavantStatRow | undefined;
  batTrackingProfile: SavantBatTrackingProfile | undefined;
  opposingPitcherProfile: LivePitcherProfile | undefined;
  batterVsPitcherHistory: BatterVsPitcherHistory | undefined;
  pitchMixMatchup: PitchMixMatchup | undefined;
  weatherSource: 'open-meteo' | 'mlb-feed' | 'unknown';
}): RawHitterCandidate => {
  const splitCode = input.opposingPitcherHand === 'L' ? 'vl' : 'vr';
  const season = getSeasonStat(input.hitter);
  const split = getSplitStat(input.hitter, splitCode);
  const logs = getGameLogs(input.hitter);
  const statcast = input.savantSplit ?? input.savantOverall;
  const avg = statcast?.ba ?? parseDecimal(split.avg ?? season.avg, 0.245);
  const xba = statcast?.xba ?? avg;
  const xslg = statcast?.xslg ?? parseDecimal(split.slg ?? season.slg, 0.405);
  const iso = statcast?.iso ?? clamp(xslg - avg, 0.08, 0.36);
  const woba = statcast?.woba ?? parseDecimal(split.obp ?? season.obp, 0.32);
  const xwoba = statcast?.xwoba ?? woba;
  const strikeoutRate =
    statcast?.strikeoutRate ??
    (() => {
      const plateAppearances = parseNumber(
        split.plateAppearances ?? season.plateAppearances,
        1,
      );
      return plateAppearances > 0
        ? (parseNumber(split.strikeOuts ?? season.strikeOuts) / plateAppearances) * 100
        : 22;
    })();
  const walkRate =
    statcast?.walkRate ??
    (() => {
      const plateAppearances = parseNumber(
        split.plateAppearances ?? season.plateAppearances,
        1,
      );
      return plateAppearances > 0
        ? (parseNumber(split.baseOnBalls ?? season.baseOnBalls) / plateAppearances) * 100
        : 8;
    })();
  const recentForm = toRecentHitterScore(logs);
  const hardHitRate = statcast?.hardHitRate ?? clamp(28 + iso * 100, 28, 60);
  const barrelRate = statcast?.barrelRate ?? clamp(3 + iso * 50, 2, 22);
  const averageExitVelocity = statcast?.averageExitVelocity ?? 89;
  const batTracking = input.batTrackingProfile;
  const park = adjustParkFactorsForWeather(
    resolveHandednessParkFactors(input.game.homeTeam.abbreviation, input.lineupEntry.bats),
    input.game.weather,
  );
  const batterVsPitcher =
    input.batterVsPitcherHistory ?? buildBatterVsPitcherHistory(undefined);
  const pitchMixMatchup =
    input.pitchMixMatchup ?? buildPitchMixMatchup(undefined, new Map());

  const notes = [
    'MLB Stats API supplies game, lineup, and probable pitcher context.',
    statcast
      ? 'Baseball Savant split leaderboard metrics are applied for contact quality and expected output.'
      : 'Baseball Savant split metrics were unavailable, so MLB split stats carried the hitter profile.',
  ];

  if (batTracking) {
    notes.push('Bat-tracking metrics are included for bat speed, squared-up contact, and blast quality.');
  }

  if (batterVsPitcher.plateAppearances > 0) {
    notes.push('Historical batter-vs-pitcher outcomes are included with sample-aware weighting.');
  }

  if (pitchMixMatchup.sample > 0) {
    notes.push('Pitch-arsenal fit is included using the pitcher mix and the hitter’s results by pitch type.');
  }

  notes.push('Handedness-aware park factors are applied for hit, extra-base-hit, and home-run environments.');

  if (input.weatherSource === 'open-meteo') {
    notes.push('Open-Meteo game-time weather adjustment is included in the park context.');
  }

  return {
    playerId: input.lineupEntry.playerId,
    playerName: input.lineupEntry.playerName,
    team: input.team,
    opponent: input.opponent,
    bats: input.lineupEntry.bats,
    opposingPitcherHand: input.opposingPitcherHand,
    gameId: input.game.gameId,
    matchupId: input.game.matchupId,
    matchupLabel: input.game.matchupLabel,
    notes,
    metrics: {
      averageVsHandedness: avg,
      isoVsHandedness: iso,
      wobaVsHandedness: woba,
      xwobaVsHandedness: xwoba,
      xbaVsHandedness: xba,
      xslgVsHandedness: xslg,
      strikeoutRate,
      walkRate,
      hardHitRate,
      barrelRate,
      averageExitVelocity,
      averageBatSpeed: batTracking?.averageBatSpeed ?? 72,
      hardSwingRate: batTracking?.hardSwingRate ?? 18,
      squaredUpRate: batTracking?.squaredUpRate ?? 28,
      blastRate: batTracking?.blastRate ?? 8,
      swingLength: batTracking?.swingLength ?? 7.2,
      batTrackingRunValue: batTracking?.batterRunValue ?? 0,
      recentForm,
      opponentPitcherContactAllowed:
        input.opposingPitcherProfile?.contactAllowed ?? 36,
      opponentPitcherPowerAllowed:
        input.opposingPitcherProfile?.powerAllowed ?? 7,
      batterVsPitcherPlateAppearances: batterVsPitcher.plateAppearances,
      batterVsPitcherOps: batterVsPitcher.ops,
      batterVsPitcherHomeRuns: batterVsPitcher.homeRuns,
      batterVsPitcherStrikeoutRate: batterVsPitcher.strikeoutRate,
      batterVsPitcherScore: batterVsPitcher.score,
      pitchMixMatchupScore: pitchMixMatchup.score,
      pitchMixMatchupSample: pitchMixMatchup.sample,
      primaryPitchTypeCode: pitchMixMatchup.primaryPitchTypeCode,
      primaryPitchTypeDescription: pitchMixMatchup.primaryPitchTypeDescription,
      primaryPitchUsage: pitchMixMatchup.primaryPitchUsage,
      secondaryPitchTypeCode: pitchMixMatchup.secondaryPitchTypeCode,
      secondaryPitchTypeDescription: pitchMixMatchup.secondaryPitchTypeDescription,
      secondaryPitchUsage: pitchMixMatchup.secondaryPitchUsage,
      parkFactor: park.parkFactor,
      parkFactorVsHandedness: park.parkFactor,
      hitParkFactorVsHandedness: park.hitFactor,
      singleParkFactorVsHandedness: park.singleFactor,
      doubleParkFactorVsHandedness: park.doubleFactor,
      tripleParkFactorVsHandedness: park.tripleFactor,
      homeRunParkFactor: park.homeRunFactor,
      homeRunParkFactorVsHandedness: park.homeRunFactor,
      walkParkFactorVsHandedness: park.walkFactor,
      strikeoutParkFactorVsHandedness: park.strikeoutFactor,
      lineupSpot: input.lineupEntry.battingOrder,
      lineupConfirmed: input.lineupEntry.status === 'confirmed',
      playingTimeConfidence:
        input.lineupEntry.status === 'confirmed' ? 96 : 78,
    },
    source: 'live',
  };
};

const buildPitcherCandidate = (input: {
  game: RawGame;
  team: TeamInfo;
  opponent: TeamInfo;
  probablePitcher: RawGame['probablePitchers']['away'] | undefined;
  pitcher: MlbApiPerson | undefined;
  lineup: LineupEntry[];
  opposingHitters: RawHitterCandidate[];
  savantOverall: SavantStatRow | undefined;
  savantWeighted: SavantStatRow | undefined;
  weatherSource: 'open-meteo' | 'mlb-feed' | 'unknown';
}): RawPitcherCandidate => {
  const season = getSeasonStat(input.pitcher);
  const gameLogs = getGameLogs(input.pitcher);
  const battersFaced = parseNumber(season.battersFaced, 1);
  const strikeouts = parseNumber(season.strikeOuts, 0);
  const walks = parseNumber(season.baseOnBalls, 0);
  const inningsPitched = parseInningsPitched(season.inningsPitched ?? 0);
  const averageInnings = average(
    gameLogs
      .slice(-4)
      .map((game) => parseInningsPitched(game.inningsPitched ?? 5.5)),
  );
  const recentForm = toRecentPitcherScore(gameLogs);
  const statcast = input.savantWeighted ?? input.savantOverall;
  const opponentStrikeoutRate =
    input.opposingHitters.length > 0
      ? average(
          input.opposingHitters.map(
            (hitter) => hitter.metrics.strikeoutRate ?? 22,
          ),
        )
      : 22;
  const opponentWalkRate =
    input.opposingHitters.length > 0
      ? average(
          input.opposingHitters.map((hitter) => hitter.metrics.walkRate ?? 8),
        )
      : 8;
  const opponentPowerRating =
    input.opposingHitters.length > 0
      ? average(
          input.opposingHitters.map(
            (hitter) =>
              (hitter.metrics.isoVsHandedness ?? 0.17) * 220 +
              (hitter.metrics.hardHitRate ?? 38) * 0.55 +
              (hitter.metrics.barrelRate ?? 7) * 1.4 +
              (hitter.metrics.xslgVsHandedness ?? 0.405) * 55,
          ),
        )
      : 55;
  const park = adjustParkFactorsForWeather(
    resolveHandednessParkFactors(input.game.homeTeam.abbreviation, 'S'),
    input.game.weather,
  );
  const teamOffense =
    average(
      input.lineup.map((lineupEntry) => (lineupEntry.battingOrder <= 4 ? 80 : 62)),
    ) || 68;
  const notes = [
    'MLB Stats API supplies workload, recent-form, and lineup context.',
    statcast
      ? 'Baseball Savant contact-quality suppression metrics are applied to the pitcher profile.'
      : 'Baseball Savant pitcher suppression metrics were unavailable, so MLB season rates carried the profile.',
    'Run-environment context includes park-level home-run and strikeout effects.',
  ];

  if (input.weatherSource === 'open-meteo') {
    notes.push('Open-Meteo game-time weather adjustment is included in the run environment.');
  }

  return {
    playerId: input.probablePitcher?.playerId ?? String(input.pitcher?.id ?? 'unknown'),
    playerName: input.pitcher?.fullName ?? input.probablePitcher?.name ?? 'TBD',
    team: input.team,
    opponent: input.opponent,
    throwingHand: safeHandedness(
      input.pitcher?.pitchHand?.code ?? input.probablePitcher?.throwingHand,
    ),
    gameId: input.game.gameId,
    matchupId: input.game.matchupId,
    matchupLabel: input.game.matchupLabel,
    notes,
    metrics: {
      strikeoutRate:
        statcast?.strikeoutRate ??
        (battersFaced > 0 ? (strikeouts / battersFaced) * 100 : 22),
      walkRate:
        statcast?.walkRate ??
        (battersFaced > 0 ? (walks / battersFaced) * 100 : 8),
      swingingStrikeRate:
        statcast?.swingMissRate ??
        clamp(7 + parseNumber(season.strikeoutsPer9Inn, 8) * 0.65, 8, 18),
      hardHitAllowed: statcast?.hardHitRate ?? 37,
      barrelAllowed: statcast?.barrelRate ?? 7,
      xwobaAllowed: statcast?.xwoba ?? 0.32,
      xbaAllowed: statcast?.xba ?? 0.245,
      xslgAllowed: statcast?.xslg ?? 0.405,
      averageExitVelocityAllowed: statcast?.averageExitVelocity ?? 89,
      recentForm,
      inningsProjection: clamp(
        averageInnings ||
          inningsPitched / Math.max(parseNumber(season.gamesStarted, 1), 1),
        4.5,
        7.5,
      ),
      opponentStrikeoutRate,
      opponentWalkRate,
      opponentPowerRating: clamp(opponentPowerRating, 35, 82),
      parkFactor: park.parkFactor,
      homeRunParkFactor: park.homeRunFactor,
      strikeoutParkFactor: park.strikeoutFactor,
      winSupportRating: clamp(teamOffense, 45, 85),
    },
    source: 'live',
  };
};

export class LiveMlbStatsApiProvider implements DailyDataProvider {
  public readonly name = 'live';
  private readonly mlbStatsApi: MlbStatsApiSource;
  private readonly baseballSavant: BaseballSavantSource;
  private readonly openMeteo?: OpenMeteoSource;
  private readonly fanGraphsSupport?: FanGraphsSupportSource;

  public constructor(config: {
    mlbStatsApiBaseUrl: string;
    baseballSavantBaseUrl: string;
    fangraphsBaseUrl: string;
    openMeteoBaseUrl: string;
    timeoutMs: number;
    enableOpenMeteoWeather: boolean;
    enableFanGraphsSupport: boolean;
  }) {
    this.mlbStatsApi = new MlbStatsApiSource(
      config.mlbStatsApiBaseUrl,
      config.timeoutMs,
    );
    this.baseballSavant = new BaseballSavantSource(
      config.baseballSavantBaseUrl,
      config.timeoutMs,
    );
    this.openMeteo = config.enableOpenMeteoWeather
      ? new OpenMeteoSource(config.openMeteoBaseUrl, config.timeoutMs)
      : undefined;
    this.fanGraphsSupport = config.enableFanGraphsSupport
      ? new FanGraphsSupportSource(config.fangraphsBaseUrl, config.timeoutMs)
      : undefined;
  }

  public async getDailySlate(date: string): Promise<RawDailySlate> {
    const mockSlate = createMockDailySlate(date);
    const season = date.slice(0, 4);

    try {
      const scheduleGames = await this.mlbStatsApi.getSchedule(date);

      if (scheduleGames.length === 0) {
        return this.withFallbackNote(
          mockSlate,
          'No live games were found for that date, so the seeded slate was used.',
        );
      }

      const feeds = await Promise.all(
        scheduleGames.map((game) => this.mlbStatsApi.getGameFeed(game.gamePk)),
      );

      const weatherResults = await Promise.all(
        scheduleGames.map((game) =>
          this.openMeteo
            ? this.openMeteo
                .getGameWeather(
                  game.teams?.home?.team?.abbreviation ?? '',
                  game.gameDate ?? `${date}T19:00:00Z`,
                )
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ),
      );

      const games: RawGame[] = scheduleGames.map((game, index) => {
        const feed = feeds[index] ?? null;
        const awayTeam = buildTeamInfo(game.teams?.away?.team);
        const homeTeam = buildTeamInfo(game.teams?.home?.team);
        const parkFactors = parkFactorsByHomeTeam[homeTeam.abbreviation] ?? {
          parkFactor: 100,
          homeRunFactor: 100,
        };
        const awayLineup = extractLineup(feed, 'away');
        const homeLineup = extractLineup(feed, 'home');
        const weather = mergeWeather(
          weatherResults[index],
          buildWeatherFromFeed(feed),
        );

        return {
          gameId: String(game.gamePk),
          matchupId: `${awayTeam.abbreviation}@${homeTeam.abbreviation}`,
          gameDate: date,
          startTime: game.gameDate ?? `${date}T19:00:00Z`,
          matchupLabel: `${awayTeam.abbreviation} @ ${homeTeam.abbreviation}`,
          status: buildGameStatus(game.status?.abstractGameState),
          awayTeam,
          homeTeam,
          venue: {
            name: game.venue?.name ?? `${homeTeam.name} Home Park`,
            city: game.venue?.location?.city ?? homeTeam.city,
            parkFactor: parkFactors.parkFactor,
            homeRunFactor: parkFactors.homeRunFactor,
          },
          probablePitchers: {
            away: buildScheduleProbablePitcherInfo(game.teams?.away?.probablePitcher),
            home: buildScheduleProbablePitcherInfo(game.teams?.home?.probablePitcher),
          },
          lineupStatus: buildLineupStatus(awayLineup, homeLineup),
          lineups: {
            away: awayLineup,
            home: homeLineup,
          },
          weather,
          officials: buildOfficials(feed),
          source: 'live',
        };
      });

      const hitterIds = [
        ...new Set(
          games
            .flatMap((game) => [...game.lineups.away, ...game.lineups.home])
            .map((entry) => entry.playerId),
        ),
      ];
      const pitcherIds = [
        ...new Set(
          games.flatMap((game) =>
            [game.probablePitchers.away?.playerId, game.probablePitchers.home?.playerId].filter(
              (playerId): playerId is string => Boolean(playerId),
            ),
          ),
        ),
      ];
      const matchupGroups = buildMatchupGroups(games);

      const [
        hitterStatsMap,
        pitcherStatsMap,
        pitchArsenalStatsMap,
        hitterPlayLogStatsMap,
        batterVsPitcherStatsMap,
        savantHitterProfiles,
        savantPitcherProfiles,
        batTrackingProfiles,
        fanGraphsNotes,
      ] =
        await Promise.all([
          this.mlbStatsApi.getPeopleStats(hitterIds, 'hitting', season),
          this.mlbStatsApi.getPeopleStats(pitcherIds, 'pitching', season),
          this.mlbStatsApi
            .getPitchArsenalStats(pitcherIds, season)
            .catch(() => new Map<string, MlbApiStatSplit[]>()),
          this.mlbStatsApi
            .getPlayLogStats(hitterIds, 'hitting', season, HITTER_PLAY_LOG_LIMIT)
            .catch(() => new Map<string, MlbApiStatSplit[]>()),
          this.mlbStatsApi
            .getVsPlayerTotalStats(matchupGroups)
            .catch(() => new Map<string, MlbApiStatSplit>()),
          this.baseballSavant.getHitterProfiles(date).catch(() => new Map<string, SavantHitterProfile>()),
          this.baseballSavant.getPitcherProfiles(date).catch(() => new Map<string, SavantPitcherProfile>()),
          this.baseballSavant.getBatTrackingProfiles(date).catch(() => new Map<string, SavantBatTrackingProfile>()),
          this.fanGraphsSupport?.getSupportNotes(games) ?? Promise.resolve([]),
        ]);

      const enrichedGames = games.map((game) => ({
        ...game,
        probablePitchers: {
          away: hydrateProbablePitcherInfo(
            game.probablePitchers.away,
            pitcherStatsMap.get(game.probablePitchers.away?.playerId ?? ''),
          ),
          home: hydrateProbablePitcherInfo(
            game.probablePitchers.home,
            pitcherStatsMap.get(game.probablePitchers.home?.playerId ?? ''),
          ),
        },
      }));

      const pitcherProfiles = new Map<string, LivePitcherProfile>();
      const pitchArsenals = new Map<string, PitchArsenalEntry[]>();
      const hitterPitchTypePerformance = new Map<
        string,
        Map<string, PitchTypePlateAppearanceStats>
      >();

      pitcherIds.forEach((pitcherId) => {
        const pitcher = pitcherStatsMap.get(pitcherId);
        const savantProfile = savantPitcherProfiles.get(pitcherId);
        pitchArsenals.set(pitcherId, toPitchArsenal(pitchArsenalStatsMap.get(pitcherId)));
        pitcherProfiles.set(
          `${pitcherId}:L`,
          buildPitcherFacingProfile({
            pitcher,
            savantSplit: savantProfile?.vsLeft,
            savantOverall: savantProfile?.overall,
          }),
        );
        pitcherProfiles.set(
          `${pitcherId}:R`,
          buildPitcherFacingProfile({
            pitcher,
            savantSplit: savantProfile?.vsRight,
            savantOverall: savantProfile?.overall,
          }),
        );
      });

      hitterIds.forEach((hitterId) => {
        const playLog = hitterPlayLogStatsMap.get(hitterId);
        hitterPitchTypePerformance.set(
          `${hitterId}:L`,
          buildPitchTypePerformanceMap(playLog, 'L'),
        );
        hitterPitchTypePerformance.set(
          `${hitterId}:R`,
          buildPitchTypePerformanceMap(playLog, 'R'),
        );
        hitterPitchTypePerformance.set(
          `${hitterId}:U`,
          buildPitchTypePerformanceMap(playLog, 'U'),
        );
      });

      const hitters: RawHitterCandidate[] = enrichedGames.flatMap((game) => {
        const awayPitcherHand = game.probablePitchers.home?.throwingHand ?? 'U';
        const homePitcherHand = game.probablePitchers.away?.throwingHand ?? 'U';
        const awayPitcherId = game.probablePitchers.home?.playerId;
        const homePitcherId = game.probablePitchers.away?.playerId;
        const weatherSource =
          typeof game.weather?.precipitationProbability === 'number'
            ? 'open-meteo'
            : game.weather
              ? 'mlb-feed'
              : 'unknown';

        const awayHitters = game.lineups.away.map((entry) => {
          const savantProfile = savantHitterProfiles.get(entry.playerId);
          const batterVsPitcherHistory = awayPitcherId
            ? buildBatterVsPitcherHistory(
                batterVsPitcherStatsMap.get(`${entry.playerId}:${awayPitcherId}`),
              )
            : undefined;
          const pitchMixMatchup = awayPitcherId
            ? buildPitchMixMatchup(
                pitchArsenals.get(awayPitcherId),
                hitterPitchTypePerformance.get(`${entry.playerId}:${awayPitcherHand}`) ??
                  hitterPitchTypePerformance.get(`${entry.playerId}:U`) ??
                  new Map(),
              )
            : undefined;

          return buildHitterCandidate({
            lineupEntry: entry,
            game,
            team: game.awayTeam,
            opponent: game.homeTeam,
            opposingPitcherHand: awayPitcherHand,
            hitter: hitterStatsMap.get(entry.playerId),
            savantSplit: this.baseballSavant.getSplit(savantProfile, awayPitcherHand),
            savantOverall: savantProfile?.overall,
            batTrackingProfile: batTrackingProfiles.get(entry.playerId),
            opposingPitcherProfile: awayPitcherId
              ? pitcherProfiles.get(`${awayPitcherId}:${entry.bats === 'L' ? 'L' : 'R'}`)
              : undefined,
            batterVsPitcherHistory,
            pitchMixMatchup,
            weatherSource,
          });
        });
        const homeHitters = game.lineups.home.map((entry) => {
          const savantProfile = savantHitterProfiles.get(entry.playerId);
          const batterVsPitcherHistory = homePitcherId
            ? buildBatterVsPitcherHistory(
                batterVsPitcherStatsMap.get(`${entry.playerId}:${homePitcherId}`),
              )
            : undefined;
          const pitchMixMatchup = homePitcherId
            ? buildPitchMixMatchup(
                pitchArsenals.get(homePitcherId),
                hitterPitchTypePerformance.get(`${entry.playerId}:${homePitcherHand}`) ??
                  hitterPitchTypePerformance.get(`${entry.playerId}:U`) ??
                  new Map(),
              )
            : undefined;

          return buildHitterCandidate({
            lineupEntry: entry,
            game,
            team: game.homeTeam,
            opponent: game.awayTeam,
            opposingPitcherHand: homePitcherHand,
            hitter: hitterStatsMap.get(entry.playerId),
            savantSplit: this.baseballSavant.getSplit(savantProfile, homePitcherHand),
            savantOverall: savantProfile?.overall,
            batTrackingProfile: batTrackingProfiles.get(entry.playerId),
            opposingPitcherProfile: homePitcherId
              ? pitcherProfiles.get(`${homePitcherId}:${entry.bats === 'L' ? 'L' : 'R'}`)
              : undefined,
            batterVsPitcherHistory,
            pitchMixMatchup,
            weatherSource,
          });
        });

        return [...awayHitters, ...homeHitters];
      });

      const pitchers: RawPitcherCandidate[] = enrichedGames.flatMap((game) => {
        const awayPitcherId = game.probablePitchers.away?.playerId;
        const homePitcherId = game.probablePitchers.home?.playerId;
        const weatherSource =
          typeof game.weather?.precipitationProbability === 'number'
            ? 'open-meteo'
            : game.weather
              ? 'mlb-feed'
              : 'unknown';
        const awaySavantProfile = awayPitcherId
          ? savantPitcherProfiles.get(awayPitcherId)
          : undefined;
        const homeSavantProfile = homePitcherId
          ? savantPitcherProfiles.get(homePitcherId)
          : undefined;

        const awayPitcher = awayPitcherId
          ? buildPitcherCandidate({
              game,
              team: game.awayTeam,
              opponent: game.homeTeam,
              probablePitcher: game.probablePitchers.away,
              pitcher: pitcherStatsMap.get(awayPitcherId),
              lineup: game.lineups.away,
              opposingHitters: hitters.filter(
                (hitter) =>
                  hitter.gameId === game.gameId &&
                  hitter.team.abbreviation === game.homeTeam.abbreviation,
              ),
              savantOverall: awaySavantProfile?.overall,
              savantWeighted: buildWeightedPitcherSplit(
                awaySavantProfile,
                game.lineups.home,
              ),
              weatherSource,
            })
          : null;
        const homePitcher = homePitcherId
          ? buildPitcherCandidate({
              game,
              team: game.homeTeam,
              opponent: game.awayTeam,
              probablePitcher: game.probablePitchers.home,
              pitcher: pitcherStatsMap.get(homePitcherId),
              lineup: game.lineups.home,
              opposingHitters: hitters.filter(
                (hitter) =>
                  hitter.gameId === game.gameId &&
                  hitter.team.abbreviation === game.awayTeam.abbreviation,
              ),
              savantOverall: homeSavantProfile?.overall,
              savantWeighted: buildWeightedPitcherSplit(
                homeSavantProfile,
                game.lineups.away,
              ),
              weatherSource,
            })
          : null;

        return [awayPitcher, homePitcher].filter(
          (pitcher): pitcher is RawPitcherCandidate => Boolean(pitcher),
        );
      });

      const confirmedGames = enrichedGames.filter(
        (game) => game.lineupStatus === 'confirmed',
      ).length;
      const partialGames = enrichedGames.filter(
        (game) => game.lineupStatus === 'partial',
      ).length;
      const openMeteoGames = enrichedGames.filter(
        (game) => typeof game.weather?.precipitationProbability === 'number',
      ).length;
      const statcastHitterCoverage = hitters.filter(
        (hitter) =>
          (hitter.notes ?? []).some((note) =>
            note.includes('Baseball Savant split leaderboard'),
          ),
      ).length;
      const statcastPitcherCoverage = pitchers.filter(
        (pitcher) =>
          (pitcher.notes ?? []).some((note) =>
            note.includes('Baseball Savant contact-quality'),
          ),
      ).length;
      const batTrackingCoverage = hitters.filter(
        (hitter) =>
          (hitter.notes ?? []).some((note) => note.includes('Bat-tracking metrics')),
      ).length;

      if (hitters.length === 0 && pitchers.length === 0) {
        return this.withFallbackNote(
          mockSlate,
          'Live source stack loaded the schedule, but no lineup-driven players could be built, so the seeded slate was used.',
        );
      }

      const source =
        hitters.length > 0 &&
        pitchers.length > 0 &&
        statcastHitterCoverage > 0 &&
        statcastPitcherCoverage > 0
          ? 'live'
          : 'hybrid';

      return {
        analysisDate: date,
        generatedAt: new Date().toISOString(),
        providerName:
          source === 'live' ? 'mlb-source-stack-live' : 'mlb-source-stack-hybrid',
        source,
        notes: [
          `MLB Stats API loaded ${enrichedGames.length} games for ${date}.`,
          `${confirmedGames} games have confirmed lineups and ${partialGames} have partial lineup context.`,
          `Baseball Savant advanced metrics covered ${statcastHitterCoverage} hitters and ${statcastPitcherCoverage} pitchers.`,
          `Bat-tracking metrics covered ${batTrackingCoverage} hitters, and handedness-aware park factors were applied to every game environment.`,
          openMeteoGames > 0
            ? `Open-Meteo supplied game-time weather for ${openMeteoGames} games.`
            : 'Open-Meteo weather was unavailable, so MLB game-feed weather was used when present.',
          ...fanGraphsNotes,
          hitters.length === 0
            ? 'No lineup-driven hitter slate was available, so hitter rankings are empty for this refresh.'
            : 'Hitter rankings use MLB lineup context plus Baseball Savant split and contact-quality data.',
          pitchers.length === 0
            ? 'Pitcher metrics could not be built from the live source stack for this refresh.'
            : 'Pitcher rankings blend MLB workload/recent form with Baseball Savant suppression metrics.',
        ],
        games: enrichedGames,
        hitters,
        pitchers,
      };
    } catch {
      return this.withFallbackNote(
        mockSlate,
        'The requested live source stack failed, so the seeded slate was used.',
      );
    }
  }

  private withFallbackNote(mockSlate: RawDailySlate, note: string): RawDailySlate {
    return {
      ...mockSlate,
      providerName: 'mlb-source-stack-hybrid',
      source: 'hybrid',
      notes: [...(mockSlate.notes ?? []), note],
    };
  }
}


