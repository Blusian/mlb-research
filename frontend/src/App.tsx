import type {
  DailyAnalysisQuery,
  DailyAnalysisResponse,
  GameInfo,
  Handedness,
  HitterHomeRunProp,
  HitterScoreType,
  PitcherScoreType,
  PitcherStrikeoutProp,
} from '@mlb-analyzer/shared';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';

import { FiltersBar } from './components/FiltersBar';
import { GamesGrid } from './components/GamesGrid';
import { HitterCard } from './components/HitterCard';
import { PlayerDetailPage } from './components/PlayerDetailPage';
import { PlayerNameButton } from './components/PlayerNameButton';
import { PitcherCard } from './components/PitcherCard';
import { PropsExplorer } from './components/PropsExplorer';
import { RankingSection } from './components/RankingSection';
import { SelectedPropsPage } from './components/SelectedPropsPage';
import { StatGlossaryButton } from './components/StatGlossaryButton';
import { formatProbability, getProbabilityTone } from './utils/probability';
import { SelectedPropsProvider } from './store/SelectedPropsContext';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { useDailyAnalysis } from './hooks/useDailyAnalysis';
import type { PlayerDetailSelection } from './types/playerDetail';

interface SavedView {
  name: string;
  query: DailyAnalysisQuery;
  savedAt: string;
}

type WorkspaceView =
  | 'overview'
  | 'props'
  | 'selected-props'
  | 'hitters'
  | 'pitchers'
  | 'games'
  | 'tools';

const SAVED_VIEWS_STORAGE_KEY = 'mlb-analyzer.saved-views';

const todayString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createDefaultQuery = (): DailyAnalysisQuery => ({
  date: todayString(),
  team: 'ALL',
  matchup: 'ALL',
  handedness: 'ALL',
  hitterScoreType: 'overall_hit_score',
  pitcherScoreType: 'overall_pitcher_score',
});

const parsePlayerDetailHash = (): PlayerDetailSelection | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);
  if (params.get('view') !== 'player') {
    return null;
  }

  const playerId = params.get('playerId');
  const role = params.get('role');
  const gameId = params.get('gameId');
  const date = params.get('date');

  if (!playerId || !gameId || !date || (role !== 'hitter' && role !== 'pitcher')) {
    return null;
  }

  return {
    playerId,
    role,
    gameId,
    date,
  };
};

const setPlayerDetailHash = (selection: PlayerDetailSelection): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const params = new URLSearchParams({
    view: 'player',
    playerId: selection.playerId,
    role: selection.role,
    gameId: selection.gameId,
    date: selection.date,
  });

  window.location.hash = params.toString();
};

const clearPlayerDetailHash = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  url.hash = '';
  window.history.pushState({}, document.title, url.toString());
};

const loadSavedViews = (): SavedView[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SavedView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const summaryLabel = (value: string) => value.replaceAll('_', ' ');

const formatProjectedRuns = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '--';

const gameTotalToneClass = (lean: 'over' | 'under' | 'neutral'): string => {
  if (lean === 'over') {
    return 'game-total-over';
  }
  if (lean === 'under') {
    return 'game-total-under';
  }
  return 'game-total-neutral';
};

const escapeCsv = (value: string | number | boolean | null | undefined): string => {
  const stringValue = value == null ? '' : String(value);
  return `"${stringValue.replaceAll('"', '""')}"`;
};

const downloadCsv = (
  filename: string,
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
): void => {
  if (typeof window === 'undefined' || rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0] ?? {});
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
};

const exportGames = (analysis: DailyAnalysisResponse): void => {
  downloadCsv(
    `mlb-games-${analysis.meta.analysisDate}.csv`,
    analysis.games.map((game) => ({
      matchup: game.matchupLabel,
      game_date: game.gameDate,
      start_time: game.startTime,
      status: game.status,
      lineup_status: game.lineupStatus,
      away_pitcher: game.probablePitchers.away?.name ?? 'TBD',
      home_pitcher: game.probablePitchers.home?.name ?? 'TBD',
      weather: game.weather?.condition ?? 'Unavailable',
      temperature_f: game.weather?.temperatureF ?? '',
      wind: game.weather?.wind ?? '',
      park_factor: game.venue.parkFactor,
      home_run_factor: game.venue.homeRunFactor,
      away_projected_runs: game.runProjection?.away.projectedRuns?.toFixed(1) ?? '',
      home_projected_runs: game.runProjection?.home.projectedRuns?.toFixed(1) ?? '',
      projected_total_runs: game.runProjection?.totalRuns?.toFixed(1) ?? '',
      total_edge_vs_baseline: game.runProjection?.edgeVsBaseline?.toFixed(1) ?? '',
      over_under_lean: game.runProjection?.overUnderLean ?? '',
      projection_confidence: game.runProjection?.confidenceRating ?? '',
      run_environment_score: game.runProjection?.runEnvironmentScore?.toFixed(1) ?? '',
    })),
  );
};

