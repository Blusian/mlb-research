export type Handedness = 'R' | 'L' | 'S' | 'U';
export type DataSource = 'mock' | 'live' | 'hybrid';
export type CacheStatus = 'hit' | 'miss';
export type HitterScoreType =
  | 'overall_hit_score'
  | 'home_run_upside_score'
  | 'floor_score'
  | 'risk_score';
export type PitcherScoreType =
  | 'overall_pitcher_score'
  | 'strikeout_upside_score'
  | 'safety_score'
  | 'blowup_risk_score';

export interface TeamInfo {
  id: string;
  city: string;
  name: string;
  abbreviation: string;
}

export interface VenueInfo {
  name: string;
  city: string;
  parkFactor: number;
  homeRunFactor: number;
  roof?: 'open' | 'closed' | 'retractable';
}

export interface ProbablePitcherInfo {
  playerId: string;
  name: string;
  throwingHand: Handedness;
}

export interface WeatherInfo {
  condition: string;
  temperatureF?: number;
  wind?: string;
  precipitationProbability?: number;
}

export interface OfficialInfo {
  type: string;
  name: string;
  id?: string;
}

export interface LineupEntry {
  playerId: string;
  playerName: string;
  battingOrder: number;
  bats: Handedness;
  position?: string;
  status: 'confirmed' | 'projected';
}

export interface TeamRunProjection {
  teamAbbreviation: string;
  projectedRuns: number;
  offensiveQuality: number;
  matchupQuality: number;
  opposingPitcherResistance: number;
  environmentScore: number;
  lineupConfidence: number;
  reasons: string[];
}

export interface GameRunProjection {
  away: TeamRunProjection;
  home: TeamRunProjection;
  totalRuns: number;
  baselineTotal: number;
  edgeVsBaseline: number;
  runEnvironmentScore: number;
  overUnderLean: 'over' | 'under' | 'neutral';
  confidenceRating: 'elite' | 'strong' | 'watch' | 'thin';
  summary: string;
  reasons: string[];
}

export interface GameInfo {
  gameId: string;
  matchupId: string;
  gameDate: string;
  startTime: string;
  matchupLabel: string;
  status: 'scheduled' | 'in_progress' | 'final';
  awayTeam: TeamInfo;
  homeTeam: TeamInfo;
  venue: VenueInfo;
  probablePitchers: {
    away?: ProbablePitcherInfo;
    home?: ProbablePitcherInfo;
  };
  lineupStatus: 'confirmed' | 'projected' | 'partial';
  lineups: {
    away: LineupEntry[];
    home: LineupEntry[];
  };
  weather?: WeatherInfo;
  officials: OfficialInfo[];
  runProjection?: GameRunProjection;
  source: DataSource;
}

export interface HitterMetricSet {
  averageVsHandedness: number;
  obpVsHandedness?: number;
  sluggingVsHandedness?: number;
  opsVsHandedness?: number;
  isoVsHandedness: number;
  wobaVsHandedness: number;
  xwobaVsHandedness: number;
  xbaVsHandedness: number;
  xslgVsHandedness: number;
  strikeoutRate: number;
  walkRate: number;
  hardHitRate: number;
  barrelRate: number;
  averageExitVelocity: number;
  averageBatSpeed: number;
  hardSwingRate: number;
  squaredUpRate: number;
  blastRate: number;
  swingLength: number;
  batTrackingRunValue: number;
  recentForm: number;
  opponentPitcherContactAllowed: number;
  opponentPitcherWalkRateAllowed?: number;
  opponentPitcherPowerAllowed: number;
  batterVsPitcherPlateAppearances: number;
  batterVsPitcherOps: number;
  batterVsPitcherHomeRuns: number;
  batterVsPitcherStrikeoutRate: number;
  batterVsPitcherScore: number;
  pitchMixMatchupScore: number;
  pitchMixMatchupSample: number;
  primaryPitchTypeCode: string;
  primaryPitchTypeDescription: string;
  primaryPitchUsage: number;
  secondaryPitchTypeCode: string;
  secondaryPitchTypeDescription: string;
  secondaryPitchUsage: number;
  parkFactor: number;
  parkFactorVsHandedness: number;
  hitParkFactorVsHandedness: number;
  singleParkFactorVsHandedness: number;
  doubleParkFactorVsHandedness: number;
  tripleParkFactorVsHandedness: number;
  homeRunParkFactor: number;
  homeRunParkFactorVsHandedness: number;
  walkParkFactorVsHandedness: number;
  strikeoutParkFactorVsHandedness: number;
  lineupSpot: number;
  lineupConfirmed: boolean;
  lineupSource?: 'official' | 'projected';
  playingTimeConfidence: number;
  currentSplitPlateAppearances?: number;
  previousSeasonsPlateAppearances?: number;
  careerPlateAppearances?: number;
  historicalConfidenceScore?: number;
  seasonGrowthPercent?: number;
  isRookieSeason?: boolean;
  rookieSeasonWarning?: string;
}

