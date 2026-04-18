import type {
  Handedness,
  LineupEntry,
  OfficialInfo,
  ProbablePitcherInfo,
  TeamInfo,
  VenueInfo,
  WeatherInfo,
} from '@mlb-analyzer/shared';

import type { RawDailySlate, RawGame, RawHitterCandidate, RawPitcherCandidate } from '../types.js';

const teams = {
  LAD: { id: 'lad', city: 'Los Angeles', name: 'Dodgers', abbreviation: 'LAD' },
  ARI: { id: 'ari', city: 'Arizona', name: 'Diamondbacks', abbreviation: 'ARI' },
  NYY: { id: 'nyy', city: 'New York', name: 'Yankees', abbreviation: 'NYY' },
  BOS: { id: 'bos', city: 'Boston', name: 'Red Sox', abbreviation: 'BOS' },
  ATL: { id: 'atl', city: 'Atlanta', name: 'Braves', abbreviation: 'ATL' },
  PHI: { id: 'phi', city: 'Philadelphia', name: 'Phillies', abbreviation: 'PHI' },
  HOU: { id: 'hou', city: 'Houston', name: 'Astros', abbreviation: 'HOU' },
  TEX: { id: 'tex', city: 'Texas', name: 'Rangers', abbreviation: 'TEX' },
} satisfies Record<string, TeamInfo>;

const venues = {
  chase: {
    name: 'Chase Field',
    city: 'Phoenix',
    parkFactor: 102,
    homeRunFactor: 101,
    roof: 'retractable',
  },
  fenway: { name: 'Fenway Park', city: 'Boston', parkFactor: 106, homeRunFactor: 99 },
  cbp: {
    name: 'Citizens Bank Park',
    city: 'Philadelphia',
    parkFactor: 104,
    homeRunFactor: 112,
  },
  glf: {
    name: 'Globe Life Field',
    city: 'Arlington',
    parkFactor: 98,
    homeRunFactor: 96,
    roof: 'retractable',
  },
} satisfies Record<string, VenueInfo>;

const pitcher = (playerId: string, name: string, throwingHand: Handedness): ProbablePitcherInfo => ({
  playerId,
  name,
  throwingHand,
});

type TeamCode = keyof typeof teams;
type VenueKey = keyof typeof venues;

interface GameSeed {
  gameId: string;
  awayTeam: TeamCode;
  homeTeam: TeamCode;
  venue: VenueKey;
  startTime: string;
  lineupStatus: RawGame['lineupStatus'];
  weather: WeatherInfo;
  officials: OfficialInfo[];
  probablePitchers: {
    away: ProbablePitcherInfo;
    home: ProbablePitcherInfo;
  };
}

const gameSeeds: GameSeed[] = [
  {
    gameId: 'game-001',
    awayTeam: 'LAD',
    homeTeam: 'ARI',
    venue: 'chase',
    startTime: '18:40:00-07:00',
    lineupStatus: 'projected',
    weather: { condition: 'Roof expected closed', temperatureF: 76, wind: 'Controlled indoor conditions' },
    officials: [{ type: 'Home Plate', name: 'Jordan Baker', id: 'ump-baker' }],
    probablePitchers: {
      away: pitcher('p-glasnow', 'Tyler Glasnow', 'R'),
      home: pitcher('p-gallen', 'Zac Gallen', 'R'),
    },
  },
  {
    gameId: 'game-002',
    awayTeam: 'NYY',
    homeTeam: 'BOS',
    venue: 'fenway',
    startTime: '16:10:00-04:00',
    lineupStatus: 'confirmed',
    weather: { condition: 'Cool and breezy', temperatureF: 58, wind: '9 mph, out to left' },
    officials: [{ type: 'Home Plate', name: 'Alan Porter', id: 'ump-porter' }],
    probablePitchers: {
      away: pitcher('p-cole', 'Gerrit Cole', 'R'),
      home: pitcher('p-bello', 'Brayan Bello', 'R'),
    },
  },
  {
    gameId: 'game-003',
    awayTeam: 'ATL',
    homeTeam: 'PHI',
    venue: 'cbp',
    startTime: '18:45:00-04:00',
    lineupStatus: 'projected',
    weather: { condition: 'Mild with slight breeze', temperatureF: 63, wind: '6 mph, out to right' },
    officials: [{ type: 'Home Plate', name: 'Dan Bellino', id: 'ump-bellino' }],
    probablePitchers: {
      away: pitcher('p-strider', 'Spencer Strider', 'R'),
      home: pitcher('p-wheeler', 'Zack Wheeler', 'R'),
    },
  },
  {
    gameId: 'game-004',
    awayTeam: 'HOU',
    homeTeam: 'TEX',
    venue: 'glf',
    startTime: '19:05:00-05:00',
    lineupStatus: 'confirmed',
    weather: { condition: 'Roof likely closed', temperatureF: 72, wind: 'Minimal indoor wind' },
    officials: [{ type: 'Home Plate', name: 'Chris Segal', id: 'ump-segal' }],
    probablePitchers: {
      away: pitcher('p-valdez', 'Framber Valdez', 'L'),
      home: pitcher('p-eovaldi', 'Nathan Eovaldi', 'R'),
    },
  },
];