const exportHitters = (analysis: DailyAnalysisResponse): void => {
  downloadCsv(
    `mlb-hitters-${analysis.meta.analysisDate}.csv`,
    analysis.rankings.hitters.map((hitter) => ({
      player: hitter.playerName,
      team: hitter.team.abbreviation,
      opponent: hitter.opponent.abbreviation,
      matchup: hitter.matchupLabel,
      bats: hitter.bats,
      lineup_spot: hitter.metrics.lineupSpot,
      overall_hit_score: hitter.scores.overallHitScore.toFixed(1),
      home_run_upside_score: hitter.scores.homeRunUpsideScore.toFixed(1),
      hits_confidence: hitter.scores.marketConfidence?.hits.confidenceRating ?? '',
      hits_market_score: hitter.scores.marketConfidence?.hits.score?.toFixed(1) ?? '',
      runs_confidence: hitter.scores.marketConfidence?.runs.confidenceRating ?? '',
      runs_market_score: hitter.scores.marketConfidence?.runs.score?.toFixed(1) ?? '',
      rbi_confidence: hitter.scores.marketConfidence?.rbi.confidenceRating ?? '',
      rbi_market_score: hitter.scores.marketConfidence?.rbi.score?.toFixed(1) ?? '',
      total_bases_confidence:
        hitter.scores.marketConfidence?.totalBases.confidenceRating ?? '',
      total_bases_market_score:
        hitter.scores.marketConfidence?.totalBases.score?.toFixed(1) ?? '',
      walks_confidence: hitter.scores.marketConfidence?.walks.confidenceRating ?? '',
      walks_market_score: hitter.scores.marketConfidence?.walks.score?.toFixed(1) ?? '',
      average_bat_speed: hitter.metrics.averageBatSpeed.toFixed(1),
      blast_rate: hitter.metrics.blastRate.toFixed(1),
      squared_up_rate: hitter.metrics.squaredUpRate.toFixed(1),
      batter_vs_pitcher_pa: hitter.metrics.batterVsPitcherPlateAppearances,
      batter_vs_pitcher_ops: hitter.metrics.batterVsPitcherOps.toFixed(3),
      batter_vs_pitcher_score: hitter.metrics.batterVsPitcherScore.toFixed(1),
      pitch_mix_matchup_score: hitter.metrics.pitchMixMatchupScore.toFixed(1),
      primary_pitch_type: hitter.metrics.primaryPitchTypeDescription,
      primary_pitch_usage: hitter.metrics.primaryPitchUsage.toFixed(1),
      home_run_park_factor_vs_handedness: hitter.metrics.homeRunParkFactorVsHandedness,
      reasons: hitter.reasons.join(' | '),
    })),
  );
};

const exportPitchers = (analysis: DailyAnalysisResponse): void => {
  downloadCsv(
    `mlb-pitchers-${analysis.meta.analysisDate}.csv`,
    analysis.rankings.pitchers.map((pitcher) => ({
      player: pitcher.playerName,
      team: pitcher.team.abbreviation,
      opponent: pitcher.opponent.abbreviation,
      matchup: pitcher.matchupLabel,
      throws: pitcher.throwingHand,
      overall_pitcher_score: pitcher.scores.overallPitcherScore.toFixed(1),
      strikeout_upside_score: pitcher.scores.strikeoutUpsideScore.toFixed(1),
      strikeout_park_factor: pitcher.metrics.strikeoutParkFactor.toFixed(0),
      home_run_park_factor: pitcher.metrics.homeRunParkFactor.toFixed(0),
      innings_projection: pitcher.metrics.inningsProjection.toFixed(1),
      reasons: pitcher.reasons.join(' | '),
    })),
  );
};

const totalPropCount = (analysis?: DailyAnalysisResponse | null): number => {
  if (!analysis) {
    return 0;
  }

  return (
    analysis.props.hitterHomeRuns.length
    + analysis.props.hitterHits.length
    + analysis.props.hitterRuns.length
    + analysis.props.hitterRbis.length
    + analysis.props.hitterTotalBases.length
    + analysis.props.hitterWalks.length
    + analysis.props.pitcherStrikeouts.length
    + analysis.props.pitcherWalks.length
    + analysis.props.pitcherOuts.length
  );
};

