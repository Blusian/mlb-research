import type {
  HitterHomeRunProp,
  HitterStatProp,
  PitcherLineProp,
  PitcherStrikeoutProp,
} from '@mlb-analyzer/shared';
import { useDeferredValue, useMemo, useState } from 'react';

import { useSelectedProps } from '../hooks/useSelectedProps';
import { confidenceChipClass, formatConfidenceLabel } from '../utils/confidence';
import { formatNumber, formatPercent } from '../utils/number';
import { formatProbability, getProbabilityTone } from '../utils/probability';
import {
  createSelectedPropFromHitterStatProp,
  createSelectedPropFromHomeRunProp,
  createSelectedPropFromPitcherLineProp,
  createSelectedPropFromStrikeoutProp,
} from '../utils/selectedProps';
import { InfoChip } from './InfoChip';
import { InfoLabel } from './InfoLabel';
import { PlayerNameButton } from './PlayerNameButton';
import { PropTrackControls } from './PropTrackControls';

type HitterStatMarket = HitterStatProp['market'];
type PitcherLineMarket = PitcherLineProp['market'];
type PropMarketFilter =
  | 'all'
  | HitterHomeRunProp['market']
  | PitcherStrikeoutProp['market']
  | PitcherLineMarket
  | HitterStatMarket;
type ConfidenceFilter = 'all' | 'elite' | 'core' | 'strong' | 'watch' | 'thin';
type PropSortKey = 'confidence_desc' | 'edge_desc' | 'projection_desc' | 'player_asc';

interface PropsExplorerProps {
  homeRunProps: HitterHomeRunProp[];
  hitterHitsProps: HitterStatProp[];
  hitterRunsProps: HitterStatProp[];
  hitterRbisProps: HitterStatProp[];
  hitterTotalBasesProps: HitterStatProp[];
  hitterWalksProps: HitterStatProp[];
  strikeoutProps: PitcherStrikeoutProp[];
  pitcherWalkProps: PitcherLineProp[];
  pitcherOutsProps: PitcherLineProp[];
  onOpenPlayerDetail?: (role: 'hitter' | 'pitcher', playerId: string, gameId: string) => void;
}

interface HitterStatConfig {
  market: HitterStatMarket;
  title: string;
  shortLabel: string;
  displayLabel: string;
}

interface PitcherLineConfig {
  market: PitcherLineMarket;
  title: string;
  shortLabel: string;
  displayLabel: string;
  glossaryKey: 'walksAllowed' | 'outs';
}

type LineupSource =
  | HitterHomeRunProp['lineupSource']
  | HitterStatProp['lineupSource']
  | PitcherStrikeoutProp['lineupSource']
  | PitcherLineProp['lineupSource'];

const hitterStatConfigs: HitterStatConfig[] = [
  { market: 'hitter_hits', title: 'Hits board', shortLabel: 'Hits', displayLabel: 'hits' },
  { market: 'hitter_runs', title: 'Runs board', shortLabel: 'Runs', displayLabel: 'runs' },
  {
    market: 'hitter_rbis',
    title: 'Runs batted in board',
    shortLabel: 'RBI',
    displayLabel: 'runs batted in',
  },
  {
    market: 'hitter_total_bases',
    title: 'Total bases board',
    shortLabel: 'TB',
    displayLabel: 'total bases',
  },
  { market: 'hitter_walks', title: 'Walks board', shortLabel: 'Walks', displayLabel: 'walks' },
];

const pitcherLineConfigs: PitcherLineConfig[] = [
  {
    market: 'pitcher_walks',
    title: 'Pitcher walks board',
    shortLabel: 'Walks',
    displayLabel: 'walks allowed',
    glossaryKey: 'walksAllowed',
  },
  {
    market: 'pitcher_outs',
    title: 'Pitcher outs board',
    shortLabel: 'Outs',
    displayLabel: 'outs recorded',
    glossaryKey: 'outs',
  },
];

const confidenceLabels: Record<Exclude<ConfidenceFilter, 'all'>, string> = {
  elite: 'Elite',
  core: 'Core',
  strong: 'Strong',
  watch: 'Medium',
  thin: 'Low',
};

const confidenceRank: Record<Exclude<ConfidenceFilter, 'all'>, number> = {
  elite: 5,
  core: 4,
  strong: 3,
  watch: 2,
  thin: 1,
};

const deltaChipClass = (value: number): string =>
  value >= 0 ? 'chip chip-confirmed' : 'chip chip-accent';

const lineupSourceLabel = (value: LineupSource): string => {
  if (value === 'official') {
    return 'Official';
  }
  if (value === 'mixed') {
    return 'Mixed';
  }
  return 'Projected';
};

