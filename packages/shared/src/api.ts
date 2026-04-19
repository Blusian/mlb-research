import type {
  CacheStatus,
  DataSource,
  DailySlateModel,
  GameInfo,
  Handedness,
  HitterCandidate,
  HitterScoreType,
  PitcherCandidate,
  PitcherScoreType,
} from './domain.js';

export interface HitterScores {
  overallHitScore: number;
  homeRunUpsideScore: number;
  floorScore: number;
  riskScore: number;
  totalHitPotentialScore?: number;
  confidenceRating?: string;
  marketConfidence?: {
    hits: {
      score: number;
      confidenceRating: string;
    };
    runs: {
      score: number;
      confidenceRating: string;
    };
    rbi: {
      score: number;
      confidenceRating: string;
    };
    totalBases: {
      score: number;
      confidenceRating: string;
    };
    walks: {
      score: number;
      confidenceRating: string;
    };
  };
}

export interface PitcherScores {
  overallPitcherScore: number;
  strikeoutUpsideScore: number;
  safetyScore: number;
  blowupRiskScore: number;
  confidenceRating?: string;
}

export interface RankedHitter extends HitterCandidate {
  scores: HitterScores;
  reasons: string[];
}

export interface RankedPitcher extends PitcherCandidate {
  scores: PitcherScores;
  reasons: string[];
}

export interface AttackablePitcher extends RankedPitcher {
  attackScore: number;
  attackReasons: string[];
}

export interface HitterHomeRunProp {
  market: 'hitter_home_run';
  entityId: string;
  gameId: string;
  label: string;
  playerName: string;
  teamAbbreviation: string;
  opponentAbbreviation: string;
  matchupLabel: string;
  lineupSpot: number;
  lineupConfirmed: boolean;
  lineupSource: 'official' | 'projected';
  homeRunScore: number;
  blendedProbability: number;
  heuristicProbability: number;
  learnedProbability: number | null;
  modelType: 'heuristic' | 'learned_logistic_blend';
  trainingSamples: number;
  confidence: 'core' | 'strong' | 'watch';
  reasons: string[];
  metrics: {
    hardHitRate: number;
    barrelRate: number;
    averageBatSpeed: number;
    blastRate: number;
    squaredUpRate: number;
    batterVsPitcherPlateAppearances: number;
    batterVsPitcherOps: number;
    batterVsPitcherHomeRuns: number;
    batterVsPitcherScore: number;
    pitchMixMatchupScore: number;
    pitchMixMatchupSample: number;
    primaryPitchTypeDescription: string;
    primaryPitchUsage: number;
    secondaryPitchTypeDescription: string;
    secondaryPitchUsage: number;
    homeRunParkFactor: number;
    homeRunParkFactorVsHandedness: number;
    opponentPitcherPowerAllowed: number;
    recentForm: number;
  };
}

export interface PitcherLineProp {
  market: 'pitcher_walks' | 'pitcher_outs';
  entityId: string;
  gameId: string;
  label: string;
  playerName: string;
  teamAbbreviation: string;
  opponentAbbreviation: string;
  matchupLabel: string;
  lineupConfirmed: boolean;
  lineupSource: 'official' | 'projected' | 'mixed';
  marketScore: number;
  lineValue: number;
  projectionValue: number;
  meanValue?: number;
  medianValue?: number;
  deltaVsLine: number;
  overLineProbability?: number;
  underLineProbability?: number;
  confidenceScore?: number;
  uncertaintyScore?: number;
  modelType?: string;
  projectionLayer?: Record<string, number | string | boolean | null | undefined>;
  riskLayer?: Record<string, number | string | boolean | null | undefined>;
  featureSnapshotTimestamp?: string;
  dataQualityFlags?: string[];
  distribution?: Record<string, number>;
  confidence: 'elite' | 'strong' | 'watch' | 'thin';
  reasons: string[];
  metrics: {
    inningsProjection: number;
    projectedOuts: number;
    expectedBattersFaced: number;
    strikeoutRate: number;
    walkRate: number;
    opponentWalkRate: number;
    recentForm: number;
    roleCertainty: number;
    inningsVolatility: number;
    pitchCountCap: number;
    earlyExitRisk: number;
    lineupConfidence: number;
    trackedLineupSpots: number;
    confirmedLineupSpots: number;
    averagePitchCount?: number;
    lastPitchCount?: number;
    averageBattersFaced?: number;
    averageInningsPerStart?: number;
    pitchesPerPlateAppearance?: number;
    recentPitchesPerPlateAppearance?: number;
    recentWalkRate?: number;
    recentCommandTrend?: number;
    recentLeashTrend?: number;
    quickHookRisk?: number;
    walkParkFactor?: number;
    opponentChaseRate?: number;
    opponentPatienceScore?: number;
    framingSupportScore?: number;
    umpireZoneScore?: number;
    defenseSupportScore?: number;
    bullpenContextScore?: number;
    firstPitchStrikeRate?: number | null;
    zoneRate?: number | null;
    chaseInducedRate?: number | null;
    threeBallCountRate?: number | null;
    matchupAdjustedWalkRate?: number;
    projectionLayer?: Record<string, number | string | boolean | null | undefined>;
    riskLayer?: Record<string, number | string | boolean | null | undefined>;
  };
}