const exportProps = (analysis: DailyAnalysisResponse): void => {
  const homeRunRows = analysis.props.hitterHomeRuns.map((prop) => ({
    market: 'hitter_home_run',
    player: prop.playerName,
    team: prop.teamAbbreviation,
    opponent: prop.opponentAbbreviation,
    matchup: prop.matchupLabel,
    confidence: prop.confidence,
    model_type: prop.modelType,
    probability: (prop.blendedProbability * 100).toFixed(2),
    heuristic_probability: (prop.heuristicProbability * 100).toFixed(2),
    learned_probability:
      prop.learnedProbability == null ? '' : (prop.learnedProbability * 100).toFixed(2),
    home_run_score: prop.homeRunScore.toFixed(1),
    lineup_spot: prop.lineupSpot,
    bat_speed: prop.metrics.averageBatSpeed.toFixed(1),
    blast_rate: prop.metrics.blastRate.toFixed(1),
    batter_vs_pitcher_pa: prop.metrics.batterVsPitcherPlateAppearances,
    batter_vs_pitcher_ops: prop.metrics.batterVsPitcherOps.toFixed(3),
    batter_vs_pitcher_score: prop.metrics.batterVsPitcherScore.toFixed(1),
    pitch_mix_matchup_score: prop.metrics.pitchMixMatchupScore.toFixed(1),
    primary_pitch_type: prop.metrics.primaryPitchTypeDescription,
    primary_pitch_usage: prop.metrics.primaryPitchUsage.toFixed(1),
    park_factor_vs_hand: prop.metrics.homeRunParkFactorVsHandedness,
  }));
  const hitterMarketRows = [
    ...analysis.props.hitterHits,
    ...analysis.props.hitterRuns,
    ...analysis.props.hitterRbis,
    ...analysis.props.hitterTotalBases,
    ...analysis.props.hitterWalks,
  ].map((prop) => ({
    market: prop.market,
    player: prop.playerName,
    team: prop.teamAbbreviation,
    opponent: prop.opponentAbbreviation,
    matchup: prop.matchupLabel,
    confidence: prop.confidence,
    line_value: prop.lineValue.toFixed(1),
    projection_value: prop.projectionValue.toFixed(2),
    delta_vs_line: prop.deltaVsLine.toFixed(2),
    confidence_score: prop.marketScore.toFixed(1),
    lineup_spot: prop.lineupSpot,
    avg_vs_hand: prop.metrics.averageVsHandedness.toFixed(3),
    obp_vs_hand: prop.metrics.obpVsHandedness.toFixed(3),
    slg_vs_hand: prop.metrics.sluggingVsHandedness.toFixed(3),
    walk_rate: prop.metrics.walkRate.toFixed(1),
    strikeout_rate: prop.metrics.strikeoutRate.toFixed(1),
    recent_form: prop.metrics.recentForm.toFixed(1),
    batter_vs_pitcher_score: prop.metrics.batterVsPitcherScore.toFixed(1),
    pitch_mix_matchup_score: prop.metrics.pitchMixMatchupScore.toFixed(1),
    projected_plate_appearances: prop.metrics.projectedPlateAppearances.toFixed(2),
    season_growth_percent: prop.metrics.seasonGrowthPercent?.toFixed(1) ?? '',
    rookie_season: prop.metrics.isRookieSeason ? 'yes' : 'no',
  }));
  const strikeoutRows = analysis.props.pitcherStrikeouts.map((prop) => ({
    market: 'pitcher_strikeouts',
    player: prop.playerName,
    team: prop.teamAbbreviation,
    opponent: prop.opponentAbbreviation,
    matchup: prop.matchupLabel,
    confidence: prop.confidence,
    mean_ks: prop.meanKs.toFixed(2),
    median_ks: prop.medianKs.toFixed(1),
    over_3_5_probability: (prop.over3_5Probability * 100).toFixed(2),
    over_4_5_probability: (prop.over4_5Probability * 100).toFixed(2),
    strikeout_score: prop.strikeoutScore.toFixed(1),
    innings_projection: prop.inningsProjection.toFixed(1),
    expected_batters_faced: prop.metrics.projectionLayer.expectedBattersFaced.toFixed(1),
    true_talent_k_ability: prop.metrics.projectionLayer.trueTalentKAbility.toFixed(1),
    opponent_k_tendencies: prop.metrics.projectionLayer.opponentKTendencies.toFixed(1),
    lineup_k_vs_hand: prop.metrics.projectionLayer.lineupVsPitcherHandKRate.toFixed(1),
    matchup_adjusted_k_rate: prop.metrics.projectionLayer.matchupAdjustedKRate.toFixed(1),
    pitch_mix_advantage: prop.metrics.projectionLayer.pitchMixAdvantage.toFixed(1),
    lineup_confidence: prop.metrics.projectionLayer.lineupConfidence.toFixed(1),
    tracked_lineup_spots: prop.metrics.projectionLayer.trackedLineupSpots,
    confirmed_lineup_spots: prop.metrics.projectionLayer.confirmedLineupSpots,
    umpire_park_lineup: prop.metrics.projectionLayer.umpireParkLineup.toFixed(1),
    role_certainty: prop.metrics.riskLayer.roleCertainty.toFixed(1),
    innings_volatility: prop.metrics.riskLayer.inningsVolatility.toFixed(1),
    pitch_cap_risk: prop.metrics.riskLayer.pitchCountCap.toFixed(1),
    early_exit_risk: prop.metrics.riskLayer.earlyExitRisk.toFixed(1),
    recent_workload: prop.metrics.riskLayer.recentWorkload.toFixed(1),
    contact_heavy_penalty: prop.metrics.riskLayer.contactHeavyOpponentPenalty.toFixed(1),
    strikeout_rate: prop.metrics.strikeoutRate.toFixed(1),
    swinging_strike_rate: prop.metrics.swingingStrikeRate.toFixed(1),
    opponent_strikeout_rate: prop.metrics.opponentStrikeoutRate.toFixed(1),
    lineup_vs_pitcher_hand_k_rate: prop.metrics.lineupVsPitcherHandKRate.toFixed(1),
    lineup_tracked: prop.metrics.opponentLineupCount,
    lineup_confirmed: prop.metrics.opponentConfirmedHitterCount,
    strikeout_park_factor: prop.metrics.strikeoutParkFactor,
  }));
  const pitcherLineRows = [...analysis.props.pitcherWalks, ...analysis.props.pitcherOuts].map(
    (prop) => ({
      market: prop.market,
      player: prop.playerName,
      team: prop.teamAbbreviation,
      opponent: prop.opponentAbbreviation,
      matchup: prop.matchupLabel,
      confidence: prop.confidence,
      line_value: prop.lineValue.toFixed(1),
      projection_value: prop.projectionValue.toFixed(2),
      delta_vs_line: prop.deltaVsLine.toFixed(2),
      confidence_score: prop.marketScore.toFixed(1),
      innings_projection: prop.metrics.inningsProjection.toFixed(1),
      projected_outs: prop.metrics.projectedOuts.toFixed(1),
      expected_batters_faced: prop.metrics.expectedBattersFaced.toFixed(1),
      strikeout_rate: prop.metrics.strikeoutRate.toFixed(1),
      walk_rate: prop.metrics.walkRate.toFixed(1),
      opponent_walk_rate: prop.metrics.opponentWalkRate.toFixed(1),
      recent_form: prop.metrics.recentForm.toFixed(1),
      role_certainty: prop.metrics.roleCertainty.toFixed(1),
      innings_volatility: prop.metrics.inningsVolatility.toFixed(1),
      pitch_cap: prop.metrics.pitchCountCap.toFixed(1),
      early_exit_risk: prop.metrics.earlyExitRisk.toFixed(1),
      lineup_confidence: prop.metrics.lineupConfidence.toFixed(1),
      tracked_lineup_spots: prop.metrics.trackedLineupSpots,
      confirmed_lineup_spots: prop.metrics.confirmedLineupSpots,
      matchup_adjusted_walk_rate: prop.metrics.matchupAdjustedWalkRate?.toFixed(1) ?? '',
    }),
  );

  downloadCsv(
    `mlb-props-${analysis.meta.analysisDate}.csv`,
    [...homeRunRows, ...hitterMarketRows, ...strikeoutRows, ...pitcherLineRows],
  );
};

