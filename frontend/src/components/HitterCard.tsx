import type { RankedHitter } from '@mlb-analyzer/shared';

import { useSelectedProps } from '../hooks/useSelectedProps';
import {
  confidenceChipClass,
  formatConfidenceLabel,
  formatTrendLabel,
  trendChipClass,
} from '../utils/confidence';
import { createSelectedPropFromHitter } from '../utils/selectedProps';
import { formatHandedness } from '../utils/handedness';
import { formatNumber, formatPercent } from '../utils/number';
import { InfoChip } from './InfoChip';
import { InfoLabel } from './InfoLabel';
import { PlayerNameButton } from './PlayerNameButton';

interface HitterCardProps {
  hitter: RankedHitter;
  variant: 'overall' | 'home-run' | 'avoid';
  onOpenPlayerDetail?: (role: 'hitter' | 'pitcher', playerId: string, gameId: string) => void;
}

const scoreByVariant = {
  overall: (hitter: RankedHitter) => hitter.scores.overallHitScore,
  'home-run': (hitter: RankedHitter) => hitter.scores.homeRunUpsideScore,
  avoid: (hitter: RankedHitter) => hitter.scores.riskScore,
};

const labelByVariant = {
  overall: 'Overall',
  'home-run': 'Home run upside',
  avoid: 'Risk',
};

