import type { DailyAnalysisResponse } from '@mlb-analyzer/shared';

export type BacktestMarket =
  | 'game_moneyline_home'
  | 'hitter_home_run'
  | 'pitcher_strikeouts'
  | 'pitcher_walks'
  | 'pitcher_outs';

export type MarketSelection =
  | 'home'
  | 'away'
  | 'yes'
  | 'no'
  | 'over'
  | 'under';

export type PredictionMetadataValue = string | number | boolean | null;

export interface AnalysisSnapshot {
  analysisDate: string;
  capturedAt: string;
  providerName: string;
  source: DailyAnalysisResponse['meta']['source'];
  analysis: DailyAnalysisResponse;
}

export interface ResolvedGameResult {
  analysisDate: string;
  gameId: string;
  matchupId: string;
  matchupLabel: string;
  awayTeamAbbreviation: string;
  homeTeamAbbreviation: string;
  awayRuns: number;
  homeRuns: number;
  totalRuns: number;
  homeWon: boolean;
}

export interface ResolvedHitterResult {
  analysisDate: string;
  gameId: string;
  playerId: string;
  playerName: string;
  teamAbbreviation: string;
  homeRuns: number;
  hits: number;
  walks: number;
  strikeouts: number;
  atBats: number;
  plateAppearances: number;
}

export interface ResolvedPitcherResult {
  analysisDate: string;
  gameId: string;
  playerId: string;
  playerName: string;
  teamAbbreviation: string;
  strikeouts: number;
  walks: number;
  earnedRuns: number;
  hitsAllowed: number;
  inningsPitched: number;
  wonGame: boolean;
}

export interface ResolvedDailyResults {
  analysisDate: string;
  capturedAt: string;
  source: 'mlb_stats_api';
  notes: string[];
  games: ResolvedGameResult[];
  hitters: ResolvedHitterResult[];
  pitchers: ResolvedPitcherResult[];
}

export interface OddsRecord {
  analysisDate: string;
  market: BacktestMarket;
  entityId: string;
  gameId: string;
  selection: MarketSelection;
  line?: number;
  decimalOdds: number;
  impliedProbability: number;
  americanOdds?: number;
  sportsbook?: string;
  capturedAt: string;
  isClosing: boolean;
}

export interface DerivedPrediction {
  analysisDate: string;
  market: BacktestMarket;
  entityId: string;
  gameId: string;
  label: string;
  selection: MarketSelection;
  rawScore: number;
  rawProbability: number;
  line?: number;
  decimalOdds?: number;
  impliedProbability?: number;
  sportsbook?: string;
  metadata: Record<string, PredictionMetadataValue>;
}

export interface SettledPrediction extends DerivedPrediction {
  outcome: 0 | 1;
  resolvedValue?: number;
  calibratedProbability?: number;
  edge?: number;
}

export interface ProbabilityMetrics {
  sampleSize: number;
  averageProbability: number;
  actualRate: number;
  brierScore: number;
  logLoss: number;
}

export interface ReliabilityBucket {
  lowerBound: number;
  upperBound: number;
  count: number;
  averageProbability: number;
  actualRate: number;
}

export interface BettingStrategyReport {
  eligiblePredictions: number;
  betsPlaced: number;
  unitsRisked: number;
  unitsWon: number;
  roi: number;
  averageEdge: number;
  averageImpliedProbability: number;
  hitRate: number;
}

export interface BacktestReport {
  market: BacktestMarket;
  sampleSize: number;
  dates: string[];
  raw: ProbabilityMetrics;
  calibrated: ProbabilityMetrics;
  rawReliability: ReliabilityBucket[];
  calibratedReliability: ReliabilityBucket[];
  strategy?: BettingStrategyReport;
  assumptions: string[];
}

export interface BacktestOptions {
  market: BacktestMarket;
  minEdge: number;
  minCalibrationSamples: number;
}