function OverviewPropList({
  title,
  eyebrow,
  props,
  onOpenPlayerDetail,
}: {
  title: string;
  eyebrow: string;
  props: HitterHomeRunProp[] | PitcherStrikeoutProp[];
  onOpenPlayerDetail: (role: 'hitter' | 'pitcher', playerId: string, gameId: string) => void;
}) {
  return (
    <section className="panel overview-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span className="chip">{props.length} shown</span>
      </div>

      <div className="overview-list">
        {props.length > 0 ? (
          props.map((prop) => (
            <article key={`${prop.market}-${prop.entityId}`} className="overview-list-item">
              <div>
                <p className="player-team">
                  {prop.teamAbbreviation} vs {prop.opponentAbbreviation}
                </p>
                <h3>
                  <PlayerNameButton
                    name={prop.playerName}
                    onClick={() =>
                      onOpenPlayerDetail(
                        prop.market === 'pitcher_strikeouts' ? 'pitcher' : 'hitter',
                        prop.entityId,
                        prop.gameId,
                      )
                    }
                  />
                </h3>
              </div>
              <div
                className={
                  'blendedProbability' in prop
                    ? `overview-list-score ${getProbabilityTone(prop.blendedProbability)}`
                    : 'overview-list-score'
                }
              >
                {'blendedProbability' in prop
                  ? formatProbability(prop.blendedProbability)
                  : prop.meanKs.toFixed(1)}
              </div>
            </article>
          ))
        ) : (
          <p className="empty-state">No props matched the active filters.</p>
        )}
      </div>
    </section>
  );
}

