import type { Handedness } from '@mlb-analyzer/shared';

import { parseDecimal, parseNumber } from '../providers/live/statsApiUtils.js';
import { fetchText, parseCsvRows } from './http.js';

interface SavantQueryOptions {
  playerType: 'batter' | 'pitcher';
  season: string;
  dateFrom: string;
  dateTo: string;
  pitcherThrows?: 'R' | 'L';
  batterStands?: 'R' | 'L';
}

export interface SavantStatRow {
  playerId: string;
  playerName: string;
  ba: number;
  iso: number;
  woba: number;
  xwoba: number;
  xba: number;
  xslg: number;
  hardHitRate: number;
  barrelRate: number;
  averageExitVelocity: number;
  strikeoutRate: number;
  walkRate: number;
  swingMissRate: number;
  plateAppearances: number;
  homeRuns: number;
}

export interface SavantHitterProfile {
  overall?: SavantStatRow;
  vsRight?: SavantStatRow;
  vsLeft?: SavantStatRow;
}

export interface SavantPitcherProfile {
  overall?: SavantStatRow;
  vsRight?: SavantStatRow;
  vsLeft?: SavantStatRow;
}

export interface SavantBatTrackingProfile {
  playerId: string;
  playerName: string;
  averageBatSpeed: number;
  hardSwingRate: number;
  squaredUpRate: number;
  blastRate: number;
  swingLength: number;
  batterRunValue: number;
  whiffPerSwing: number;
  battedBallEventPerSwing: number;
  swords: number;
}

const buildQueryString = (options: SavantQueryOptions): string => {
  const params = new URLSearchParams({
    all: 'true',
    game_date_gt: options.dateFrom,
    game_date_lt: options.dateTo,
    group_by: 'name',
    hfGT: 'R|',
    hfSea: `${options.season}|`,
    min_pas: '0',
    min_pitches: '0',
    min_results: '0',
    player_type: options.playerType,
    sort_col: 'pitches',
    sort_order: 'desc',
  });

  if (options.pitcherThrows) {
    params.set('pitcher_throws', options.pitcherThrows);
  }

  if (options.batterStands) {
    params.set('batter_stands', options.batterStands);
  }

  return params.toString();
};

const toRecord = (headers: string[], values: string[]): Record<string, string> =>
  Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));

const toSavantStatRow = (record: Record<string, string>): SavantStatRow | null => {
  const playerId = record.player_id;

  if (!playerId) {
    return null;
  }

  return {
    playerId,
    playerName: record.player_name ?? 'Unknown Player',
    ba: parseDecimal(record.ba, 0.245),
    iso: parseDecimal(record.iso, 0.165),
    woba: parseDecimal(record.woba, 0.315),
    xwoba: parseDecimal(record.xwoba, 0.32),
    xba: parseDecimal(record.xba, 0.245),
    xslg: parseDecimal(record.xslg, 0.405),
    hardHitRate: parseNumber(record.hardhit_percent, 38),
    barrelRate: parseNumber(record.barrels_per_bbe_percent, 7),
    averageExitVelocity: parseNumber(record.launch_speed, 89),
    strikeoutRate: parseNumber(record.k_percent, 22),
    walkRate: parseNumber(record.bb_percent, 8),
    swingMissRate: parseNumber(record.swing_miss_percent, 24),
    plateAppearances: parseNumber(record.pa, 0),
    homeRuns: parseNumber(record.hrs, 0),
  };
};

const mergeProfiles = <T extends SavantHitterProfile | SavantPitcherProfile>(
  overall: Map<string, SavantStatRow>,
  versusRight: Map<string, SavantStatRow>,
  versusLeft: Map<string, SavantStatRow>,
): Map<string, T> => {
  const merged = new Map<string, T>();
  const ids = new Set([...overall.keys(), ...versusRight.keys(), ...versusLeft.keys()]);

  ids.forEach((playerId) => {
    merged.set(playerId, {
      overall: overall.get(playerId),
      vsRight: versusRight.get(playerId),
      vsLeft: versusLeft.get(playerId),
    } as T);
  });

  return merged;
};

