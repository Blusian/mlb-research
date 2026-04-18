import { parseNumber } from '../providers/live/statsApiUtils.js';
import { parseCsvRows } from '../sources/http.js';
import type { AnalysisSnapshot, BacktestMarket, MarketSelection, OddsRecord } from './types.js';

const normalizeHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/[\s-]+/g, '_');

const normalizeName = (value: string | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const teamAliases: Record<string, string> = {
  ARIZONADIAMONDBACKS: 'ARI',
  ATLANTABRAVES: 'ATL',
  BALTIMOREORIOLES: 'BAL',
  BOSTONREDSOX: 'BOS',
  CHICAGOCUBS: 'CHC',
  CHICAGOWHITESOX: 'CWS',
  CINCINNATIREDS: 'CIN',
  CLEVELANDGUARDIANS: 'CLE',
  COLORADOROCKIES: 'COL',
  DETROITTIGERS: 'DET',
  HOUSTONASTROS: 'HOU',
  KANSASCITYROYALS: 'KC',
  LOSANGELESANGELS: 'LAA',
  LOSANGELESDODGERS: 'LAD',
  MIAMIMARLINS: 'MIA',
  MILWAUKEEBREWERS: 'MIL',
  MINNESOTATWINS: 'MIN',
  NEWYORKMETS: 'NYM',
  NEWYORKYANKEES: 'NYY',
  ATHLETICS: 'ATH',
  OAKLANDATHLETICS: 'OAK',
  PHILADELPHIAPHILLIES: 'PHI',
  PITTSBURGHPIRATES: 'PIT',
  SANDIEGOPADRES: 'SD',
  SANFRANCISCOGIANTS: 'SF',
  SEATTLEMARINERS: 'SEA',
  STLOUISCARDINALS: 'STL',
  TAMPABAYRAYS: 'TB',
  TEXASRANGERS: 'TEX',
  TORONTOBLUEJAYS: 'TOR',
  WASHINGTONNATIONALS: 'WAS',
};

const normalizeTeam = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim().toUpperCase();

  if (!trimmed) {
    return '';
  }

  if (trimmed.length <= 3) {
    return trimmed;
  }

  return teamAliases[trimmed.replace(/[^A-Z]/g, '')] ?? trimmed;
};

const parseBoolean = (value: string | undefined): boolean =>
  ['1', 'true', 'yes', 'y', 'close', 'closing'].includes(
    value?.trim().toLowerCase() ?? '',
  );

export const americanToDecimalOdds = (americanOdds: number): number => {
  if (!Number.isFinite(americanOdds) || americanOdds === 0) {
    return 0;
  }

  if (americanOdds > 0) {
    return 1 + americanOdds / 100;
  }

  return 1 + 100 / Math.abs(americanOdds);
};

export const decimalToImpliedProbability = (decimalOdds: number): number =>
  decimalOdds > 1 ? 1 / decimalOdds : 0;

const parseMarket = (value: string | undefined): BacktestMarket => {
  switch (value?.trim().toLowerCase()) {
    case 'moneyline':
    case 'game_moneyline':
    case 'game_moneyline_home':
      return 'game_moneyline_home';
    case 'home_run':
    case 'hitter_home_run':
      return 'hitter_home_run';
    case 'pitcher_strikeouts':
    case 'strikeouts':
    case 'pitcher_k':
    case 'pitcher_ks':
      return 'pitcher_strikeouts';
    case 'pitcher_walks':
    case 'walks':
    case 'pitcher_bb':
      return 'pitcher_walks';
    case 'pitcher_outs':
    case 'outs':
    case 'outs_recorded':
      return 'pitcher_outs';
    default:
      throw new Error(`Unsupported market value: ${value ?? '(blank)'}`);
  }
};

const parseSelection = (value: string | undefined): MarketSelection => {
  switch (value?.trim().toLowerCase()) {
    case 'home':
      return 'home';
    case 'away':
      return 'away';
    case 'yes':
    case 'to_hit_home_run':
    case 'hr_yes':
      return 'yes';
    case 'no':
    case 'hr_no':
      return 'no';
    case 'over':
    case 'o':
      return 'over';
    case 'under':
    case 'u':
      return 'under';
    default:
      throw new Error(`Unsupported selection value: ${value ?? '(blank)'}`);
  }
};