function OverviewGameTotalsList({
  title,
  eyebrow,
  games,
  direction,
}: {
  title: string;
  eyebrow: string;
  games: GameInfo[];
  direction: 'asc' | 'desc';
}) {
  const projectedGames = games
    .filter((game) => game.runProjection)
    .sort((left, right) =>
      direction === 'desc'
        ? (right.runProjection?.totalRuns ?? 0) - (left.runProjection?.totalRuns ?? 0)
        : (left.runProjection?.totalRuns ?? 0) - (right.runProjection?.totalRuns ?? 0),
    )
    .slice(0, 5);

  return (
    <section className="panel overview-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span className="chip">{projectedGames.length} shown</span>
      </div>

      <div className="overview-list">
        {projectedGames.length > 0 ? (
          projectedGames.map((game) => (
            <article key={game.gameId} className="overview-list-item">
              <div>
                <p className="player-team">
                  {game.awayTeam.abbreviation} {formatProjectedRuns(game.runProjection?.away.projectedRuns)} /{' '}
                  {game.homeTeam.abbreviation} {formatProjectedRuns(game.runProjection?.home.projectedRuns)}
                </p>
                <h3>{game.matchupLabel}</h3>
                <p className="helper-text game-total-meta">
                  {game.runProjection?.summary ?? 'No game projection available.'}
                </p>
              </div>
              <div
                className={`overview-list-score ${gameTotalToneClass(game.runProjection?.overUnderLean ?? 'neutral')}`}
              >
                {formatProjectedRuns(game.runProjection?.totalRuns)}
              </div>
            </article>
          ))
        ) : (
          <p className="empty-state">No game totals were available.</p>
        )}
      </div>
    </section>
  );
}

