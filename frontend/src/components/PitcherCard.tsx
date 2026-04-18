import type { AttackablePitcher, RankedPitcher } from '@mlb-analyzer/shared';

import {
  confidenceChipClass,
  formatConfidenceLabel,
  formatTrendLabel,
  trendChipClass,
} from '../utils/confidence';
import { formatHandedness } from '../utils/handedness';
import { InfoChip } from './InfoChip';
import { InfoLabel } from './InfoLabel';
import { PlayerNameButton } from './PlayerNameButton';

interface PitcherCardProps {
  pitcher: RankedPitcher | AttackablePitcher;
  variant: 'overall' | 'attack';
  onOpenPlayerDetail?: (role: 'hitter' | 'pitcher', playerId: string, gameId: string) => void;
}

const isAttackablePitcher = (pitcher: RankedPitcher | AttackablePitcher): pitcher is AttackablePitcher =>
  'attackScore' in pitcher;

export const PitcherCard = ({ pitcher, variant, onOpenPlayerDetail }: PitcherCardProps) => {
  const projectedKsVsOpponent = pitcher.metrics.projectedStrikeoutsVsOpponent;
  const lineupKRate =
    pitcher.metrics.lineupVsPitcherHandKRate
    ?? pitcher.metrics.lineupStrikeoutRateVsHand
    ?? pitcher.metrics.opponentStrikeoutRate;
  const trackedHitters = pitcher.metrics.opponentLineupCount ?? 0;
  const confirmedHitters = pitcher.metrics.opponentConfirmedHitterCount ?? 0;

  return (
    <article className="player-card">
      <div className="player-card-top">
        <div>
          <p className="player-team">
            {pitcher.team.abbreviation} vs {pitcher.opponent.abbreviation}
          </p>
          <h3>
            {onOpenPlayerDetail ? (
              <PlayerNameButton
                name={pitcher.playerName}
                onClick={() => onOpenPlayerDetail('pitcher', pitcher.playerId, pitcher.gameId)}
              />
            ) : (
              pitcher.playerName
            )}
          </h3>
          <div className="player-card-chips">
            <span className={confidenceChipClass(pitcher.scores.confidenceRating)}>
              Confidence {formatConfidenceLabel(pitcher.scores.confidenceRating)}
            </span>
            <span className={trendChipClass(pitcher.metrics.seasonGrowthPercent)}>
              {formatTrendLabel(pitcher.metrics.seasonGrowthPercent)}
            </span>
            {pitcher.metrics.isRookieSeason ? (
              <span className="chip chip-warning">Rookie season</span>
            ) : null}
          </div>
        </div>
        <div className="score-badge">
          <span>{variant === 'attack' ? 'Attack' : 'Pitch'}</span>
          <strong>
            {variant === 'attack' && isAttackablePitcher(pitcher)
              ? pitcher.attackScore.toFixed(1)
              : pitcher.scores.overallPitcherScore.toFixed(1)}
          </strong>
        </div>
      </div>

      <div className="prop-stat-grid compact-stat-grid">
        <div>
          <InfoLabel
            label={`Projected strikeouts vs ${pitcher.opponent.abbreviation}`}
            glossaryKey="projectedKs"
          />
          <strong>{projectedKsVsOpponent?.toFixed(1) ?? '--'}</strong>
        </div>
        <div>
          <InfoLabel
            label={`Lineup strikeout rate vs ${formatHandedness(pitcher.throwingHand)}`}
            glossaryKey="lineupKVsHand"
          />
          <strong>{lineupKRate.toFixed(1)}%</strong>
        </div>
        <div>
          <InfoLabel label="Tracked hitters" />
          <strong>{trackedHitters > 0 ? `${confirmedHitters}/${trackedHitters}` : '--'}</strong>
        </div>
        <div>
          <InfoLabel label="Matchup K rate" glossaryKey="matchupKRate" />
          <strong>{pitcher.metrics.matchupAdjustedKRate?.toFixed(1) ?? '--'}%</strong>
        </div>
        <div>
          <InfoLabel label="K park" glossaryKey="kPark" />
          <strong>{pitcher.metrics.strikeoutParkFactor.toFixed(0)}</strong>
        </div>
        <div>
          <InfoLabel label="Recent form" glossaryKey="recentForm" />
          <strong>{pitcher.metrics.recentForm.toFixed(1)}</strong>
        </div>
        <div>
          <InfoLabel label="Current BF" glossaryKey="currentBf" />
          <strong>{(pitcher.metrics.battersFaced ?? 0).toFixed(0)}</strong>
        </div>
        <div>
          <InfoLabel label="History BF" glossaryKey="historyBf" />
          <strong>{(pitcher.metrics.previousSeasonsBattersFaced ?? 0).toFixed(0)}</strong>
        </div>
      </div>

      <div className="score-row">
        <InfoChip
          className="score-chip"
          label="Pitch"
          value={pitcher.scores.overallPitcherScore.toFixed(1)}
          glossaryKey="pitchScore"
        />
        <InfoChip
          className="score-chip"
          label="K"
          value={pitcher.scores.strikeoutUpsideScore.toFixed(1)}
          glossaryKey="projectedKs"
        />
        <InfoChip
          className="score-chip"
          label="Safe"
          value={pitcher.scores.safetyScore.toFixed(1)}
          glossaryKey="safeScore"
        />
        <InfoChip
          className="score-chip"
          label="Risk"
          value={pitcher.scores.blowupRiskScore.toFixed(1)}
          glossaryKey="riskScore"
        />
      </div>

      <div className="metric-row">
        <InfoChip
          className="chip"
          label="Hand"
          value={formatHandedness(pitcher.throwingHand)}
          glossaryKey="hand"
        />
        <InfoChip
          className="chip"
          label="K-rate"
          value={`${pitcher.metrics.strikeoutRate.toFixed(1)}%`}
          glossaryKey="kRate"
        />
        <InfoChip
          className="chip"
          label="BB-rate"
          value={`${pitcher.metrics.walkRate.toFixed(1)}%`}
          glossaryKey="bbRate"
        />
        <InfoChip
          className="chip"
          label="IP"
          value={pitcher.metrics.inningsProjection.toFixed(1)}
          glossaryKey="ip"
        />
        <span>{formatTrendLabel(pitcher.metrics.seasonGrowthPercent)} vs history</span>
      </div>

      {pitcher.metrics.isRookieSeason && pitcher.metrics.rookieSeasonWarning ? (
        <p className="helper-text">{pitcher.metrics.rookieSeasonWarning}</p>
      ) : null}

      <ul className="reasons-list">
        {(variant === 'attack' && isAttackablePitcher(pitcher)
          ? pitcher.attackReasons
          : pitcher.reasons
        ).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </article>
  );
};