export interface PitcherStrikeoutProp {
  market: 'pitcher_strikeouts';
  entityId: string;
  gameId: string;
  label: string;
  playerName: string;
  teamAbbreviation: string;
  opponentAbbreviation: string;
  matchupLabel: string;
  lineupConfirmed: boolean;
  lineupSource: 'official' | 'projected' | 'mixed';
  strikeoutScore: number;
  lineValue?: number;
  projectionValue?: number;
  meanValue?: number;
  medianValue?: number;
  deltaVsLine?: number;
  overLineProbability?: number;
  underLineProbability?: number;
  confidenceScore?: number;
  uncertaintyScore?: number;
  modelType?: string;
  projectionLayer?: Record<string, number | string | boolean | null | undefined>;
  riskLayer?: Record<string, number | string | boolean | null | undefined>;
  featureSnapshotTimestamp?: string;
  dataQualityFlags?: string[];
  distribution?: Record<string, number>;
  projectedStrikeouts: number;
  meanKs: number;
  medianKs: number;
  over3_5Probability: number;
  over4_5Probability: number;
  inningsProjection: number;
  confidence: 'core' | 'strong' | 'watch';
  reasons: string[];
  metrics: {
    strikeoutRate: number;
    swingingStrikeRate: number;
    opponentStrikeoutRate: number;
    lineupVsPitcherHandKRate: number;
    pitchMixAdvantageScore: number;
    opponentLineupCount: number;
    opponentConfirmedHitterCount: number;
    opponentLineupConfidenceScore: number;
    strikeoutParkFactor: number;
    walkRate: number;
    projectionLayer: {
      trueTalentKAbility: number;
      opponentKTendencies: number;
      umpireParkLineup: number;
      expectedBattersFaced: number;
      lineupVsPitcherHandKRate: number;
      matchupAdjustedKRate: number;
      pitchMixAdvantage: number;
      lineupConfidence: number;
      trackedLineupSpots: number;
      confirmedLineupSpots: number;
    };
    riskLayer: {
      roleCertainty: number;
      inningsVolatility: number;
      pitchCountCap: number;
      earlyExitRisk: number;
      recentWorkload: number;
      contactHeavyOpponentPenalty: number;
    };
  };
}

export interface HitterStatProp {
  market:
    | 'hitter_hits'
    | 'hitter_runs'
    | 'hitter_rbis'
    | 'hitter_total_bases'
    | 'hitter_walks';
  entityId: string;
  gameId: string;
  label: string;
  playerName: string;
  teamAbbreviation: string;
  opponentAbbreviation: string;
  matchupLabel: string;
  lineupSpot: number;
  lineupConfirmed: boolean;
  lineupSource: 'official' | 'projected';
  marketScore: number;
  lineValue: number;
  projectionValue: number;
  meanValue?: number;
  medianValue?: number;
  deltaVsLine: number;
  overLineProbability?: number;
  underLineProbability?: number;
  confidenceScore?: number;
  uncertaintyScore?: number;
  modelType?: string;
  projectionLayer?: Record<string, number | string | boolean | null | undefined>;
  riskLayer?: Record<string, number | string | boolean | null | undefined>;
  featureSnapshotTimestamp?: string;
  dataQualityFlags?: string[];
  distribution?: Record<string, number>;
  confidence: 'elite' | 'strong' | 'watch' | 'thin';
  reasons: string[];
  metrics: {
    averageVsHandedness: number;
    obpVsHandedness: number;
    sluggingVsHandedness: number;
    isoVsHandedness: number;
    walkRate: number;
    strikeoutRate: number;
    recentForm: number;
    batterVsPitcherScore: number;
    pitchMixMatchupScore: number;
    opponentPitcherContactAllowed: number;
    opponentPitcherWalkRateAllowed: number;
    parkFactorVsHandedness: number;
    hitParkFactorVsHandedness: number;
    walkParkFactorVsHandedness: number;
    projectedPlateAppearances: number;
    seasonGrowthPercent?: number;
    isRookieSeason?: boolean;
    rookieSeasonWarning?: string;
  };
}

export type PlayerRole = 'hitter' | 'pitcher';

export interface PlayerDetailStat {
  key: string;
  label: string;
  value: string | number | boolean | null;
}

export interface PlayerRecentGame {
  gameDate: string;
  opponentLabel: string;
  summary: string;
  statItems: PlayerDetailStat[];
}

