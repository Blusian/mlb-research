import type { GameInfo, LineupEntry } from '@mlb-analyzer/shared';

import { useSelectedProps } from '../hooks/useSelectedProps';
import { createSelectedPropFromGameTotal, defaultGameTotalTrackingLine } from '../utils/selectedProps';
import { formatHandedness } from '../utils/handedness';
import { InfoLabel } from './InfoLabel';
import { PropTrackControls } from './PropTrackControls';

interface GamesGridProps {
  games: GameInfo[];
}

const formatProjectedRuns = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '--';

const formatStartTime = (value: string): string =>
  new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

const formatWeather = (game: GameInfo): string => {
  if (!game.weather) {
    return 'Weather unavailable';
  }

  const details = [game.weather.condition];

  if (typeof game.weather.temperatureF === 'number') {
    details.push(`${game.weather.temperatureF}F`);
  }

  if (typeof game.weather.precipitationProbability === 'number') {
    details.push(`${game.weather.precipitationProbability}% precip`);
  }

  if (game.weather.wind) {
    details.push(game.weather.wind);
  }

  return details.join(' / ');
};

const homePlateUmpire = (game: GameInfo): string =>
  game.officials.find((official) => official.type.toLowerCase().includes('home'))?.name ?? 'TBD';

const lineupLabel = (entries: LineupEntry[]): string =>
  entries.length > 0 ? entries[0]!.status : 'projected';

const lineupClassName = (entries: LineupEntry[]): string =>
  entries.length > 0 && entries[0]!.status === 'confirmed' ? 'chip chip-confirmed' : 'chip';

const runLeanLabel = (game: GameInfo): string => {
  if (game.runProjection?.overUnderLean === 'over') {
    return 'Over lean';
  }
  if (game.runProjection?.overUnderLean === 'under') {
    return 'Under lean';
  }
  return 'Neutral';
};

const runLeanClassName = (game: GameInfo): string => {
  if (game.runProjection?.overUnderLean === 'over') {
    return 'chip game-total-over';
  }
  if (game.runProjection?.overUnderLean === 'under') {
    return 'chip game-total-under';
  }
  return 'chip game-total-neutral';
};

const renderLineup = (teamCode: string, entries: LineupEntry[]) => (
  <div className="lineup-card">
    <div className="lineup-header">
      <strong>{teamCode}</strong>
      <span className={lineupClassName(entries)}>{lineupLabel(entries)}</span>
    </div>

    {entries.length > 0 ? (
      <ol className="lineup-list">
        {entries.map((entry) => (
          <li key={entry.playerId}>
            <span>{entry.battingOrder}.</span>
            <span>{entry.playerName}</span>
            <span>{formatHandedness(entry.bats)}</span>
          </li>
        ))}
      </ol>
    ) : (
      <p className="lineup-empty">Lineup not posted yet.</p>
    )}
  </div>
);

export function GamesGrid({ games }: GamesGridProps) {
  const { selectedDate, addSelectedProp, isPropSelected } = useSelectedProps();

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Today&apos;s Games</p>
          <h2>Slate context, lineups, weather, and officials</h2>
        </div>
        <span className="chip">{games.length} games</span>
      </div>

      <div className="games-grid">
        {games.map((game) => {
          const defaultLineValue = defaultGameTotalTrackingLine(game);
          const gameTotalEntityId = `game-total:${game.gameId}`;

          return (
            <article key={game.gameId} className="game-card">
              <div className="game-card-top">
                <span className="chip chip-muted">{formatStartTime(game.startTime)}</span>
                <span className="chip chip-accent">{game.lineupStatus}</span>
                <span className="chip">{game.status.replace('_', ' ')}</span>
              </div>
              <h3>{game.matchupLabel}</h3>
              <p className="game-venue">
                {game.venue.name} / {game.venue.city}
              </p>
              {game.runProjection ? (
                <>
                  <div className="game-total-banner">
                    <div>
                      <InfoLabel label="Projected total" glossaryKey="projectedTotalRuns" />
                      <strong>{formatProjectedRuns(game.runProjection.totalRuns)} runs</strong>
                    </div>
                    <div className="game-total-split">
                      <span>
                        {game.awayTeam.abbreviation} {formatProjectedRuns(game.runProjection.away.projectedRuns)}
                      </span>
                      <span>
                        {game.homeTeam.abbreviation} {formatProjectedRuns(game.runProjection.home.projectedRuns)}
                      </span>
                      <span className={runLeanClassName(game)}>{runLeanLabel(game)}</span>
                    </div>
                  </div>

                  <PropTrackControls
                    defaultLineValue={defaultLineValue}
                    statLabel="total runs"
                    isTracked={(selectionSide, lineValue) =>
                      isPropSelected(
                        'game_total_runs',
                        gameTotalEntityId,
                        game.gameId,
                        lineValue,
                        selectionSide,
                      )
                    }
                    onTrack={(selectionSide, lineValue) =>
                      void addSelectedProp(
                        createSelectedPropFromGameTotal(
                          game,
                          selectedDate,
                          lineValue,
                          selectionSide,
                        ),
                      )
                    }
                  />
                </>
              ) : null}
              <dl className="game-meta">
                <div>
                  <dt><InfoLabel label="Away SP" glossaryKey="startingPitcher" /></dt>
                  <dd>{game.probablePitchers.away?.name ?? 'TBD'}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Home SP" glossaryKey="startingPitcher" /></dt>
                  <dd>{game.probablePitchers.home?.name ?? 'TBD'}</dd>
                </div>
                <div>
                  <dt>Weather</dt>
                  <dd>{formatWeather(game)}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Home plate ump" glossaryKey="homePlateUmpire" /></dt>
                  <dd>{homePlateUmpire(game)}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Park factor" glossaryKey="parkFactor" /></dt>
                  <dd>{game.venue.parkFactor}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="HR factor" glossaryKey="hrFactor" /></dt>
                  <dd>{game.venue.homeRunFactor}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Away projected runs" glossaryKey="projectedTotalRuns" /></dt>
                  <dd>{formatProjectedRuns(game.runProjection?.away.projectedRuns)}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Home projected runs" glossaryKey="projectedTotalRuns" /></dt>
                  <dd>{formatProjectedRuns(game.runProjection?.home.projectedRuns)}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Total projected runs" glossaryKey="projectedTotalRuns" /></dt>
                  <dd>{formatProjectedRuns(game.runProjection?.totalRuns)}</dd>
                </div>
                <div>
                  <dt><InfoLabel label="Projection confidence" glossaryKey="projectionConfidence" /></dt>
                  <dd>{game.runProjection?.confidenceRating ?? 'Unavailable'}</dd>
                </div>
              </dl>

              {game.runProjection?.reasons.length ? (
                <div className="notes-row game-notes-row">
                  {game.runProjection.reasons.map((reason) => (
                    <span key={reason} className="chip chip-muted">
                      {reason}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="lineups-grid">
                {renderLineup(game.awayTeam.abbreviation, game.lineups.away)}
                {renderLineup(game.homeTeam.abbreviation, game.lineups.home)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