const lineupSourceChipClass = (value: LineupSource): string => {
  if (value === 'official') {
    return 'chip chip-confirmed';
  }
  if (value === 'mixed') {
    return 'chip chip-warning';
  }
  return 'chip chip-muted';
};

const matchesSearch = (value: string, tokens: Array<string | null | undefined>): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return tokens.some((token) => (token ?? '').toLowerCase().includes(normalized));
};

const confidenceValue = (value: string): number =>
  confidenceRank[value as Exclude<ConfidenceFilter, 'all'>] ?? 0;

const sortHomeRunProps = (props: HitterHomeRunProp[], sortKey: PropSortKey): HitterHomeRunProp[] =>
  [...props].sort((left, right) => {
    if (sortKey === 'player_asc') {
      return left.playerName.localeCompare(right.playerName);
    }
    if (sortKey === 'projection_desc' || sortKey === 'edge_desc') {
      return (
        right.blendedProbability - left.blendedProbability
        || right.homeRunScore - left.homeRunScore
      );
    }
    return (
      confidenceValue(right.confidence) - confidenceValue(left.confidence)
      || right.blendedProbability - left.blendedProbability
      || right.homeRunScore - left.homeRunScore
    );
  });

const sortStrikeoutProps = (
  props: PitcherStrikeoutProp[],
  sortKey: PropSortKey,
): PitcherStrikeoutProp[] =>
  [...props].sort((left, right) => {
    if (sortKey === 'player_asc') {
      return left.playerName.localeCompare(right.playerName);
    }
    if (sortKey === 'projection_desc') {
      return right.meanKs - left.meanKs || right.medianKs - left.medianKs;
    }
    if (sortKey === 'edge_desc') {
      return right.over4_5Probability - left.over4_5Probability || right.meanKs - left.meanKs;
    }
    return (
      confidenceValue(right.confidence) - confidenceValue(left.confidence)
      || right.over4_5Probability - left.over4_5Probability
      || right.meanKs - left.meanKs
    );
  });

const sortHitterStatProps = (
  props: HitterStatProp[],
  sortKey: PropSortKey,
): HitterStatProp[] =>
  [...props].sort((left, right) => {
    if (sortKey === 'player_asc') {
      return left.playerName.localeCompare(right.playerName);
    }
    if (sortKey === 'projection_desc') {
      return right.projectionValue - left.projectionValue || right.marketScore - left.marketScore;
    }
    if (sortKey === 'edge_desc') {
      return right.deltaVsLine - left.deltaVsLine || right.marketScore - left.marketScore;
    }
    return (
      confidenceValue(right.confidence) - confidenceValue(left.confidence)
      || right.deltaVsLine - left.deltaVsLine
      || right.marketScore - left.marketScore
    );
  });

const sortPitcherLineProps = (
  props: PitcherLineProp[],
  sortKey: PropSortKey,
): PitcherLineProp[] =>
  [...props].sort((left, right) => {
    if (sortKey === 'player_asc') {
      return left.playerName.localeCompare(right.playerName);
    }
    if (sortKey === 'projection_desc') {
      return (
        right.projectionValue - left.projectionValue
        || right.marketScore - left.marketScore
      );
    }
    if (sortKey === 'edge_desc') {
      return right.deltaVsLine - left.deltaVsLine || right.marketScore - left.marketScore;
    }
    return (
      confidenceValue(right.confidence) - confidenceValue(left.confidence)
      || right.deltaVsLine - left.deltaVsLine
      || right.marketScore - left.marketScore
    );
  });

const hitterMarketDisplayLabel = (market: HitterStatMarket): string =>
  hitterStatConfigs.find((config) => config.market === market)?.displayLabel ?? 'prop';

const hitterMarketGlossaryKey = (market: HitterStatMarket) => {
  if (market === 'hitter_total_bases') {
    return 'tb' as const;
  }
  if (market === 'hitter_rbis') {
    return 'rbi' as const;
  }
  if (market === 'hitter_hits') {
    return 'hits' as const;
  }
  if (market === 'hitter_runs') {
    return 'runs' as const;
  }
  return 'walks' as const;
};

const pitcherLineDisplayLabel = (market: PitcherLineMarket): string =>
  pitcherLineConfigs.find((config) => config.market === market)?.displayLabel ?? 'pitcher prop';

