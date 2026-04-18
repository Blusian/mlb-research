import {
  buildPitchersToAttack,
  rankHitters,
  rankPitchers,
} from '@mlb-analyzer/scoring-engine';
import type {
  DailyAnalysisQuery,
  DailyAnalysisResponse,
  HitterScoreType,
  PitcherScoreType,
  RankedHitter,
  RankedPitcher,
} from '@mlb-analyzer/shared';

import type { DailySlateCache } from '../cache/dailySlateCache.js';
import { normalizeDailySlate } from '../normalization/normalizeDailySlate.js';
import type { DailyDataProvider } from '../providers/types.js';
import { filterGames, filterHitters, filterPitchers } from './filtering.js';
import { createEmptyPropBoards } from './propBoardDefaults.js';
import type { PropBoardService } from './propBoardService.js';

interface DailyAnalysisOptions {
  forceRefresh?: boolean;
}

const ANALYSIS_CACHE_VERSION = 'v2-matchup-aware-hr-model';

const hitterScoreSorters: Record<HitterScoreType, (hitter: RankedHitter) => number> = {
  overall_hit_score: (hitter) => hitter.scores.overallHitScore,
  home_run_upside_score: (hitter) => hitter.scores.homeRunUpsideScore,
  floor_score: (hitter) => hitter.scores.floorScore,
  risk_score: (hitter) => hitter.scores.riskScore,
};

const pitcherScoreSorters: Record<PitcherScoreType, (pitcher: RankedPitcher) => number> = {
  overall_pitcher_score: (pitcher) => pitcher.scores.overallPitcherScore,
  strikeout_upside_score: (pitcher) => pitcher.scores.strikeoutUpsideScore,
  safety_score: (pitcher) => pitcher.scores.safetyScore,
  blowup_risk_score: (pitcher) => pitcher.scores.blowupRiskScore,
};

export class DailyAnalysisService {
  public constructor(
    private readonly provider: DailyDataProvider,
    private readonly cache: DailySlateCache<DailyAnalysisResponse>,
    private readonly propBoardService?: PropBoardService,
  ) {}

  public async getDailyAnalysis(
    query: DailyAnalysisQuery,
    options: DailyAnalysisOptions = {},
  ): Promise<DailyAnalysisResponse> {
    const analysisDate = query.date ?? new Date().toISOString().slice(0, 10);
    const cacheKey = `${this.provider.name}:${ANALYSIS_CACHE_VERSION}:${analysisDate}`;

    if (!options.forceRefresh) {
      const cached = this.cache.get(cacheKey);

      if (cached) {
        return this.applyQueryFilters(structuredClone(cached), query, 'hit');
      }
    } else {
      this.cache.delete(cacheKey);
    }

    const rawSlate = await this.provider.getDailySlate(analysisDate);
    const normalizedSlate = normalizeDailySlate(rawSlate);

    const rankedHitters = rankHitters(normalizedSlate.hitters);
    const rankedPitchers = rankPitchers(normalizedSlate.pitchers);
    const pitchersToAttack = buildPitchersToAttack(rankedPitchers);

    const response: DailyAnalysisResponse = {
      meta: {
        analysisDate,
        generatedAt: normalizedSlate.generatedAt,
        source: normalizedSlate.source,
        providerName: normalizedSlate.providerName,
        cacheStatus: 'miss',
        notes: options.forceRefresh
          ? ['Manual refresh bypassed the cached slate.', ...normalizedSlate.notes]
          : normalizedSlate.notes,
      },
      filters: {
        teams: [
          ...new Set(
            normalizedSlate.games.flatMap((game) => [
              game.awayTeam.abbreviation,
              game.homeTeam.abbreviation,
            ]),
          ),
        ].sort(),
        matchups: Array.from(
          new Map(
            normalizedSlate.games.map((game) => [
              game.matchupId,
              {
                value: game.matchupId,
                label: game.matchupLabel,
              },
            ]),
          ).values(),
        ),
        handedness: ['L', 'R', 'S'],
        hitterScoreTypes: [
          'overall_hit_score',
          'home_run_upside_score',
          'floor_score',
          'risk_score',
        ],
        pitcherScoreTypes: [
          'overall_pitcher_score',
          'strikeout_upside_score',
          'safety_score',
          'blowup_risk_score',
        ],
      },
      games: normalizedSlate.games,
      props: createEmptyPropBoards(),
      rankings: {
        hitters: rankedHitters,
        homeRunCandidates: [...rankedHitters].sort(
          (left, right) => right.scores.homeRunUpsideScore - left.scores.homeRunUpsideScore,
        ),
        hittersToAvoid: [...rankedHitters].sort((left, right) => {
          const leftAvoid = left.scores.riskScore * 0.65 + (100 - left.scores.floorScore) * 0.35;
          const rightAvoid =
            right.scores.riskScore * 0.65 + (100 - right.scores.floorScore) * 0.35;
          return rightAvoid - leftAvoid;
        }),
        pitchers: rankedPitchers,
        pitchersToAttack,
      },
    };

    this.cache.set(cacheKey, response);

    return this.applyQueryFilters(structuredClone(response), query, 'miss');
  }

  private applyQueryFilters(
    response: DailyAnalysisResponse,
    query: DailyAnalysisQuery,
    cacheStatus: DailyAnalysisResponse['meta']['cacheStatus'],
  ): DailyAnalysisResponse {
    response.meta.cacheStatus = cacheStatus;
    response.games = filterGames(response.games, query);
    response.rankings.hitters = this.sortHitters(
      filterHitters(response.rankings.hitters, query),
      query.hitterScoreType,
    );
    response.rankings.homeRunCandidates = filterHitters(response.rankings.homeRunCandidates, query);
    response.rankings.hittersToAvoid = filterHitters(response.rankings.hittersToAvoid, query);
    response.rankings.pitchers = this.sortPitchers(
      filterPitchers(response.rankings.pitchers, query),
      query.pitcherScoreType,
    );
    response.rankings.pitchersToAttack = filterPitchers(response.rankings.pitchersToAttack, query);
    response.props = this.propBoardService?.build(response) ?? createEmptyPropBoards();

    return response;
  }

  private sortHitters(hitters: RankedHitter[], sortBy?: HitterScoreType): RankedHitter[] {
    if (!sortBy) {
      return hitters;
    }

    const selector = hitterScoreSorters[sortBy];
    return [...hitters].sort((left, right) => selector(right) - selector(left));
  }

  private sortPitchers(pitchers: RankedPitcher[], sortBy?: PitcherScoreType): RankedPitcher[] {
    if (!sortBy) {
      return pitchers;
    }

    const selector = pitcherScoreSorters[sortBy];
    return [...pitchers].sort((left, right) => selector(right) - selector(left));
  }
}