interface ParsedOddsRow {
  analysisDate: string;
  market: BacktestMarket;
  entityId?: string;
  gameId?: string;
  selection: MarketSelection;
  line?: number;
  decimalOdds: number;
  impliedProbability: number;
  americanOdds?: number;
  sportsbook?: string;
  capturedAt: string;
  isClosing: boolean;
  entityName?: string;
  teamAbbreviation?: string;
  opponentAbbreviation?: string;
  homeTeamAbbreviation?: string;
  awayTeamAbbreviation?: string;
  matchup?: string;
}

const parseMatchup = (
  value: string | undefined,
): { awayTeamAbbreviation?: string; homeTeamAbbreviation?: string } => {
  const normalized = value?.trim().toUpperCase();

  if (!normalized) {
    return {};
  }

  const [awayTeamAbbreviation, homeTeamAbbreviation] = normalized
    .replace(/\s+/g, '')
    .split('@');

  if (!awayTeamAbbreviation || !homeTeamAbbreviation) {
    return {};
  }

  return {
    awayTeamAbbreviation,
    homeTeamAbbreviation,
  };
};

export const parseOddsCsv = (csv: string): ParsedOddsRow[] => {
  const rows = parseCsvRows(csv);

  if (rows.length <= 1) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map(normalizeHeader);

  return dataRows.map((row) => {
    const record = Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? '']),
    );
    const analysisDate =
      record.analysis_date?.trim() || record.date?.trim() || record.game_date?.trim();
    const market = parseMarket(record.market);
    const selection = parseSelection(record.selection);
    const entityId =
      record.entity_id?.trim() || record.player_id?.trim() || record.team_id?.trim() || undefined;
    const gameId = record.game_id?.trim() || undefined;
    const line =
      record.line?.trim() || record.points?.trim()
        ? parseNumber(record.line || record.points)
        : undefined;
    const americanOdds =
      record.american_odds?.trim() || record.price?.trim()
        ? parseNumber(record.american_odds || record.price)
        : undefined;
    const decimalOdds =
      record.decimal_odds?.trim() || record.odds_decimal?.trim()
        ? parseNumber(record.decimal_odds || record.odds_decimal)
        : americanOdds
          ? americanToDecimalOdds(americanOdds)
          : 0;
    const parsedMatchup = parseMatchup(record.matchup || record.matchup_id);
    const teamAbbreviation = normalizeTeam(
      record.team_abbreviation || record.team || record.team_code,
    );
    const opponentAbbreviation = normalizeTeam(
      record.opponent_abbreviation || record.opponent || record.opp || record.opponent_team,
    );
    const homeTeamAbbreviation = normalizeTeam(
      record.home_team_abbreviation || record.home_team,
    ) || parsedMatchup.homeTeamAbbreviation;
    const awayTeamAbbreviation = normalizeTeam(
      record.away_team_abbreviation || record.away_team,
    ) || parsedMatchup.awayTeamAbbreviation;

    if (!analysisDate || decimalOdds <= 1) {
      throw new Error(
        `Odds row is missing required values for date=${analysisDate ?? '(blank)'} with decimal odds=${decimalOdds}.`,
      );
    }

    return {
      analysisDate,
      market,
      entityId,
      gameId,
      selection,
      line,
      decimalOdds,
      impliedProbability: decimalToImpliedProbability(decimalOdds),
      americanOdds,
      sportsbook: record.sportsbook?.trim() || record.book?.trim() || undefined,
      capturedAt:
        record.captured_at?.trim() || record.timestamp?.trim() || new Date().toISOString(),
      isClosing: parseBoolean(record.is_closing) || parseBoolean(record.closing),
      entityName:
        record.player_name?.trim() ||
        record.pitcher_name?.trim() ||
        record.hitter_name?.trim() ||
        record.name?.trim() ||
        undefined,
      teamAbbreviation: teamAbbreviation || undefined,
      opponentAbbreviation: opponentAbbreviation || undefined,
      homeTeamAbbreviation: homeTeamAbbreviation || undefined,
      awayTeamAbbreviation: awayTeamAbbreviation || undefined,
      matchup: record.matchup?.trim() || record.matchup_id?.trim() || undefined,
    } satisfies ParsedOddsRow;
  });
};