type HitterRow = [
  playerId: string,
  playerName: string,
  teamCode: TeamCode,
  opponentCode: TeamCode,
  gameId: string,
  bats: Handedness,
  opposingPitcherHand: Handedness,
  averageVsHandedness: number,
  isoVsHandedness: number,
  wobaVsHandedness: number,
  strikeoutRate: number,
  walkRate: number,
  hardHitRate: number,
  barrelRate: number,
  recentForm: number,
  opponentPitcherContactAllowed: number,
  opponentPitcherPowerAllowed: number,
  parkFactor: number,
  homeRunParkFactor: number,
  lineupSpot: number,
  lineupConfirmed: boolean,
  playingTimeConfidence: number,
];

type PitcherRow = [
  playerId: string,
  playerName: string,
  teamCode: TeamCode,
  opponentCode: TeamCode,
  gameId: string,
  throwingHand: Handedness,
  strikeoutRate: number,
  walkRate: number,
  swingingStrikeRate: number,
  hardHitAllowed: number,
  barrelAllowed: number,
  recentForm: number,
  inningsProjection: number,
  opponentStrikeoutRate: number,
  opponentWalkRate: number,
  opponentPowerRating: number,
  parkFactor: number,
  winSupportRating: number,
];

const hitterNotes: Record<string, string[]> = {
  'h-ohtani': ['Elite power ceiling in any slate.'],
  'h-judge': ['Best raw power profile on the board.'],
  'h-acuna': ['Leadoff role raises both floor and volume.'],
};

const pitcherNotes: Record<string, string[]> = {
  'p-glasnow': ['Elite strikeout upside when pitch count holds.'],
  'p-cole': ['Reliable ace profile in this version of the slate.'],
};