function App() {
  const [query, setQuery] = useState<DailyAnalysisQuery>(() => createDefaultQuery());
  const deferredQuery = useDeferredValue(query);
  const { data, error, isLoading, refresh } = useDailyAnalysis(deferredQuery);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [viewName, setViewName] = useState('');
  const [selectedSavedView, setSelectedSavedView] = useState('');
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>('overview');
  const [activePlayerDetail, setActivePlayerDetail] = useState<PlayerDetailSelection | null>(() =>
    parsePlayerDetailHash(),
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleHashChange = () => {
      setActivePlayerDetail(parsePlayerDetailHash());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const updateQuery = <K extends keyof DailyAnalysisQuery>(key: K, value: DailyAnalysisQuery[K]) => {
    startTransition(() => {
      setQuery((current) => ({
        ...current,
        [key]: value,
      }));
    });
  };

  const saveCurrentView = () => {
    const normalizedName = viewName.trim() || `Saved view ${savedViews.length + 1}`;
    const savedView: SavedView = {
      name: normalizedName,
      query,
      savedAt: new Date().toISOString(),
    };

    setSavedViews((current) => [
      savedView,
      ...current.filter((entry) => entry.name !== normalizedName),
    ]);
    setSelectedSavedView(normalizedName);
    setViewName('');
  };

  const applySavedView = () => {
    const savedView = savedViews.find((entry) => entry.name === selectedSavedView);

    if (!savedView) {
      return;
    }

    startTransition(() => {
      setQuery(savedView.query);
    });
  };

  const deleteSavedView = () => {
    if (!selectedSavedView) {
      return;
    }

    setSavedViews((current) => current.filter((entry) => entry.name !== selectedSavedView));
    setSelectedSavedView('');
  };

  const resetFilters = () => {
    startTransition(() => {
      setQuery(createDefaultQuery());
    });
    setSelectedSavedView('');
  };

  const openPlayerDetail = (
    role: 'hitter' | 'pitcher',
    playerId: string,
    gameId: string,
  ) => {
    setPlayerDetailHash({
      role,
      playerId,
      gameId,
      date: query.date ?? data?.meta.analysisDate ?? todayString(),
    });
  };

  const closePlayerDetail = () => {
    clearPlayerDetailHash();
    setActivePlayerDetail(null);
  };

  const selectedSavedViewDetails = savedViews.find((entry) => entry.name === selectedSavedView);
  const learnedHomeRunModels =
    data?.props.hitterHomeRuns.filter((prop) => prop.modelType === 'learned_logistic_blend').length ?? 0;
  const hasSlate = (data?.games.length ?? 0) > 0;
  const propCount = totalPropCount(data);
  const hasProps = propCount > 0;
  const workspaceTabs = [
    { id: 'overview', label: 'Overview', count: undefined },
    {
      id: 'props',
      label: 'Props',
      count: propCount,
    },
    { id: 'selected-props', label: 'Selected', count: undefined },
    { id: 'hitters', label: 'Hitters', count: data?.rankings.hitters.length ?? 0 },
    { id: 'pitchers', label: 'Pitchers', count: data?.rankings.pitchers.length ?? 0 },
    { id: 'games', label: 'Games', count: data?.games.length ?? 0 },
    { id: 'tools', label: 'Tools', count: savedViews.length },
  ] as const;

  return (
    <SelectedPropsProvider selectedDate={query.date ?? todayString()}>
      <div className="app-shell">
        <div className="app-backdrop" />

        <main className="app-main">
          {activePlayerDetail ? (
            <PlayerDetailPage
              selection={activePlayerDetail}
              onClose={closePlayerDetail}
              onOpenPlayerDetail={openPlayerDetail}
            />
          ) : (
            <>
          <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">MLB Daily Matchup Analyzer</p>
            <h1>Organized prop boards and matchup rankings, not one endless slate scroll.</h1>
            <p className="hero-text">
              Study today&apos;s prop angles with learned home-run probabilities, bat-tracking inputs,
              handedness-aware park context, pitcher strikeout projections, and the full ranking
              engine behind them.
            </p>
            <div className="button-row">
              <StatGlossaryButton />
            </div>
          </div>

          <div className="hero-summary">
            <article className="summary-card">
              <span>Analysis date</span>
              <strong>{data?.meta.analysisDate ?? query.date ?? 'Loading...'}</strong>
            </article>
            <article className="summary-card">
              <span>Provider</span>
              <strong>{data ? summaryLabel(data.meta.providerName) : '...'}</strong>
            </article>
            <article className="summary-card">
              <span>Props</span>
              <strong>{propCount}</strong>
            </article>
            <article className="summary-card">
              <span>Home run models active</span>
              <strong>{learnedHomeRunModels}</strong>
            </article>
            <article className="summary-card">
              <span>Games</span>
              <strong>{data?.games.length ?? 0}</strong>
            </article>
            <article className="summary-card">
              <span>Cache</span>
              <strong>{data?.meta.cacheStatus ?? '...'}</strong>
            </article>
          </div>
        </section>

          <WorkspaceTabs
            tabs={workspaceTabs}
            activeTab={activeWorkspace}
            onChange={(tabId) => setActiveWorkspace(tabId as WorkspaceView)}
          />

          <FiltersBar
            options={data?.filters}
            selectedDate={query.date ?? todayString()}
            selectedTeam={query.team ?? 'ALL'}
            selectedMatchup={query.matchup ?? 'ALL'}
            selectedHandedness={(query.handedness ?? 'ALL') as Handedness | 'ALL'}
            selectedHitterScoreType={(query.hitterScoreType ?? 'overall_hit_score') as HitterScoreType}
            selectedPitcherScoreType={
              (query.pitcherScoreType ?? 'overall_pitcher_score') as PitcherScoreType
            }
            onDateChange={(value) => updateQuery('date', value)}
            onTeamChange={(value) => updateQuery('team', value)}
            onMatchupChange={(value) => updateQuery('matchup', value)}
            onHandednessChange={(value) => updateQuery('handedness', value)}
            onHitterScoreTypeChange={(value) => updateQuery('hitterScoreType', value)}
            onPitcherScoreTypeChange={(value) => updateQuery('pitcherScoreType', value)}
          />

          {error ? <div className="status-banner error">{error}</div> : null}
          {isLoading && !data ? <div className="status-banner">Loading today&apos;s slate...</div> : null}
          {data && !isLoading && !hasSlate ? (
            <div className="status-banner">
              No MLB slate was found for {query.date ?? data.meta.analysisDate}. Try a different date
              if you expected hitter or home-run boards here.
            </div>
          ) : null}
          {data && hasSlate && !hasProps ? (
            <div className="status-banner">
              Games loaded for {data.meta.analysisDate}, but no props matched the current filters.
            </div>
          ) : null}

          {data ? (
            <>
            <div className="notes-row">
              {data.meta.notes.map((note) => (
                <span key={note} className="chip chip-muted">
                  {note}
                </span>
              ))}
            </div>

            {activeWorkspace === 'overview' ? (
              <div className="overview-grid">
                <OverviewGameTotalsList
                  title="High-Scoring Games"
                  eyebrow="Run Totals"
                  games={data.games}
                  direction="desc"
                />
                <OverviewGameTotalsList
                  title="Low-Scoring Games"
                  eyebrow="Run Totals"
                  games={data.games}
                  direction="asc"
                />
                <OverviewPropList
                  title="Top Home Run Looks"
                  eyebrow="Props Snapshot"
                  props={data.props.hitterHomeRuns.slice(0, 5)}
                  onOpenPlayerDetail={openPlayerDetail}
                />
                <OverviewPropList
                  title="Top Strikeout Looks"
                  eyebrow="Props Snapshot"
                  props={data.props.pitcherStrikeouts.slice(0, 5)}
                  onOpenPlayerDetail={openPlayerDetail}
                />

                <RankingSection
                  title="Best Hitters Today"
                  subtitle="Quick hitters board"
                  count={Math.min(4, data.rankings.hitters.length)}
                >
                  {data.rankings.hitters.slice(0, 4).map((hitter) => (
                    <HitterCard
                      key={hitter.playerId}
                      hitter={hitter}
                      variant="overall"
                      onOpenPlayerDetail={openPlayerDetail}
                    />
                  ))}
                </RankingSection>

                <RankingSection
                  title="Best Pitchers Today"
                  subtitle="Quick pitchers board"
                  count={Math.min(4, data.rankings.pitchers.length)}
                >
                  {data.rankings.pitchers.slice(0, 4).map((pitcher) => (
                    <PitcherCard
                      key={pitcher.playerId}
                      pitcher={pitcher}
                      variant="overall"
                      onOpenPlayerDetail={openPlayerDetail}
                    />
                  ))}
                </RankingSection>
              </div>
            ) : null}

            {activeWorkspace === 'props' ? (
              <PropsExplorer
                homeRunProps={data.props.hitterHomeRuns}
                hitterHitsProps={data.props.hitterHits}
                hitterRunsProps={data.props.hitterRuns}
                hitterRbisProps={data.props.hitterRbis}
                hitterTotalBasesProps={data.props.hitterTotalBases}
                hitterWalksProps={data.props.hitterWalks}
                strikeoutProps={data.props.pitcherStrikeouts}
                pitcherWalkProps={data.props.pitcherWalks}
                pitcherOutsProps={data.props.pitcherOuts}
                onOpenPlayerDetail={openPlayerDetail}
              />
            ) : null}

            {activeWorkspace === 'selected-props' ? <SelectedPropsPage /> : null}

            {activeWorkspace === 'hitters' ? (
              <div className="workspace-grid">
                <RankingSection
                  title="Best Hitters Today"
                  subtitle="Overall matchup board"
                  count={data.rankings.hitters.length}
                >
                  {data.rankings.hitters.map((hitter) => (
                    <HitterCard
                      key={hitter.playerId}
                      hitter={hitter}
                      variant="overall"
                      onOpenPlayerDetail={openPlayerDetail}
                    />
                  ))}
                </RankingSection>

                <RankingSection
                  title="Hitters To Avoid"
                  subtitle="Risk-heavy spots"
                  count={data.rankings.hittersToAvoid.length}
                >
                  {data.rankings.hittersToAvoid.map((hitter) => (
                    <HitterCard
                      key={`avoid-${hitter.playerId}`}
                      hitter={hitter}
                      variant="avoid"
                      onOpenPlayerDetail={openPlayerDetail}
                    />
                  ))}
                </RankingSection>
              </div>
            ) : null}

            {activeWorkspace === 'pitchers' ? (
              <div className="workspace-grid">
                <RankingSection
                  title="Best Pitchers Today"
                  subtitle="All-around mound profiles"
                  count={data.rankings.pitchers.length}
                >
                  {data.rankings.pitchers.map((pitcher) => (
                    <PitcherCard
                      key={pitcher.playerId}
                      pitcher={pitcher}
                      variant="overall"
                      onOpenPlayerDetail={openPlayerDetail}
                    />
                  ))}
                </RankingSection>

                <RankingSection
                  title="Pitchers To Attack"
                  subtitle="Offenses with leverage on contact risk"
                  count={data.rankings.pitchersToAttack.length}
                >
                  {data.rankings.pitchersToAttack.map((pitcher) => (
                    <PitcherCard
                      key={`attack-${pitcher.playerId}`}
                      pitcher={pitcher}
                      variant="attack"
                      onOpenPlayerDetail={openPlayerDetail}
                    />
                  ))}
                </RankingSection>
              </div>
            ) : null}

            {activeWorkspace === 'games' ? <GamesGrid games={data.games} /> : null}

            {activeWorkspace === 'tools' ? (
              <section className="panel tools-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Workspace Tools</p>
                    <h2>Save filter sets, export boards, and refresh the backend stack</h2>
                  </div>
                </div>

                <div className="tools-grid">
                  <div className="tools-card">
                    <label className="field">
                      <span>Saved view name</span>
                      <input
                        type="text"
                        placeholder="Morning slate"
                        value={viewName}
                        onChange={(event) => setViewName(event.target.value)}
                      />
                    </label>

                    <div className="button-row">
                      <button type="button" onClick={saveCurrentView}>
                        Save current filters
                      </button>
                      <button type="button" className="button-secondary" onClick={resetFilters}>
                        Reset filters
                      </button>
                    </div>

                    <label className="field">
                      <span>Saved views</span>
                      <select
                        value={selectedSavedView}
                        onChange={(event) => setSelectedSavedView(event.target.value)}
                      >
                        <option value="">Choose a saved view</option>
                        {savedViews.map((savedView) => (
                          <option key={savedView.name} value={savedView.name}>
                            {savedView.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="button-row">
                      <button type="button" onClick={applySavedView} disabled={!selectedSavedView}>
                        Apply view
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={deleteSavedView}
                        disabled={!selectedSavedView}
                      >
                        Delete view
                      </button>
                    </div>

                    <p className="helper-text">
                      {selectedSavedViewDetails
                        ? `Last saved ${new Date(selectedSavedViewDetails.savedAt).toLocaleString()}.`
                        : 'Saved views are stored locally in your browser.'}
                    </p>
                  </div>

                  <div className="tools-card">
                    <p className="eyebrow">CSV exports</p>
                    <h3>Download the organized slate</h3>
                    <p className="helper-text">
                      Export the filtered games, rankings, or the new prop boards.
                    </p>

                    <div className="button-row button-row-stacked">
                      <button type="button" onClick={() => exportGames(data)}>
                        Export games CSV
                      </button>
                      <button type="button" onClick={() => exportHitters(data)}>
                        Export hitters CSV
                      </button>
                      <button type="button" onClick={() => exportPitchers(data)}>
                        Export pitchers CSV
                      </button>
                      <button type="button" onClick={() => exportProps(data)}>
                        Export props CSV
                      </button>
                    </div>
                  </div>

                  <div className="tools-card">
                    <p className="eyebrow">Live Refresh</p>
                    <h3>Refetch the backend source stack</h3>
                    <p className="helper-text">
                      Reload the MLB Stats API, Savant, weather, and the current-model prop boards.
                    </p>

                    <div className="button-row button-row-stacked">
                      <button type="button" onClick={refresh} disabled={isLoading}>
                        {isLoading ? 'Refreshing slate...' : 'Refresh live data'}
                      </button>
                    </div>

                    <p className="helper-text">
                      Last generated {new Date(data.meta.generatedAt).toLocaleString()} with a{' '}
                      {data.meta.cacheStatus} cache result.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}
            </>
          ) : null}
            </>
          )}
        </main>
      </div>
    </SelectedPropsProvider>
  );
}

export default App;
