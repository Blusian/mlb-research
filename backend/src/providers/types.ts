import type {
  DataSource,
  GameInfo,
  HitterCandidate,
  HitterMetricSet,
  PitcherCandidate,
  PitcherMetricSet,
} from '@mlb-analyzer/shared';

export interface RawGame extends Omit<GameInfo, 'source'> {
  source?: DataSource;
}

export interface RawHitterCandidate extends Omit<HitterCandidate, 'metrics' | 'notes' | 'source'> {
  metrics: Partial<HitterMetricSet>;
  notes?: string[];
  source?: DataSource;
}

export interface RawPitcherCandidate extends Omit<PitcherCandidate, 'metrics' | 'notes' | 'source'> {
  metrics: Partial<PitcherMetricSet>;
  notes?: string[];
  source?: DataSource;
}

export interface RawDailySlate {
  analysisDate: string;
  generatedAt?: string;
  providerName: string;
  source: DataSource;
  notes?: string[];
  games: RawGame[];
  hitters: RawHitterCandidate[];
  pitchers: RawPitcherCandidate[];
}

export interface DailyDataProvider {
  readonly name: string;
  getDailySlate(date: string): Promise<RawDailySlate>;
}