const hitterRows: HitterRow[] = [
  ['h-betts', 'Mookie Betts', 'LAD', 'ARI', 'game-001', 'R', 'R', 0.304, 0.221, 0.392, 14.8, 11.2, 45.5, 10.8, 83, 34, 6.1, 102, 101, 1, false, 96],
  ['h-ohtani', 'Shohei Ohtani', 'LAD', 'ARI', 'game-001', 'L', 'R', 0.319, 0.301, 0.438, 22.1, 14.2, 55.6, 18.3, 94, 34, 6.1, 102, 101, 2, false, 99],
  ['h-freeman', 'Freddie Freeman', 'LAD', 'ARI', 'game-001', 'L', 'R', 0.311, 0.224, 0.403, 16.4, 12.1, 46.2, 11.1, 86, 34, 6.1, 102, 101, 3, false, 98],
  ['h-teoscar', 'Teoscar Hernandez', 'LAD', 'ARI', 'game-001', 'R', 'R', 0.276, 0.243, 0.356, 28.2, 7.4, 49.3, 14.2, 78, 34, 6.1, 102, 101, 4, false, 95],
  ['h-carroll', 'Corbin Carroll', 'ARI', 'LAD', 'game-001', 'L', 'R', 0.278, 0.224, 0.353, 22.8, 10.4, 41.4, 11.2, 77, 31, 5.4, 102, 101, 1, false, 97],
  ['h-marte', 'Ketel Marte', 'ARI', 'LAD', 'game-001', 'S', 'R', 0.295, 0.231, 0.384, 16.7, 9.4, 44.8, 11.6, 81, 31, 5.4, 102, 101, 2, false, 96],
  ['h-walker', 'Christian Walker', 'ARI', 'LAD', 'game-001', 'R', 'R', 0.255, 0.257, 0.344, 24.6, 9.1, 47.1, 14.5, 69, 31, 5.4, 102, 101, 4, false, 94],
  ['h-suarez', 'Eugenio Suarez', 'ARI', 'LAD', 'game-001', 'R', 'R', 0.232, 0.241, 0.316, 30.4, 8.6, 46.5, 13.1, 58, 31, 5.4, 102, 101, 5, false, 90],
  ['h-judge', 'Aaron Judge', 'NYY', 'BOS', 'game-002', 'R', 'R', 0.316, 0.342, 0.461, 25.4, 16.1, 58.4, 23.1, 95, 41, 9.7, 106, 99, 2, true, 99],
  ['h-bellinger', 'Cody Bellinger', 'NYY', 'BOS', 'game-002', 'L', 'R', 0.279, 0.203, 0.352, 18.6, 8.9, 41.7, 9.5, 76, 41, 9.7, 106, 99, 3, true, 94],
  ['h-chisholm', 'Jazz Chisholm Jr.', 'NYY', 'BOS', 'game-002', 'L', 'R', 0.258, 0.214, 0.334, 24.7, 7.6, 43.5, 10.4, 72, 41, 9.7, 106, 99, 4, true, 92],
  ['h-volpe', 'Anthony Volpe', 'NYY', 'BOS', 'game-002', 'R', 'R', 0.252, 0.188, 0.328, 22.2, 8.2, 39.4, 8.2, 71, 41, 9.7, 106, 99, 5, true, 93],
  ['h-devers', 'Rafael Devers', 'BOS', 'NYY', 'game-002', 'L', 'R', 0.286, 0.259, 0.373, 24.3, 9.1, 48.7, 13.8, 82, 29, 5.1, 106, 99, 3, true, 96],
  ['h-duran', 'Jarren Duran', 'BOS', 'NYY', 'game-002', 'L', 'R', 0.274, 0.176, 0.344, 22.4, 7.8, 40.9, 8.1, 75, 29, 5.1, 106, 99, 1, true, 95],
  ['h-casas', 'Triston Casas', 'BOS', 'NYY', 'game-002', 'L', 'R', 0.251, 0.218, 0.335, 27.4, 12.8, 44.6, 11.5, 66, 29, 5.1, 106, 99, 4, true, 89],
  ['h-story', 'Trevor Story', 'BOS', 'NYY', 'game-002', 'R', 'R', 0.241, 0.189, 0.309, 30.8, 6.2, 38.2, 8.7, 52, 29, 5.1, 106, 99, 5, true, 86],
  ['h-acuna', 'Ronald Acuna Jr.', 'ATL', 'PHI', 'game-003', 'R', 'R', 0.298, 0.222, 0.392, 12.6, 12.3, 47.7, 11.4, 84, 30, 5.3, 104, 112, 1, false, 98],
  ['h-riley', 'Austin Riley', 'ATL', 'PHI', 'game-003', 'R', 'R', 0.276, 0.249, 0.358, 24.9, 8.3, 49.8, 14.7, 79, 30, 5.3, 104, 112, 3, false, 96],
  ['h-olson', 'Matt Olson', 'ATL', 'PHI', 'game-003', 'L', 'R', 0.259, 0.272, 0.349, 28.6, 12.1, 50.9, 16.4, 73, 30, 5.3, 104, 112, 4, false, 95],
  ['h-albies', 'Ozzie Albies', 'ATL', 'PHI', 'game-003', 'S', 'R', 0.268, 0.191, 0.335, 19.8, 7.5, 38.5, 8.7, 68, 30, 5.3, 104, 112, 2, false, 95],
  ['h-schwarber', 'Kyle Schwarber', 'PHI', 'ATL', 'game-003', 'L', 'R', 0.241, 0.289, 0.351, 28.9, 15.8, 51.7, 18.1, 80, 28, 4.7, 104, 112, 1, false, 97],
  ['h-harper', 'Bryce Harper', 'PHI', 'ATL', 'game-003', 'L', 'R', 0.287, 0.246, 0.382, 20.1, 13.5, 50.1, 14.8, 85, 28, 4.7, 104, 112, 3, false, 97],
  ['h-turner', 'Trea Turner', 'PHI', 'ATL', 'game-003', 'R', 'R', 0.284, 0.183, 0.345, 18.7, 6.9, 39.6, 7.2, 72, 28, 4.7, 104, 112, 2, false, 96],
  ['h-bohm', 'Alec Bohm', 'PHI', 'ATL', 'game-003', 'R', 'R', 0.284, 0.162, 0.339, 15.3, 6.2, 42.9, 7.1, 70, 28, 4.7, 104, 112, 4, false, 94],
  ['h-altuve', 'Jose Altuve', 'HOU', 'TEX', 'game-004', 'R', 'R', 0.292, 0.201, 0.367, 16.9, 7.6, 40.7, 8.9, 79, 36, 7.4, 98, 96, 1, true, 97],
  ['h-bregman', 'Alex Bregman', 'HOU', 'TEX', 'game-004', 'R', 'R', 0.273, 0.191, 0.347, 13.7, 11.6, 38.9, 7.4, 74, 36, 7.4, 98, 96, 2, true, 95],
  ['h-alvarez', 'Yordan Alvarez', 'HOU', 'TEX', 'game-004', 'L', 'R', 0.306, 0.315, 0.435, 18.8, 13.4, 54.2, 18.6, 91, 36, 7.4, 98, 96, 3, true, 99],
  ['h-tucker', 'Kyle Tucker', 'HOU', 'TEX', 'game-004', 'L', 'R', 0.289, 0.254, 0.394, 15.1, 13.9, 46.9, 13.4, 88, 36, 7.4, 98, 96, 4, true, 98],
  ['h-semien', 'Marcus Semien', 'TEX', 'HOU', 'game-004', 'R', 'L', 0.279, 0.198, 0.356, 14.6, 8.7, 40.8, 8.2, 70, 34, 6.3, 98, 96, 1, true, 96],
  ['h-seager', 'Corey Seager', 'TEX', 'HOU', 'game-004', 'L', 'L', 0.271, 0.199, 0.349, 17.8, 9.5, 45.2, 11.9, 76, 34, 6.3, 98, 96, 2, true, 97],
  ['h-adolis', 'Adolis Garcia', 'TEX', 'HOU', 'game-004', 'R', 'L', 0.284, 0.248, 0.367, 28.3, 8.1, 48.1, 15.3, 73, 34, 6.3, 98, 96, 3, true, 95],
  ['h-langford', 'Wyatt Langford', 'TEX', 'HOU', 'game-004', 'R', 'L', 0.269, 0.223, 0.349, 23.4, 9.4, 45.6, 12.7, 78, 34, 6.3, 98, 96, 4, true, 93],
];