const resolveGameId = (
  row: ParsedOddsRow,
  snapshot: AnalysisSnapshot,
): string | undefined => {
  if (row.gameId) {
    return row.gameId;
  }

  const exactMatch = snapshot.analysis.games.find((game) => {
    if (row.matchup && game.matchupId.toUpperCase() === row.matchup.toUpperCase()) {
      return true;
    }

    if (row.homeTeamAbbreviation && row.awayTeamAbbreviation) {
      return (
        game.homeTeam.abbreviation === row.homeTeamAbbreviation &&
        game.awayTeam.abbreviation === row.awayTeamAbbreviation
      );
    }

    if (row.teamAbbreviation && row.opponentAbbreviation) {
      return (
        (game.homeTeam.abbreviation === row.teamAbbreviation &&
          game.awayTeam.abbreviation === row.opponentAbbreviation) ||
        (game.awayTeam.abbreviation === row.teamAbbreviation &&
          game.homeTeam.abbreviation === row.opponentAbbreviation)
      );
    }

    if (row.market === 'game_moneyline_home' && row.teamAbbreviation) {
      if (row.selection === 'home') {
        return game.homeTeam.abbreviation === row.teamAbbreviation;
      }

      if (row.selection === 'away') {
        return game.awayTeam.abbreviation === row.teamAbbreviation;
      }
    }

    return false;
  });

  return exactMatch?.gameId;
};

const resolveEntityId = (
  row: ParsedOddsRow,
  snapshot: AnalysisSnapshot,
  resolvedGameId: string | undefined,
): string | undefined => {
  if (row.entityId) {
    return row.entityId;
  }

  if (row.market === 'game_moneyline_home') {
    return resolvedGameId;
  }

  const normalizedEntityName = normalizeName(row.entityName);

  if (!normalizedEntityName) {
    return undefined;
  }

  const pool =
    row.market === 'pitcher_strikeouts' ||
    row.market === 'pitcher_walks' ||
    row.market === 'pitcher_outs'
      ? snapshot.analysis.rankings.pitchers
      : snapshot.analysis.rankings.hitters;
  const matches = pool.filter((candidate) => {
    if (normalizeName(candidate.playerName) !== normalizedEntityName) {
      return false;
    }

    if (resolvedGameId && candidate.gameId !== resolvedGameId) {
      return false;
    }

    if (row.teamAbbreviation && candidate.team.abbreviation !== row.teamAbbreviation) {
      return false;
    }

    return true;
  });

  if (matches.length === 1) {
    return matches[0]?.playerId;
  }

  return undefined;
};

export const resolveOddsRecords = (
  rows: ParsedOddsRow[],
  snapshotsByDate: Map<string, AnalysisSnapshot>,
): OddsRecord[] =>
  rows.map((row) => {
    const snapshot = snapshotsByDate.get(row.analysisDate);

    if (!snapshot) {
      if (!row.entityId || !row.gameId) {
        throw new Error(
          `No snapshot is available to resolve odds row for ${row.analysisDate}. Add a snapshot or include entity_id and game_id in the CSV.`,
        );
      }

      return {
        analysisDate: row.analysisDate,
        market: row.market,
        entityId: row.entityId,
        gameId: row.gameId,
        selection: row.selection,
        line: row.line,
        decimalOdds: row.decimalOdds,
        impliedProbability: row.impliedProbability,
        americanOdds: row.americanOdds,
        sportsbook: row.sportsbook,
        capturedAt: row.capturedAt,
        isClosing: row.isClosing,
      } satisfies OddsRecord;
    }

    let resolvedGameId = resolveGameId(row, snapshot);
    const resolvedEntityId = resolveEntityId(row, snapshot, resolvedGameId);

    if (!resolvedGameId && resolvedEntityId && row.market !== 'game_moneyline_home') {
      resolvedGameId =
        row.market === 'pitcher_strikeouts' ||
        row.market === 'pitcher_walks' ||
        row.market === 'pitcher_outs'
          ? snapshot.analysis.rankings.pitchers.find(
              (pitcher) => pitcher.playerId === resolvedEntityId,
            )?.gameId
          : snapshot.analysis.rankings.hitters.find(
              (hitter) => hitter.playerId === resolvedEntityId,
            )?.gameId;
    }

    if (!resolvedGameId || !resolvedEntityId) {
      throw new Error(
        `Unable to resolve odds row for ${row.analysisDate} market=${row.market} name=${row.entityName ?? '(blank)'}, team=${row.teamAbbreviation ?? '(blank)'}, game=${row.gameId ?? row.matchup ?? '(blank)'}.`,
      );
    }

    return {
      analysisDate: row.analysisDate,
      market: row.market,
      entityId: resolvedEntityId,
      gameId: resolvedGameId,
      selection: row.selection,
      line: row.line,
      decimalOdds: row.decimalOdds,
      impliedProbability: row.impliedProbability,
      americanOdds: row.americanOdds,
      sportsbook: row.sportsbook,
      capturedAt: row.capturedAt,
      isClosing: row.isClosing,
    } satisfies OddsRecord;
  });