const toBatTrackingProfile = (
  record: Record<string, string>,
): SavantBatTrackingProfile | null => {
  const playerId = record.id;

  if (!playerId) {
    return null;
  }

  return {
    playerId,
    playerName: record.name ?? 'Unknown Player',
    averageBatSpeed: parseNumber(record.avg_bat_speed, 72),
    hardSwingRate: parseNumber(record.hard_swing_rate, 18),
    squaredUpRate: parseNumber(record.squared_up_per_bat_contact, 28),
    blastRate: parseNumber(record.blast_per_bat_contact, 8),
    swingLength: parseNumber(record.swing_length, 7.2),
    batterRunValue: parseNumber(record.batter_run_value, 0),
    whiffPerSwing: parseNumber(record.whiff_per_swing, 28),
    battedBallEventPerSwing: parseNumber(record.batted_ball_event_per_swing, 32),
    swords: parseNumber(record.swords, 0),
  };
};

export class BaseballSavantSource {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async getHitterProfiles(date: string): Promise<Map<string, SavantHitterProfile>> {
    const season = date.slice(0, 4);
    const dateFrom = `${season}-03-01`;
    const [overall, versusRight, versusLeft] = await Promise.all([
      this.fetchLeaderboard({
        playerType: 'batter',
        season,
        dateFrom,
        dateTo: date,
      }),
      this.fetchLeaderboard({
        playerType: 'batter',
        season,
        dateFrom,
        dateTo: date,
        pitcherThrows: 'R',
      }),
      this.fetchLeaderboard({
        playerType: 'batter',
        season,
        dateFrom,
        dateTo: date,
        pitcherThrows: 'L',
      }),
    ]);

    return mergeProfiles<SavantHitterProfile>(overall, versusRight, versusLeft);
  }

  public async getPitcherProfiles(date: string): Promise<Map<string, SavantPitcherProfile>> {
    const season = date.slice(0, 4);
    const dateFrom = `${season}-03-01`;
    const [overall, versusRight, versusLeft] = await Promise.all([
      this.fetchLeaderboard({
        playerType: 'pitcher',
        season,
        dateFrom,
        dateTo: date,
      }),
      this.fetchLeaderboard({
        playerType: 'pitcher',
        season,
        dateFrom,
        dateTo: date,
        batterStands: 'R',
      }),
      this.fetchLeaderboard({
        playerType: 'pitcher',
        season,
        dateFrom,
        dateTo: date,
        batterStands: 'L',
      }),
    ]);

    return mergeProfiles<SavantPitcherProfile>(overall, versusRight, versusLeft);
  }

  public async getBatTrackingProfiles(
    date: string,
  ): Promise<Map<string, SavantBatTrackingProfile>> {
    const season = date.slice(0, 4);
    const params = new URLSearchParams({
      csv: 'true',
      gameType: 'Regular',
      minGroupSwings: '1',
      minSwings: '1',
      seasonStart: season,
      seasonEnd: season,
      type: 'batter',
    });
    const csv = await fetchText(
      `${this.baseUrl}/leaderboard/bat-tracking?${params.toString()}`,
      this.timeoutMs,
    );
    const rows = parseCsvRows(csv);

    if (rows.length <= 1) {
      return new Map();
    }

    const [headers, ...dataRows] = rows;

    if (!headers) {
      return new Map();
    }

    const normalizedHeaders = headers.map((header) => header.replace(/^\uFEFF/, ''));
    const parsedRows = dataRows
      .map((row) => toBatTrackingProfile(toRecord(normalizedHeaders, row)))
      .filter((row): row is SavantBatTrackingProfile => Boolean(row));

    return new Map(parsedRows.map((row) => [row.playerId, row]));
  }

  public getSplit(profile: SavantHitterProfile | SavantPitcherProfile | undefined, handedness: Handedness): SavantStatRow | undefined {
    if (!profile) {
      return undefined;
    }

    if (handedness === 'L') {
      return profile.vsLeft ?? profile.overall;
    }

    if (handedness === 'R') {
      return profile.vsRight ?? profile.overall;
    }

    return profile.overall;
  }

  private async fetchLeaderboard(options: SavantQueryOptions): Promise<Map<string, SavantStatRow>> {
    const csv = await fetchText(
      `${this.baseUrl}/statcast_search/csv?${buildQueryString(options)}`,
      this.timeoutMs,
    );
    const rows = parseCsvRows(csv);

    if (rows.length <= 1) {
      return new Map();
    }

    const [headers, ...dataRows] = rows;

    if (!headers) {
      return new Map();
    }

    const normalizedHeaders = headers.map((header) => header.replace(/^\uFEFF/, ''));
    const parsedRows = dataRows
      .map((row) => toSavantStatRow(toRecord(normalizedHeaders, row)))
      .filter((row): row is SavantStatRow => Boolean(row));

    return new Map(parsedRows.map((row) => [row.playerId, row]));
  }
}