const pitcherRows: PitcherRow[] = [
  ['p-glasnow', 'Tyler Glasnow', 'LAD', 'ARI', 'game-001', 'R', 31.1, 7.4, 15.4, 31.2, 5.3, 88, 6.0, 21.2, 8.5, 63, 102, 74],
  ['p-gallen', 'Zac Gallen', 'ARI', 'LAD', 'game-001', 'R', 26.3, 6.9, 12.8, 35.1, 7.2, 79, 6.2, 20.6, 10.2, 81, 102, 59],
  ['p-cole', 'Gerrit Cole', 'NYY', 'BOS', 'game-002', 'R', 30.5, 6.1, 14.5, 29.6, 4.9, 90, 6.3, 23.9, 8.3, 61, 106, 73],
  ['p-bello', 'Brayan Bello', 'BOS', 'NYY', 'game-002', 'R', 21.4, 8.4, 10.7, 40.3, 9.2, 61, 5.6, 21.8, 9.5, 84, 106, 54],
  ['p-strider', 'Spencer Strider', 'ATL', 'PHI', 'game-003', 'R', 34.2, 8.2, 16.9, 32.4, 6.0, 86, 5.9, 22.7, 9.1, 71, 104, 69],
  ['p-wheeler', 'Zack Wheeler', 'PHI', 'ATL', 'game-003', 'R', 29.1, 5.4, 13.7, 30.5, 5.1, 91, 6.5, 23.5, 8.7, 76, 104, 71],
  ['p-valdez', 'Framber Valdez', 'HOU', 'TEX', 'game-004', 'L', 24.3, 8.1, 11.8, 34.4, 6.2, 78, 6.1, 20.9, 7.8, 68, 98, 67],
  ['p-eovaldi', 'Nathan Eovaldi', 'TEX', 'HOU', 'game-004', 'R', 24.6, 6.3, 12.1, 36.9, 7.8, 72, 5.9, 18.9, 9.4, 79, 98, 64],
];

const createLineupEntry = (
  hitter: RawHitterCandidate,
  status: LineupEntry['status'],
): LineupEntry => ({
  playerId: hitter.playerId,
  playerName: hitter.playerName,
  battingOrder: hitter.metrics.lineupSpot ?? 9,
  bats: hitter.bats,
  status,
});