export const HitterCard = ({ hitter, variant, onOpenPlayerDetail }: HitterCardProps) => {
  const { selectedDate, addSelectedProp, isPropSelected } = useSelectedProps();
  const hrSelected = isPropSelected('hitter_home_run', hitter.playerId, hitter.gameId, 0.5);
  const hitsSelected = isPropSelected('hitter_hits', hitter.playerId, hitter.gameId, 1.5);
  const totalBasesSelected = isPropSelected(
    'hitter_total_bases',
    hitter.playerId,
    hitter.gameId,
    1.5,
  );
  const marketConfidence = hitter.scores.marketConfidence;
  const marketCards = marketConfidence
    ? [
        { label: 'Hits', value: marketConfidence.hits },
        { label: 'Runs', value: marketConfidence.runs },
        { label: 'RBI', value: marketConfidence.rbi },
        { label: 'Bases', value: marketConfidence.totalBases },
        { label: 'Walks', value: marketConfidence.walks },
      ]
    : [];

  return (
    <article className="player-card">
      <div className="player-card-top">
        <div>
          <p className="player-team">
            {hitter.team.abbreviation} vs {hitter.opponent.abbreviation}
          </p>
          <h3>
            {onOpenPlayerDetail ? (
              <PlayerNameButton
                name={hitter.playerName}
                onClick={() => onOpenPlayerDetail('hitter', hitter.playerId, hitter.gameId)}
              />
            ) : (
              hitter.playerName
            )}
          </h3>
          <div className="player-card-chips">
            <span className={confidenceChipClass(hitter.scores.confidenceRating)}>
              Confidence {formatConfidenceLabel(hitter.scores.confidenceRating)}
            </span>
            <span className={trendChipClass(hitter.metrics.seasonGrowthPercent)}>
              {formatTrendLabel(hitter.metrics.seasonGrowthPercent)}
            </span>
            {hitter.metrics.isRookieSeason ? (
              <span className="chip chip-warning">Rookie season</span>
            ) : null}
          </div>
        </div>
        <div className="score-badge">
          <span>{labelByVariant[variant]}</span>
          <strong>{formatNumber(scoreByVariant[variant](hitter), 1)}</strong>
        </div>
      </div>

      <div className="selected-prop-actions">
        <button
          type="button"
          className="button-secondary"
          onClick={() =>
            void addSelectedProp(createSelectedPropFromHitter(hitter, selectedDate, 'hitter_home_run'))
          }
          disabled={hrSelected}
        >
          {hrSelected ? 'Tracked home run' : 'Track home run'}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() =>
            void addSelectedProp(createSelectedPropFromHitter(hitter, selectedDate, 'hitter_hits'))
          }
          disabled={hitsSelected}
        >
          {hitsSelected ? 'Tracked hits' : 'Track over 1.5 hits'}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() =>
            void addSelectedProp(createSelectedPropFromHitter(hitter, selectedDate, 'hitter_total_bases'))
          }
          disabled={totalBasesSelected}
        >
          {totalBasesSelected ? 'Tracked total bases' : 'Track over 1.5 total bases'}
        </button>
      </div>

      <div className="prop-stat-grid compact-stat-grid">
        <div>
          <InfoLabel label="Bat speed" glossaryKey="batSpeed" />
          <strong>{formatNumber(hitter.metrics.averageBatSpeed, 1, ' mph')}</strong>
        </div>
        <div>
          <InfoLabel label="Blast rate" glossaryKey="blastRate" />
          <strong>{formatPercent(hitter.metrics.blastRate, 1)}</strong>
        </div>
        <div>
          <InfoLabel label="Park vs hand" glossaryKey="parkVsHand" />
          <strong>{formatNumber(hitter.metrics.homeRunParkFactorVsHandedness, 0)}</strong>
        </div>
        <div>
          <InfoLabel label="Recent form" glossaryKey="recentForm" />
          <strong>{formatNumber(hitter.metrics.recentForm, 1)}</strong>
        </div>
        <div>
          <InfoLabel label="BvP" glossaryKey="bvp" />
          <strong>
            {hitter.metrics.batterVsPitcherPlateAppearances > 0
              ? formatNumber(hitter.metrics.batterVsPitcherOps, 3, ' OPS')
              : '--'}
          </strong>
        </div>
        <div>
          <InfoLabel label="Pitch mix fit" glossaryKey="mixFit" />
          <strong>{formatNumber(hitter.metrics.pitchMixMatchupScore, 1)}</strong>
        </div>
        <div>
          <InfoLabel label="Current PA" glossaryKey="currentPa" />
          <strong>{formatNumber(hitter.metrics.currentSplitPlateAppearances ?? 0, 0)}</strong>
        </div>
        <div>
          <InfoLabel label="History PA" glossaryKey="historyPa" />
          <strong>{formatNumber(hitter.metrics.previousSeasonsPlateAppearances ?? 0, 0)}</strong>
        </div>
      </div>

      <div className="score-row">
        <InfoChip
          className="score-chip"
          label="Hit"
          value={formatNumber(hitter.scores.overallHitScore, 1)}
          glossaryKey="hitScore"
        />
        <InfoChip
          className="score-chip"
          label="HR"
          value={formatNumber(hitter.scores.homeRunUpsideScore, 1)}
          glossaryKey="hrScore"
        />
        <InfoChip
          className="score-chip"
          label="Floor"
          value={formatNumber(hitter.scores.floorScore, 1)}
          glossaryKey="floorScore"
        />
        <InfoChip
          className="score-chip"
          label="Risk"
          value={formatNumber(hitter.scores.riskScore, 1)}
          glossaryKey="riskScore"
        />
      </div>

      {marketCards.length > 0 ? (
        <div className="prop-layer-block">
          <p className="eyebrow">Matchup-Based Hitting Confidence</p>
          <div className="prop-stat-grid compact-stat-grid">
            {marketCards.map((market) => (
              <div key={market.label} className="market-confidence-cell">
                <InfoLabel label={market.label} />
                <strong>{formatNumber(market.value.score, 1)}</strong>
                <span className={confidenceChipClass(market.value.confidenceRating)}>
                  {formatConfidenceLabel(market.value.confidenceRating)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="metric-row">
        <InfoChip
          className="chip"
          label="Hand"
          value={formatHandedness(hitter.bats)}
          glossaryKey="hand"
        />
        <InfoChip
          className="chip"
          label="Spot"
          value={hitter.metrics.lineupSpot}
          glossaryKey="lineupSpot"
        />
        <InfoChip
          className="chip"
          label="Hard-hit"
          value={formatPercent(hitter.metrics.hardHitRate, 1)}
          glossaryKey="hardHitRate"
        />
        <InfoChip
          className="chip"
          label="Barrel"
          value={formatPercent(hitter.metrics.barrelRate, 1)}
          glossaryKey="barrelRate"
        />
        <InfoChip
          className="chip"
          label="Squared-up"
          value={formatPercent(hitter.metrics.squaredUpRate, 1)}
          glossaryKey="squaredUpRate"
        />
        <InfoChip
          className="chip"
          label="BvP score"
          value={formatNumber(hitter.metrics.batterVsPitcherScore, 1)}
          glossaryKey="bvpScore"
        />
        <span>{formatTrendLabel(hitter.metrics.seasonGrowthPercent)} vs history</span>
        <span>
          {hitter.metrics.primaryPitchTypeDescription}{' '}
          {formatPercent(hitter.metrics.primaryPitchUsage, 1)}
        </span>
      </div>

      {hitter.metrics.isRookieSeason && hitter.metrics.rookieSeasonWarning ? (
        <p className="helper-text">{hitter.metrics.rookieSeasonWarning}</p>
      ) : null}

      <ul className="reasons-list">
        {hitter.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </article>
  );
};