export function PropsExplorer(props: PropsExplorerProps) {
  const { selectedDate, addSelectedProp, isPropSelected } = useSelectedProps();
  const [marketFilter, setMarketFilter] = useState<PropMarketFilter>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [sortKey, setSortKey] = useState<PropSortKey>('confidence_desc');
  const [search, setSearch] = useState('');
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const filteredHomeRunProps = useMemo(
    () =>
      sortHomeRunProps(
        props.homeRunProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== 'hitter_home_run') {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && !prop.lineupConfirmed) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
    [props.homeRunProps, marketFilter, confidenceFilter, confirmedOnly, deferredSearch, sortKey],
  );

  const filteredStrikeoutProps = useMemo(
    () =>
      sortStrikeoutProps(
        props.strikeoutProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== 'pitcher_strikeouts') {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && (prop.metrics.opponentConfirmedHitterCount ?? 0) < 9) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
    [props.strikeoutProps, marketFilter, confidenceFilter, deferredSearch, sortKey],
  );

  const filteredHitterStatProps = useMemo(
    () => ({
      hitter_hits: sortHitterStatProps(
        props.hitterHitsProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && !prop.lineupConfirmed) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
      hitter_runs: sortHitterStatProps(
        props.hitterRunsProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && !prop.lineupConfirmed) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
      hitter_rbis: sortHitterStatProps(
        props.hitterRbisProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && !prop.lineupConfirmed) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
      hitter_total_bases: sortHitterStatProps(
        props.hitterTotalBasesProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && !prop.lineupConfirmed) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
      hitter_walks: sortHitterStatProps(
        props.hitterWalksProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && !prop.lineupConfirmed) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            lineupSourceLabel(prop.lineupSource),
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
    }),
    [
      props.hitterHitsProps,
      props.hitterRunsProps,
      props.hitterRbisProps,
      props.hitterTotalBasesProps,
      props.hitterWalksProps,
      marketFilter,
      confidenceFilter,
      confirmedOnly,
      deferredSearch,
      sortKey,
    ],
  );

  const filteredPitcherLineProps = useMemo(
    () => ({
      pitcher_walks: sortPitcherLineProps(
        props.pitcherWalkProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && prop.metrics.confirmedLineupSpots < 9) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
      pitcher_outs: sortPitcherLineProps(
        props.pitcherOutsProps.filter((prop) => {
          if (marketFilter !== 'all' && marketFilter !== prop.market) {
            return false;
          }
          if (confidenceFilter !== 'all' && prop.confidence !== confidenceFilter) {
            return false;
          }
          if (confirmedOnly && prop.metrics.confirmedLineupSpots < 9) {
            return false;
          }
          return matchesSearch(deferredSearch, [
            prop.playerName,
            prop.teamAbbreviation,
            prop.opponentAbbreviation,
            prop.matchupLabel,
            ...prop.reasons,
          ]);
        }),
        sortKey,
      ),
    }),
    [
      props.pitcherWalkProps,
      props.pitcherOutsProps,
      marketFilter,
      confidenceFilter,
      confirmedOnly,
      deferredSearch,
      sortKey,
    ],
  );

  const totalShown =
    filteredHomeRunProps.length
    + filteredStrikeoutProps.length
    + hitterStatConfigs.reduce(
      (total, config) => total + filteredHitterStatProps[config.market].length,
      0,
    )
    + pitcherLineConfigs.reduce(
      (total, config) => total + filteredPitcherLineProps[config.market].length,
      0,
    );

  return (
    <section className="panel props-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Props Workspace</p>
          <h2>Searchable prop boards with hitter and pitcher confidence</h2>
        </div>
        <span className="chip">{totalShown} props shown</span>
      </div>

      <div className="props-toolbar">
        <label className="field props-search">
          <span>Search props</span>
          <input
            type="search"
            placeholder="Judge, runs batted in, walks, strikeouts, lineup..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Market</span>
          <select
            value={marketFilter}
            onChange={(event) => setMarketFilter(event.target.value as PropMarketFilter)}
          >
            <option value="all">All props</option>
            <option value="hitter_home_run">Home run props</option>
            <option value="hitter_hits">Hits props</option>
            <option value="hitter_runs">Runs props</option>
            <option value="hitter_rbis">Runs batted in props</option>
            <option value="hitter_total_bases">Total bases props</option>
            <option value="hitter_walks">Walks props</option>
            <option value="pitcher_strikeouts">Pitcher strikeouts</option>
            <option value="pitcher_walks">Pitcher walks</option>
            <option value="pitcher_outs">Pitcher outs</option>
          </select>
        </label>

        <label className="field">
          <span>Confidence</span>
          <select
            value={confidenceFilter}
            onChange={(event) => setConfidenceFilter(event.target.value as ConfidenceFilter)}
          >
            <option value="all">All confidence levels</option>
            <option value="elite">{confidenceLabels.elite}</option>
            <option value="core">{confidenceLabels.core}</option>
            <option value="strong">{confidenceLabels.strong}</option>
            <option value="watch">{confidenceLabels.watch}</option>
            <option value="thin">{confidenceLabels.thin}</option>
          </select>
        </label>

        <label className="field">
          <span>Sort</span>
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as PropSortKey)}
          >
            <option value="confidence_desc">Confidence</option>
            <option value="edge_desc">Edge vs line</option>
            <option value="projection_desc">Projection</option>
            <option value="player_asc">Player name</option>
          </select>
        </label>

        <label className="props-toggle">
          <input
            type="checkbox"
            checked={confirmedOnly}
            onChange={(event) => setConfirmedOnly(event.target.checked)}
          />
          <span>Confirmed lineups only</span>
        </label>
      </div>

      <div className="props-market-summary">
        <InfoChip
          className="chip chip-muted"
          label={String(filteredHomeRunProps.length)}
          value="HR"
          glossaryKey="hr"
        />
        <span className="chip chip-muted">{filteredHitterStatProps.hitter_hits.length} hits</span>
        <span className="chip chip-muted">{filteredHitterStatProps.hitter_runs.length} runs</span>
        <InfoChip
          className="chip chip-muted"
          label={String(filteredHitterStatProps.hitter_rbis.length)}
          value="RBI"
          glossaryKey="rbi"
        />
        <InfoChip
          className="chip chip-muted"
          label={String(filteredHitterStatProps.hitter_total_bases.length)}
          value="TB"
          glossaryKey="tb"
        />
        <span className="chip chip-muted">{filteredHitterStatProps.hitter_walks.length} walks</span>
        <InfoChip
          className="chip chip-muted"
          label={String(filteredStrikeoutProps.length)}
          value="Ks"
          glossaryKey="projectedKs"
        />
        <span className="chip chip-muted">
          {filteredPitcherLineProps.pitcher_walks.length} pitcher walks
        </span>
        <span className="chip chip-muted">
          {filteredPitcherLineProps.pitcher_outs.length} pitcher outs
        </span>
      </div>

      {(marketFilter === 'all' || marketFilter === 'hitter_home_run') && (
        <div className="prop-market-block">
          <div className="prop-market-heading">
            <div>
              <p className="eyebrow">Hitter Props</p>
              <h3>Home run board</h3>
            </div>
            <span className="chip">{filteredHomeRunProps.length} shown</span>
          </div>

          {filteredHomeRunProps.length > 0 ? (
            <div className="props-grid">
              {filteredHomeRunProps.map((prop) => (
                <article
                  key={`${prop.market}-${prop.entityId}`}
                  className={`prop-card prop-card-${prop.confidence}`}
                >
                  <div className="prop-card-top">
                    <div>
                      <p className="player-team">
                        {prop.teamAbbreviation} vs {prop.opponentAbbreviation}
                      </p>
                      <h3>
                        {props.onOpenPlayerDetail ? (
                          <PlayerNameButton
                            name={prop.playerName}
                            onClick={() =>
                              props.onOpenPlayerDetail?.('hitter', prop.entityId, prop.gameId)
                            }
                          />
                        ) : (
                          prop.playerName
                        )}
                      </h3>
                    </div>
                    <div
                      className={`score-badge score-badge-prop ${getProbabilityTone(
                        prop.blendedProbability,
                      )}`}
                    >
                      <InfoLabel label="HR model" glossaryKey="hrScore" />
                      <strong>{formatProbability(prop.blendedProbability)}</strong>
                    </div>
                  </div>

                  <div className="prop-meta-row">
                    <span className={confidenceChipClass(prop.confidence)}>
                      {confidenceLabels[prop.confidence]}
                    </span>
                    <InfoChip
                      className="chip chip-muted"
                      label="Spot"
                      value={prop.lineupSpot}
                      glossaryKey="lineupSpot"
                    />
                    <InfoChip
                      className={lineupSourceChipClass(prop.lineupSource)}
                      label="Lineup"
                      value={lineupSourceLabel(prop.lineupSource)}
                      glossaryKey="lineupSource"
                    />
                  </div>

                  <div className="prop-stat-grid">
                    <div>
                      <InfoLabel label="HR score" glossaryKey="hrScore" />
                      <strong>{formatNumber(prop.homeRunScore, 1)}</strong>
                    </div>
                    <div>
                      <InfoLabel label="Bat speed" glossaryKey="batSpeed" />
                      <strong>{formatNumber(prop.metrics.averageBatSpeed, 1, ' mph')}</strong>
                    </div>
                    <div>
                      <InfoLabel label="Park vs hand" glossaryKey="parkVsHand" />
                      <strong>{formatNumber(prop.metrics.homeRunParkFactorVsHandedness, 0)}</strong>
                    </div>
                    <div>
                      <InfoLabel label="Pitch mix" glossaryKey="mixFit" />
                      <strong>{formatNumber(prop.metrics.pitchMixMatchupScore, 1)}</strong>
                    </div>
                  </div>

                  <div className="metric-row">
                    <InfoChip
                      className="chip"
                      label="Hard-hit"
                      value={formatPercent(prop.metrics.hardHitRate, 1)}
                      glossaryKey="hardHitRate"
                    />
                    <InfoChip
                      className="chip"
                      label="Barrel"
                      value={formatPercent(prop.metrics.barrelRate, 1)}
                      glossaryKey="barrelRate"
                    />
                    <InfoChip
                      className="chip"
                      label="BvP score"
                      value={formatNumber(prop.metrics.batterVsPitcherScore, 1)}
                      glossaryKey="bvpScore"
                    />
                    <InfoChip
                      className="chip"
                      label="Recent form"
                      value={formatNumber(prop.metrics.recentForm, 1)}
                      glossaryKey="recentForm"
                    />
                  </div>

                  <div className="selected-prop-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() =>
                        void addSelectedProp(createSelectedPropFromHomeRunProp(prop, selectedDate))
                      }
                      disabled={isPropSelected(
                        'hitter_home_run',
                        prop.entityId,
                        prop.gameId,
                        0.5,
                        'over',
                      )}
                    >
                      {isPropSelected('hitter_home_run', prop.entityId, prop.gameId, 0.5, 'over')
                        ? 'Tracked home run'
                        : 'Track home run'}
                    </button>
                  </div>

                  <ul className="reasons-list">
                    {prop.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No home run props matched the current search.</p>
          )}
        </div>
      )}

      {hitterStatConfigs.map((config) => {
        const items = filteredHitterStatProps[config.market];
        if (marketFilter !== 'all' && marketFilter !== config.market) {
          return null;
        }

        return (
          <div key={config.market} className="prop-market-block">
            <div className="prop-market-heading">
              <div>
                <p className="eyebrow">Hitter Props</p>
                <h3>{config.title}</h3>
              </div>
              <span className="chip">{items.length} shown</span>
            </div>

            {items.length > 0 ? (
              <div className="props-grid">
                {items.map((prop) => (
                  <article
                    key={`${prop.market}-${prop.entityId}`}
                    className={`prop-card prop-card-${prop.confidence}`}
                  >
                    <div className="prop-card-top">
                      <div>
                        <p className="player-team">
                          {prop.teamAbbreviation} vs {prop.opponentAbbreviation}
                        </p>
                        <h3>
                          {props.onOpenPlayerDetail ? (
                            <PlayerNameButton
                              name={prop.playerName}
                              onClick={() =>
                                props.onOpenPlayerDetail?.('hitter', prop.entityId, prop.gameId)
                              }
                            />
                          ) : (
                            prop.playerName
                          )}
                        </h3>
                      </div>
                      <div className="score-badge score-badge-prop">
                        <InfoLabel
                          label={`${config.shortLabel} proj`}
                          glossaryKey={hitterMarketGlossaryKey(config.market)}
                        />
                        <strong>{formatNumber(prop.projectionValue, 2)}</strong>
                      </div>
                    </div>

                    <div className="prop-meta-row">
                      <span className={confidenceChipClass(prop.confidence)}>
                        {formatConfidenceLabel(prop.confidence)}
                      </span>
                      <InfoChip
                        className="chip chip-muted"
                        label="Spot"
                        value={prop.lineupSpot}
                        glossaryKey="lineupSpot"
                      />
                      <InfoChip
                        className={lineupSourceChipClass(prop.lineupSource)}
                        label="Lineup"
                        value={lineupSourceLabel(prop.lineupSource)}
                        glossaryKey="lineupSource"
                      />
                      <span className={deltaChipClass(prop.deltaVsLine)}>
                        {prop.deltaVsLine >= 0 ? '+' : ''}
                        {formatNumber(prop.deltaVsLine, 2)} edge
                      </span>
                      {prop.metrics.isRookieSeason ? (
                        <span className="chip chip-warning">Rookie season</span>
                      ) : null}
                    </div>

                    <div className="prop-stat-grid">
                      <div>
                        <InfoLabel label="Board line" glossaryKey="line" />
                        <strong>Over {formatNumber(prop.lineValue, 1)}</strong>
                      </div>
                      <div>
                        <InfoLabel label="Projection" glossaryKey="projection" />
                        <strong>{formatNumber(prop.projectionValue, 2)}</strong>
                      </div>
                      <div>
                        <InfoLabel label="Confidence score" glossaryKey="confidenceScore" />
                        <strong>{formatNumber(prop.marketScore, 1)}</strong>
                      </div>
                      <div>
                        <InfoLabel label="Projected PA" glossaryKey="projectedPa" />
                        <strong>{formatNumber(prop.metrics.projectedPlateAppearances, 2)}</strong>
                      </div>
                    </div>

                    <div className="metric-row">
                      <InfoChip
                        className="chip"
                        label="AVG"
                        value={formatNumber(prop.metrics.averageVsHandedness, 3)}
                        glossaryKey="avg"
                      />
                      <InfoChip
                        className="chip"
                        label="OBP"
                        value={formatNumber(prop.metrics.obpVsHandedness, 3)}
                        glossaryKey="obp"
                      />
                      <InfoChip
                        className="chip"
                        label="SLG"
                        value={formatNumber(prop.metrics.sluggingVsHandedness, 3)}
                        glossaryKey="slg"
                      />
                      <InfoChip
                        className="chip"
                        label="BB-rate"
                        value={formatPercent(prop.metrics.walkRate, 1)}
                        glossaryKey="bbRate"
                      />
                      <InfoChip
                        className="chip"
                        label="BvP"
                        value={formatNumber(prop.metrics.batterVsPitcherScore, 1)}
                        glossaryKey="bvpScore"
                      />
                      <InfoChip
                        className="chip"
                        label="Mix"
                        value={formatNumber(prop.metrics.pitchMixMatchupScore, 1)}
                        glossaryKey="mixFit"
                      />
                      <InfoChip
                        className="chip"
                        label="Recent"
                        value={formatNumber(prop.metrics.recentForm, 1)}
                        glossaryKey="recentForm"
                      />
                      <InfoChip
                        className="chip"
                        label="Pitcher BB"
                        value={formatPercent(prop.metrics.opponentPitcherWalkRateAllowed, 1)}
                        glossaryKey="bbRate"
                      />
                    </div>

                    <PropTrackControls
                      defaultLineValue={prop.lineValue}
                      statLabel={hitterMarketDisplayLabel(prop.market)}
                      isTracked={(selectionSide, lineValue) =>
                        isPropSelected(
                          prop.market,
                          prop.entityId,
                          prop.gameId,
                          lineValue,
                          selectionSide,
                        )
                      }
                      onTrack={(selectionSide, lineValue) =>
                        void addSelectedProp(
                          createSelectedPropFromHitterStatProp(
                            prop,
                            selectedDate,
                            lineValue,
                            selectionSide,
                          ),
                        )
                      }
                    />

                    {prop.metrics.isRookieSeason && prop.metrics.rookieSeasonWarning ? (
                      <p className="helper-text">{prop.metrics.rookieSeasonWarning}</p>
                    ) : null}

                    <ul className="reasons-list">
                      {prop.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No {hitterMarketDisplayLabel(config.market)} props matched the current search.
              </p>
            )}
          </div>
        );
      })}

      {(marketFilter === 'all' || marketFilter === 'pitcher_strikeouts') && (
        <div className="prop-market-block">
          <div className="prop-market-heading">
            <div>
              <p className="eyebrow">Pitcher Props</p>
              <h3>Projected strikeouts vs opponent</h3>
            </div>
            <span className="chip">{filteredStrikeoutProps.length} shown</span>
          </div>

          {filteredStrikeoutProps.length > 0 ? (
            <div className="props-grid">
              {filteredStrikeoutProps.map((prop) => (
                <article
                  key={`${prop.market}-${prop.entityId}`}
                  className={`prop-card prop-card-${prop.confidence}`}
                >
                  <div className="prop-card-top">
                    <div>
                      <p className="player-team">
                        {prop.teamAbbreviation} vs {prop.opponentAbbreviation}
                      </p>
                      <h3>
                        {props.onOpenPlayerDetail ? (
                          <PlayerNameButton
                            name={prop.playerName}
                            onClick={() =>
                              props.onOpenPlayerDetail?.('pitcher', prop.entityId, prop.gameId)
                            }
                          />
                        ) : (
                          prop.playerName
                        )}
                      </h3>
                    </div>
                    <div className="score-badge score-badge-prop">
                      <InfoLabel
                        label={`Strikeouts vs ${prop.opponentAbbreviation}`}
                        glossaryKey="projectedKs"
                      />
                      <strong>{formatNumber(prop.meanKs, 1)}</strong>
                    </div>
                  </div>

                  <div className="prop-meta-row">
                    <span className={confidenceChipClass(prop.confidence)}>
                      {confidenceLabels[prop.confidence]}
                    </span>
                    <InfoChip
                      className={lineupSourceChipClass(prop.lineupSource)}
                      label="Lineup"
                      value={lineupSourceLabel(prop.lineupSource)}
                      glossaryKey="lineupSource"
                    />
                    <span className="chip chip-muted">Median {formatNumber(prop.medianKs, 1)}</span>
                    <InfoChip
                      className="chip chip-muted"
                      label="O4.5"
                      value={formatProbability(prop.over4_5Probability)}
                      glossaryKey="over45"
                    />
                    <InfoChip
                      className="chip chip-muted"
                      label="IP"
                      value={formatNumber(prop.inningsProjection, 1)}
                      glossaryKey="ip"
                    />
                  </div>

                  <div className="prop-stat-grid">
                    <div>
                      <InfoLabel label="Over 3.5" glossaryKey="over35" />
                      <strong>{formatProbability(prop.over3_5Probability)}</strong>
                    </div>
                    <div>
                      <InfoLabel label="Over 4.5" glossaryKey="over45" />
                      <strong>{formatProbability(prop.over4_5Probability)}</strong>
                    </div>
                    <div>
                      <InfoLabel label="Expected BF" glossaryKey="expectedBf" />
                      <strong>{formatNumber(prop.metrics.projectionLayer.expectedBattersFaced, 1)}</strong>
                    </div>
                    <div>
                      <InfoLabel label="Lineup K vs hand" glossaryKey="lineupKVsHand" />
                      <strong>{formatPercent(prop.metrics.lineupVsPitcherHandKRate, 1)}</strong>
                    </div>
                  </div>

                  <div className="metric-row">
                    <InfoChip
                      className="chip"
                      label="K rate"
                      value={formatPercent(prop.metrics.strikeoutRate, 1)}
                      glossaryKey="kRate"
                    />
                    <InfoChip
                      className="chip"
                      label="SwStr"
                      value={formatPercent(prop.metrics.swingingStrikeRate, 1)}
                      glossaryKey="swStr"
                    />
                    <InfoChip
                      className="chip"
                      label="Mix edge"
                      value={formatNumber(prop.metrics.pitchMixAdvantageScore, 1)}
                      glossaryKey="mixEdge"
                    />
                    <InfoChip
                      className="chip"
                      label="K park"
                      value={formatNumber(prop.metrics.strikeoutParkFactor, 0)}
                      glossaryKey="kPark"
                    />
                    <InfoChip
                      className="chip"
                      label="Role"
                      value={formatNumber(prop.metrics.riskLayer.roleCertainty, 1)}
                      glossaryKey="roleCertainty"
                    />
                    <InfoChip
                      className="chip"
                      label="Risk"
                      value={formatNumber(prop.metrics.riskLayer.earlyExitRisk, 1)}
                      glossaryKey="earlyExitRisk"
                    />
                  </div>

                  <PropTrackControls
                    defaultLineValue={4.5}
                    statLabel="strikeouts"
                    isTracked={(selectionSide, lineValue) =>
                      isPropSelected(
                        'pitcher_strikeouts',
                        prop.entityId,
                        prop.gameId,
                        lineValue,
                        selectionSide,
                      )
                    }
                    onTrack={(selectionSide, lineValue) =>
                      void addSelectedProp(
                        createSelectedPropFromStrikeoutProp(
                          prop,
                          selectedDate,
                          lineValue,
                          selectionSide,
                        ),
                      )
                    }
                  />

                  <ul className="reasons-list">
                    {prop.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No strikeout props matched the current search.</p>
          )}
        </div>
      )}

      {pitcherLineConfigs.map((config) => {
        const items = filteredPitcherLineProps[config.market];
        if (marketFilter !== 'all' && marketFilter !== config.market) {
          return null;
        }

        return (
          <div key={config.market} className="prop-market-block">
            <div className="prop-market-heading">
              <div>
                <p className="eyebrow">Pitcher Props</p>
                <h3>{config.title}</h3>
              </div>
              <span className="chip">{items.length} shown</span>
            </div>

            {items.length > 0 ? (
              <div className="props-grid">
                {items.map((prop) => (
                  <article
                    key={`${prop.market}-${prop.entityId}`}
                    className={`prop-card prop-card-${prop.confidence}`}
                  >
                    <div className="prop-card-top">
                      <div>
                        <p className="player-team">
                          {prop.teamAbbreviation} vs {prop.opponentAbbreviation}
                        </p>
                        <h3>
                          {props.onOpenPlayerDetail ? (
                            <PlayerNameButton
                              name={prop.playerName}
                              onClick={() =>
                                props.onOpenPlayerDetail?.('pitcher', prop.entityId, prop.gameId)
                              }
                            />
                          ) : (
                            prop.playerName
                          )}
                        </h3>
                      </div>
                      <div className="score-badge score-badge-prop">
                        <InfoLabel label={`${config.shortLabel} proj`} glossaryKey={config.glossaryKey} />
                        <strong>{formatNumber(prop.projectionValue, 2)}</strong>
                      </div>
                    </div>

                    <div className="prop-meta-row">
                      <span className={confidenceChipClass(prop.confidence)}>
                        {formatConfidenceLabel(prop.confidence)}
                      </span>
                      <span className={deltaChipClass(prop.deltaVsLine)}>
                        {prop.deltaVsLine >= 0 ? '+' : ''}
                        {formatNumber(prop.deltaVsLine, 2)} edge
                      </span>
                      <InfoChip
                        className="chip chip-muted"
                        label="IP"
                        value={formatNumber(prop.metrics.inningsProjection, 1)}
                        glossaryKey="ip"
                      />
                      <InfoChip
                        className={lineupSourceChipClass(prop.lineupSource)}
                        label="Lineup"
                        value={lineupSourceLabel(prop.lineupSource)}
                        glossaryKey="lineupSource"
                      />
                      <InfoChip
                        className="chip chip-muted"
                        label="Conf"
                        value={formatNumber(prop.metrics.lineupConfidence, 1)}
                        glossaryKey="lineupConfidence"
                      />
                    </div>

                    <div className="prop-stat-grid">
                      <div>
                        <InfoLabel label="Board line" glossaryKey="line" />
                        <strong>Over {formatNumber(prop.lineValue, 1)}</strong>
                      </div>
                      <div>
                        <InfoLabel label="Projection" glossaryKey="projection" />
                        <strong>{formatNumber(prop.projectionValue, 2)}</strong>
                      </div>
                      <div>
                        <InfoLabel label="Confidence score" glossaryKey="confidenceScore" />
                        <strong>{formatNumber(prop.marketScore, 1)}</strong>
                      </div>
                      <div>
                        <InfoLabel
                          label={config.market === 'pitcher_walks' ? 'Expected BF' : 'Projected outs'}
                          glossaryKey={config.market === 'pitcher_walks' ? 'expectedBf' : 'projectedOuts'}
                        />
                        <strong>
                          {config.market === 'pitcher_walks'
                            ? formatNumber(prop.metrics.expectedBattersFaced, 1)
                            : formatNumber(prop.metrics.projectedOuts, 1)}
                        </strong>
                      </div>
                    </div>

                    <div className="metric-row">
                      <InfoChip
                        className="chip"
                        label="Walk rate"
                        value={formatPercent(prop.metrics.walkRate, 1)}
                        glossaryKey="bbRate"
                      />
                      <InfoChip
                        className="chip"
                        label="Opp BB"
                        value={formatPercent(prop.metrics.opponentWalkRate, 1)}
                        glossaryKey="opponentWalkRate"
                      />
                      <InfoChip
                        className="chip"
                        label="Projected outs"
                        value={formatNumber(prop.metrics.projectedOuts, 1)}
                        glossaryKey="projectedOuts"
                      />
                      <InfoChip
                        className="chip"
                        label="Role"
                        value={formatNumber(prop.metrics.roleCertainty, 1)}
                        glossaryKey="roleCertainty"
                      />
                      <InfoChip
                        className="chip"
                        label="Pitch cap"
                        value={formatNumber(prop.metrics.pitchCountCap, 1)}
                        glossaryKey="pitchCap"
                      />
                      <InfoChip
                        className="chip"
                        label="Risk"
                        value={formatNumber(prop.metrics.earlyExitRisk, 1)}
                        glossaryKey="earlyExitRisk"
                      />
                    </div>

                    <PropTrackControls
                      defaultLineValue={prop.lineValue}
                      statLabel={pitcherLineDisplayLabel(prop.market)}
                      isTracked={(selectionSide, lineValue) =>
                        isPropSelected(
                          prop.market,
                          prop.entityId,
                          prop.gameId,
                          lineValue,
                          selectionSide,
                        )
                      }
                      onTrack={(selectionSide, lineValue) =>
                        void addSelectedProp(
                          createSelectedPropFromPitcherLineProp(
                            prop,
                            selectedDate,
                            lineValue,
                            selectionSide,
                          ),
                        )
                      }
                    />

                    <ul className="reasons-list">
                      {prop.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No {pitcherLineDisplayLabel(config.market)} props matched the current search.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