export interface PitcherMetricSet {
  strikeoutRate: number;
  walkRate: number;
  swingingStrikeRate: number;
  calledStrikePlusWhiffRate?: number;
  hardHitAllowed: number;
  barrelAllowed: number;
  xwobaAllowed: number;
  xbaAllowed: number;
  xslgAllowed: number;
  averageExitVelocityAllowed: number;
  homeRunRateAllowed?: number;
  groundBallRate?: number;
  flyBallRate?: number;
  recentForm: number;
  inningsProjection: number;
  battersFaced?: number;
  gamesStarted?: number;
  recentBattersFaced?: number;
  averageBattersFaced?: number;
  averageInningsPerStart?: number;
  recentInningsStd?: number;
  averagePitchCount?: number;
  lastPitchCount?: number;
  pitchesPerPlateAppearance?: number;
  recentPitchesPerPlateAppearance?: number;
  recentWalkRate?: number;
  recentCommandTrend?: number;
  recentLeashTrend?: number;
  quickHookRisk?: number;
  walkParkFactor?: number;
  firstPitchStrikeRate?: number | null;
  zoneRate?: number | null;
  chaseInducedRate?: number | null;
  threeBallCountRate?: number | null;
  opponentStrikeoutRate: number;
  lineupStrikeoutRateVsHand?: number;
  opponentWalkRate: number;
  opponentChaseRate?: number;
  opponentPatienceScore?: number;
  opponentPowerRating: number;
  opponentContactQuality?: number;
  pitchMixAdvantageScore?: number;
  opponentLineupConfirmed?: boolean;
  opponentLineupSource?: 'official' | 'projected' | 'mixed';
  opponentLineupCount?: number;
  opponentConfirmedHitterCount?: number;
  opponentLineupConfidenceScore?: number;
  timesThroughOrderPenalty?: number;
  projectedStrikeoutsVsOpponent?: number;
  medianStrikeoutsVsOpponent?: number;
  projectedBattersFaced?: number;
  matchupAdjustedKRate?: number;
  lineupVsPitcherHandKRate?: number;
  defenseSupportScore?: number;
  bullpenContextScore?: number;
  framingSupportScore?: number;
  umpireZoneScore?: number;
  parkFactor: number;
  homeRunParkFactor: number;
  strikeoutParkFactor: number;
  winSupportRating: number;
  previousSeasonsBattersFaced?: number;
  careerBattersFaced?: number;
  historicalConfidenceScore?: number;
  seasonGrowthPercent?: number;
  isRookieSeason?: boolean;
  rookieSeasonWarning?: string;
}

export interface HitterCandidate {
  playerId: string;
  playerName: string;
  team: TeamInfo;
  opponent: TeamInfo;
  bats: Handedness;
  opposingPitcherHand: Handedness;
  gameId: string;
  matchupId: string;
  matchupLabel: string;
  metrics: HitterMetricSet;
  notes: string[];
  source: DataSource;
}

export interface PitcherCandidate {
  playerId: string;
  playerName: string;
  team: TeamInfo;
  opponent: TeamInfo;
  throwingHand: Handedness;
  gameId: string;
  matchupId: string;
  matchupLabel: string;
  metrics: PitcherMetricSet;
  notes: string[];
  source: DataSource;
}

export interface DailySlateModel {
  analysisDate: string;
  generatedAt: string;
  providerName: string;
  source: DataSource;
  notes: string[];
  games: GameInfo[];
  hitters: HitterCandidate[];
  pitchers: PitcherCandidate[];
}