export const createMockDailySlate = (analysisDate: string): RawDailySlate => {
  const gameMap = new Map(
    gameSeeds.map((seed) => [
      seed.gameId,
      {
        matchupId: `${seed.awayTeam}@${seed.homeTeam}`,
        matchupLabel: `${seed.awayTeam} @ ${seed.homeTeam}`,
      },
    ]),
  );

  const hitters: RawHitterCandidate[] = hitterRows.map((row) => {
    const [
      playerId,
      playerName,
      teamCode,
      opponentCode,
      gameId,
      bats,
      opposingPitcherHand,
      averageVsHandedness,
      isoVsHandedness,
      wobaVsHandedness,
      strikeoutRate,
      walkRate,
      hardHitRate,
      barrelRate,
      recentForm,
      opponentPitcherContactAllowed,
      opponentPitcherPowerAllowed,
      parkFactor,
      homeRunParkFactor,
      lineupSpot,
      lineupConfirmed,
      playingTimeConfidence,
    ] = row;
    const matchup = gameMap.get(gameId)!;

    return {
      playerId,
      playerName,
      team: teams[teamCode],
      opponent: teams[opponentCode],
      bats,
      opposingPitcherHand,
      gameId,
      matchupId: matchup.matchupId,
      matchupLabel: matchup.matchupLabel,
      notes: hitterNotes[playerId] ?? [],
      metrics: {
        averageVsHandedness,
        isoVsHandedness,
        wobaVsHandedness,
        strikeoutRate,
        walkRate,
        hardHitRate,
        barrelRate,
        recentForm,
        opponentPitcherContactAllowed,
        opponentPitcherPowerAllowed,
        parkFactor,
        homeRunParkFactor,
        lineupSpot,
        lineupConfirmed,
        playingTimeConfidence,
      },
      source: 'mock',
    };
  });

  const pitchers: RawPitcherCandidate[] = pitcherRows.map((row) => {
    const [
      playerId,
      playerName,
      teamCode,
      opponentCode,
      gameId,
      throwingHand,
      strikeoutRate,
      walkRate,
      swingingStrikeRate,
      hardHitAllowed,
      barrelAllowed,
      recentForm,
      inningsProjection,
      opponentStrikeoutRate,
      opponentWalkRate,
      opponentPowerRating,
      parkFactor,
      winSupportRating,
    ] = row;
    const matchup = gameMap.get(gameId)!;

    return {
      playerId,
      playerName,
      team: teams[teamCode],
      opponent: teams[opponentCode],
      throwingHand,
      gameId,
      matchupId: matchup.matchupId,
      matchupLabel: matchup.matchupLabel,
      notes: pitcherNotes[playerId] ?? [],
      metrics: {
        strikeoutRate,
        walkRate,
        swingingStrikeRate,
        hardHitAllowed,
        barrelAllowed,
        recentForm,
        inningsProjection,
        opponentStrikeoutRate,
        opponentWalkRate,
        opponentPowerRating,
        parkFactor,
        winSupportRating,
      },
      source: 'mock',
    };
  });

  const lineupsByGame = new Map<string, { away: LineupEntry[]; home: LineupEntry[] }>();

  for (const game of gameSeeds) {
    const away = hitters
      .filter((hitter) => hitter.gameId === game.gameId && hitter.team.abbreviation === game.awayTeam)
      .sort((left, right) => (left.metrics.lineupSpot ?? 9) - (right.metrics.lineupSpot ?? 9))
      .map((hitter) => createLineupEntry(hitter, hitter.metrics.lineupConfirmed ? 'confirmed' : 'projected'));
    const home = hitters
      .filter((hitter) => hitter.gameId === game.gameId && hitter.team.abbreviation === game.homeTeam)
      .sort((left, right) => (left.metrics.lineupSpot ?? 9) - (right.metrics.lineupSpot ?? 9))
      .map((hitter) => createLineupEntry(hitter, hitter.metrics.lineupConfirmed ? 'confirmed' : 'projected'));

    lineupsByGame.set(game.gameId, { away, home });
  }

  const games: RawGame[] = gameSeeds.map((seed) => {
    const lineups = lineupsByGame.get(seed.gameId) ?? { away: [], home: [] };

    return {
      gameId: seed.gameId,
      matchupId: `${seed.awayTeam}@${seed.homeTeam}`,
      gameDate: analysisDate,
      startTime: `${analysisDate}T${seed.startTime}`,
      matchupLabel: `${seed.awayTeam} @ ${seed.homeTeam}`,
      status: 'scheduled',
      awayTeam: teams[seed.awayTeam],
      homeTeam: teams[seed.homeTeam],
      venue: venues[seed.venue],
      probablePitchers: seed.probablePitchers,
      lineupStatus: seed.lineupStatus,
      lineups,
      weather: seed.weather,
      officials: seed.officials,
      source: 'mock',
    };
  });

  return {
    analysisDate,
    generatedAt: new Date().toISOString(),
    providerName: 'mock-seeded-slate',
    source: 'mock',
    notes: [
      'Using seeded matchup data for a full first-run MVP experience.',
      'Live schedule, lineups, weather, and recent stats can be enabled with DATA_PROVIDER=live.',
    ],
    games,
    hitters,
    pitchers,
  };
};
