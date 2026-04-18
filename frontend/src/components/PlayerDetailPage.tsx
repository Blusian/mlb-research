import type { PlayerDetailResponse, PlayerDetailStat } from '@mlb-analyzer/shared';

import { usePlayerDetail } from '../hooks/usePlayerDetail';
import type { PlayerDetailSelection } from '../types/playerDetail';
import { formatHandedness } from '../utils/handedness';
import { InfoLabel } from './InfoLabel';
import { PlayerNameButton } from './PlayerNameButton';

interface PlayerDetailPageProps {
  selection: PlayerDetailSelection;
  onClose: () => void;
  onOpenPlayerDetail: (role: 'hitter' | 'pitcher', playerId: string, gameId: string) => void;
}

const displayStatValue = (value: PlayerDetailStat['value']): string => {
  if (value === null || value === undefined) {
    return '--';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
};

const currentOpposingPitcher = (
  data: PlayerDetailResponse,
): { playerId: string; name: string } | null => {
  if (data.meta.role !== 'hitter' || !data.game) {
    return null;
  }

  const playerTeam = data.player.team.abbreviation;
  const probablePitcher =
    playerTeam === data.game.awayTeam.abbreviation
      ? data.game.probablePitchers.home
      : data.game.probablePitchers.away;

  if (!probablePitcher?.playerId) {
    return null;
  }

  return {
    playerId: probablePitcher.playerId,
    name: probablePitcher.name,
  };
};

export function PlayerDetailPage({
  selection,
  onClose,
  onOpenPlayerDetail,
}: PlayerDetailPageProps) {
  const { data, error, isLoading, refresh } = usePlayerDetail(selection);
  const opposingPitcher = data ? currentOpposingPitcher(data) : null;

  return (
    <section className="panel player-detail-shell">
      <div className="player-detail-header">
        <div>
          <button type="button" className="button-secondary player-detail-back" onClick={onClose}>
            Back to slate
          </button>
          <p className="eyebrow">Player Detail</p>
          <h1>{data?.player.playerName ?? 'Loading player detail...'}</h1>
          <div className="player-detail-meta">
            <span className="chip chip-muted">{selection.role}</span>
            <span className="chip chip-muted">{selection.date}</span>
            {data ? (
              <span className="chip chip-muted">
                {data.player.team.abbreviation} vs {data.player.opponent.abbreviation}
              </span>
            ) : null}
            {data?.game ? <span className="chip chip-muted">{data.game.matchupLabel}</span> : null}
          </div>
        </div>

        <div className="player-detail-actions">
          <button type="button" onClick={refresh} disabled={isLoading}>
            {isLoading ? 'Refreshing...' : 'Refresh detail'}
          </button>
        </div>
      </div>

      {error ? <div className="status-banner error">{error}</div> : null}
      {isLoading && !data ? <div className="status-banner">Loading player detail...</div> : null}

      {data ? (
        <>
          <div className="notes-row">
            {data.meta.notes.map((note) => (
              <span key={note} className="chip chip-muted">
                {note}
              </span>
            ))}
          </div>

          {opposingPitcher ? (
            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Current Matchup</p>
                  <h2>Today&apos;s opposing pitcher</h2>
                </div>
              </div>
              <div className="detail-inline-card">
                <span className="chip chip-muted">Pitcher</span>
                <PlayerNameButton
                  name={opposingPitcher.name}
                  onClick={() => onOpenPlayerDetail('pitcher', opposingPitcher.playerId, selection.gameId)}
                />
              </div>
            </section>
          ) : null}

          <div className="player-detail-grid">
            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Season Snapshot</p>
                  <h2>Overview stats</h2>
                </div>
              </div>
              <div className="detail-stat-grid">
                {data.overviewStats.map((stat) => (
                  <article key={stat.key} className="detail-stat-card">
                    <InfoLabel label={stat.label} />
                    <strong>{displayStatValue(stat.value)}</strong>
                  </article>
                ))}
              </div>
            </section>

            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Today&apos;s Matchup</p>
                  <h2>Slate context</h2>
                </div>
              </div>
              <div className="detail-stat-grid">
                {data.matchupStats.map((stat) => (
                  <article key={stat.key} className="detail-stat-card">
                    <InfoLabel label={stat.label} />
                    <strong>{displayStatValue(stat.value)}</strong>
                  </article>
                ))}
              </div>
            </section>
          </div>

          {data.pitchArsenal.length > 0 ? (
            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Pitch Mix</p>
                  <h2>Pitch arsenal</h2>
                </div>
              </div>
              <div className="detail-arsenal-grid">
                {data.pitchArsenal.map((pitch) => (
                  <article key={pitch.code} className="detail-stat-card">
                    <span>{pitch.description}</span>
                    <strong>{pitch.usage.toFixed(1)}%</strong>
                    <span>{pitch.averageSpeed.toFixed(1)} mph</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="detail-panel-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent Games</p>
                <h2>
                  {data.meta.role === 'pitcher' ? 'Previous starts' : 'Recent games'}
                </h2>
              </div>
              <span className="chip">{data.recentGames.length} shown</span>
            </div>

            {data.recentGames.length > 0 ? (
              <div className="detail-recent-grid">
                {data.recentGames.map((game) => (
                  <article
                    key={`${game.gameDate}-${game.opponentLabel}-${game.summary}`}
                    className="detail-recent-card"
                  >
                    <div className="detail-recent-header">
                      <div>
                        <p className="player-team">{game.opponentLabel}</p>
                        <h3>{game.gameDate}</h3>
                      </div>
                      <span className="chip chip-muted">{game.summary}</span>
                    </div>
                    <div className="detail-stat-grid compact-detail-stat-grid">
                      {game.statItems.map((stat) => (
                        <article key={`${game.gameDate}-${stat.key}`} className="detail-stat-card">
                          <InfoLabel label={stat.label} />
                          <strong>{displayStatValue(stat.value)}</strong>
                        </article>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No recent game log data was available.</p>
            )}
          </section>

          {data.lineupMatchups.length > 0 ? (
            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Current Lineup</p>
                  <h2>Pitcher vs current hitters</h2>
                </div>
              </div>

              <div className="detail-lineup-table">
                <div className="detail-lineup-head">
                  <span>Player</span>
                  <InfoLabel label="Order" glossaryKey="lineupSpot" />
                  <InfoLabel label="BvP PA" glossaryKey="bvpPa" />
                  <InfoLabel label="BvP OPS" glossaryKey="bvpOps" />
                  <InfoLabel label="BvP HR" glossaryKey="bvpHr" />
                  <InfoLabel label="BvP score" glossaryKey="bvpScore" />
                  <InfoLabel label="Hit score" glossaryKey="hitScore" />
                  <InfoLabel label="HR score" glossaryKey="hrScore" />
                  <InfoLabel label="Mix fit" glossaryKey="mixFit" />
                </div>

                {data.lineupMatchups.map((matchup) => (
                  <div key={matchup.playerId} className="detail-lineup-row">
                    <div className="detail-lineup-player">
                      <PlayerNameButton
                        name={matchup.playerName}
                        onClick={() =>
                          onOpenPlayerDetail('hitter', matchup.playerId, selection.gameId)
                        }
                      />
                      <span className="player-team">
                        {matchup.teamAbbreviation} {formatHandedness(matchup.bats)} {matchup.position ?? ''}
                      </span>
                    </div>
                    <span>{matchup.battingOrder}</span>
                    <span>{matchup.batterVsPitcher.plateAppearances}</span>
                    <span>{matchup.batterVsPitcher.ops.toFixed(3)}</span>
                    <span>{matchup.batterVsPitcher.homeRuns}</span>
                    <span>{matchup.batterVsPitcher.score.toFixed(1)}</span>
                    <span>{matchup.hitterScore.toFixed(1)}</span>
                    <span>{matchup.homeRunUpsideScore.toFixed(1)}</span>
                    <span>{matchup.pitchMixMatchupScore.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="player-detail-grid">
            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Model Notes</p>
                  <h2>Candidate notes</h2>
                </div>
              </div>
              <ul className="reasons-list">
                {data.player.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>

            <section className="detail-panel-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Why This Player Grades Here</p>
                  <h2>Current reasons</h2>
                </div>
              </div>
              <ul className="reasons-list">
                {data.player.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}