export interface PlayerLineupMatchup {
  playerId: string;
  playerName: string;
  teamAbbreviation: string;
  battingOrder: number;
  bats: Handedness;
  position?: string;
  status: 'confirmed' | 'projected';
  hitterScore: number;
  homeRunUpsideScore: number;
  recentForm: number;
  pitchMixMatchupScore: number;
  batterVsPitcher: {
    plateAppearances: number;
    ops: number;
    homeRuns: number;
    strikeoutRate: number;
    score: number;
  };
}

export interface PitchArsenalPitch {
  code: string;
  description: string;
  usage: number;
  averageSpeed: number;
  count: number;
}

export type SelectedPropType =
  | 'game_total_runs'
  | 'pitcher_strikeouts'
  | 'pitcher_walks'
  | 'pitcher_outs'
  | 'hitter_home_run'
  | 'hitter_hits'
  | 'hitter_runs'
  | 'hitter_rbis'
  | 'hitter_total_bases'
  | 'hitter_walks';

export type SelectionSide = 'over' | 'under';

export interface SelectedProp {
  id: string;
  date: string;
  gameId: string;
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  matchupLabel?: string | null;
  propType: SelectedPropType;
  selectionSide: SelectionSide;
  selectionLabel?: string | null;
  lineValue?: number | null;
  projectionValue?: number | null;
  confidence?: string | null;
  explanationSummary?: string | null;
  status: string;
  createdAt: string;
}

export interface CreateSelectedPropInput {
  date: string;
  gameId: string;
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  matchupLabel?: string | null;
  propType: SelectedPropType;
  selectionSide?: SelectionSide;
  selectionLabel?: string | null;
  lineValue?: number | null;
  projectionValue?: number | null;
  confidence?: string | null;
  explanationSummary?: string | null;
}

export interface LiveSelectedProp {
  selectedPropId: string;
  date: string;
  gameId: string;
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  matchupLabel?: string | null;
  propType: SelectedPropType;
  selectionSide: SelectionSide;
  selectionLabel?: string | null;
  confidence?: string | null;
  explanationSummary?: string | null;
  gameStatus: string;
  gameStartTime?: string | null;
  isLive: boolean;
  inningState?: string | null;
  inningNumber?: number | null;
  outs?: number | null;
  scoreLabel?: string | null;
  currentValue: number;
  targetLine?: number | null;
  projectionValue?: number | null;
  deltaVsLine?: number | null;
  paceVsLine?: number | null;
  paceVsProjection?: number | null;
  remainingToClear?: number | null;
  isCleared: boolean;
  isLost: boolean;
  resultStatus: string;
  paceStatus: string;
  statBreakdown: Record<string, string | number | boolean | null | undefined>;
  lastUpdatedAt: string;
}

export interface DailyPropBoards {
  hitterHomeRuns: HitterHomeRunProp[];
  hitterHits: HitterStatProp[];
  hitterRuns: HitterStatProp[];
  hitterRbis: HitterStatProp[];
  hitterTotalBases: HitterStatProp[];
  hitterWalks: HitterStatProp[];
  pitcherStrikeouts: PitcherStrikeoutProp[];
  pitcherWalks: PitcherLineProp[];
  pitcherOuts: PitcherLineProp[];
}

export interface DailyAnalysisMeta {
  analysisDate: string;
  generatedAt: string;
  source: DailySlateModel['source'];
  providerName: string;
  cacheStatus: CacheStatus;
  notes: string[];
}

export interface PlayerDetailMeta {
  analysisDate: string;
  generatedAt: string;
  source: DataSource;
  cacheStatus: CacheStatus;
  role: PlayerRole;
  notes: string[];
}

export interface DailyAnalysisFilters {
  teams: string[];
  matchups: Array<{
    value: string;
    label: string;
  }>;
  handedness: Handedness[];
  hitterScoreTypes: HitterScoreType[];
  pitcherScoreTypes: PitcherScoreType[];
}

export interface DailyAnalysisResponse {
  meta: DailyAnalysisMeta;
  filters: DailyAnalysisFilters;
  games: DailySlateModel['games'];
  props: DailyPropBoards;
  rankings: {
    hitters: RankedHitter[];
    homeRunCandidates: RankedHitter[];
    hittersToAvoid: RankedHitter[];
    pitchers: RankedPitcher[];
    pitchersToAttack: AttackablePitcher[];
  };
}

export interface PlayerDetailResponse {
  meta: PlayerDetailMeta;
  player: RankedHitter | RankedPitcher;
  game: GameInfo | null;
  overviewStats: PlayerDetailStat[];
  matchupStats: PlayerDetailStat[];
  recentGames: PlayerRecentGame[];
  lineupMatchups: PlayerLineupMatchup[];
  pitchArsenal: PitchArsenalPitch[];
}

export interface DailyAnalysisQuery {
  date?: string;
  team?: string;
  matchup?: string;
  handedness?: Handedness | 'ALL';
  hitterScoreType?: HitterScoreType;
  pitcherScoreType?: PitcherScoreType;
}
