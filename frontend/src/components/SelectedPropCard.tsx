import type { LiveSelectedProp, SelectedProp } from '@mlb-analyzer/shared';

import { InfoLabel } from './InfoLabel';

const propTypeLabels: Record<SelectedProp['propType'], string> = {
  game_total_runs: 'Game total',
  pitcher_strikeouts: 'Pitcher strikeouts',
  pitcher_walks: 'Pitcher walks',
  pitcher_outs: 'Pitcher outs',
  hitter_home_run: 'Home run',
  hitter_hits: 'Hits',
  hitter_runs: 'Runs',
  hitter_rbis: 'Runs batted in',
  hitter_total_bases: 'Total bases',
  hitter_walks: 'Walks',
};

const statusChipClass = (status: string): string => {
  if (['won', 'cleared'].includes(status)) {
    return 'chip chip-confirmed';
  }
  if (['lost', 'final'].includes(status)) {
    return 'chip chip-accent';
  }
  return 'chip chip-muted';
};

const clearTarget = (
  lineValue?: number | null,
  selectionSide: SelectedProp['selectionSide'] = 'over',
): number | null => {
  if (lineValue == null) {
    return null;
  }
  if (selectionSide === 'under') {
    return lineValue;
  }
  return Math.floor(lineValue) + 1;
};

const formatProjection = (propType: SelectedProp['propType'], value?: number | null): string => {
  if (value == null) {
    return '--';
  }
  if (propType === 'hitter_home_run') {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (propType === 'game_total_runs') {
    return value.toFixed(1);
  }
  return value.toFixed(2);
};

const formatLine = (
  lineValue?: number | null,
  selectionSide: SelectedProp['selectionSide'] = 'over',
): string => lineValue == null
  ? 'No line'
  : `${selectionSide === 'under' ? 'Under' : 'Over'} ${lineValue.toFixed(1)}`;

const inningLabel = (liveProp?: LiveSelectedProp): string => {
  if (!liveProp) {
    return 'Pregame';
  }
  if (liveProp.gameStatus !== 'Live') {
    return liveProp.gameStatus;
  }
  if (!liveProp.inningNumber || !liveProp.inningState) {
    return 'Live';
  }
  const outsLabel =
    liveProp.outs != null ? `, ${liveProp.outs} out${liveProp.outs === 1 ? '' : 's'}` : '';
  return `${liveProp.inningState} ${liveProp.inningNumber}${outsLabel}`;
};

const progressSummary = (prop: SelectedProp, liveProp?: LiveSelectedProp): string => {
  if (!liveProp) {
    return 'Waiting for live game feed.';
  }

  if (prop.propType === 'pitcher_strikeouts') {
    return `${liveProp.currentValue.toFixed(0)} strikeouts, ${liveProp.statBreakdown.battersFaced ?? 0} batters faced, ${liveProp.statBreakdown.pitchCount ?? 0} pitches.`;
  }

  if (prop.propType === 'pitcher_walks') {
    return `${liveProp.currentValue.toFixed(0)} walks allowed through ${liveProp.statBreakdown.battersFaced ?? 0} batters faced and ${liveProp.statBreakdown.pitchCount ?? 0} pitches.`;
  }

  if (prop.propType === 'pitcher_outs') {
    return `${liveProp.currentValue.toFixed(0)} outs recorded through ${liveProp.statBreakdown.inningsPitched ?? '0.0'} innings and ${liveProp.statBreakdown.pitchCount ?? 0} pitches.`;
  }

  if (prop.propType === 'game_total_runs') {
    return `${liveProp.currentValue.toFixed(0)} total runs so far, ${liveProp.statBreakdown.awayRuns ?? 0} away and ${liveProp.statBreakdown.homeRuns ?? 0} home.`;
  }

  if (prop.propType === 'hitter_hits') {
    return `${liveProp.currentValue.toFixed(0)} hits through ${liveProp.statBreakdown.atBats ?? 0} at-bats / ${liveProp.statBreakdown.plateAppearances ?? 0} plate appearances.`;
  }

  if (prop.propType === 'hitter_runs') {
    return `${liveProp.currentValue.toFixed(0)} runs through ${liveProp.statBreakdown.plateAppearances ?? 0} plate appearances with ${liveProp.statBreakdown.hits ?? 0} hits and ${liveProp.statBreakdown.walks ?? 0} walks.`;
  }

  if (prop.propType === 'hitter_rbis') {
    return `${liveProp.currentValue.toFixed(0)} runs batted in through ${liveProp.statBreakdown.atBats ?? 0} at-bats / ${liveProp.statBreakdown.plateAppearances ?? 0} plate appearances with ${liveProp.statBreakdown.hits ?? 0} hits.`;
  }

  if (prop.propType === 'hitter_total_bases') {
    return `${liveProp.currentValue.toFixed(0)} total bases with ${liveProp.statBreakdown.singles ?? 0} singles, ${liveProp.statBreakdown.doubles ?? 0} doubles, ${liveProp.statBreakdown.triples ?? 0} triples, ${liveProp.statBreakdown.homeRuns ?? 0} home runs.`;
  }

  if (prop.propType === 'hitter_walks') {
    return `${liveProp.currentValue.toFixed(0)} walks through ${liveProp.statBreakdown.plateAppearances ?? 0} plate appearances with ${liveProp.statBreakdown.hits ?? 0} hits.`;
  }

  return liveProp.statBreakdown.hasHomer
    ? `Home run hit through ${liveProp.statBreakdown.plateAppearances ?? 0} plate appearances.`
    : `No home run yet through ${liveProp.statBreakdown.atBats ?? 0} at-bats / ${liveProp.statBreakdown.plateAppearances ?? 0} plate appearances.`;
};

const deltaLabel = (liveProp?: LiveSelectedProp): string => {
  if (!liveProp || liveProp.deltaVsLine == null) {
    return 'No line delta';
  }
  return `${liveProp.deltaVsLine >= 0 ? '+' : ''}${liveProp.deltaVsLine.toFixed(1)} vs line`;
};

const progressBarClass = (liveProp?: LiveSelectedProp): string => {
  if (!liveProp) {
    return 'selected-prop-progress-bar';
  }
  if (liveProp.resultStatus === 'push') {
    return 'selected-prop-progress-bar is-push';
  }
  if (['lost', 'final'].includes(liveProp.resultStatus)) {
    return 'selected-prop-progress-bar is-lost';
  }
  return 'selected-prop-progress-bar';
};

const progressWidth = (liveProp?: LiveSelectedProp): number => {
  if (!liveProp || liveProp.gameStatus === 'Pregame') {
    return 0;
  }
  if (liveProp.resultStatus === 'push') {
    return 50;
  }
  const required = clearTarget(liveProp.targetLine, liveProp.selectionSide);
  if (required == null || required <= 0) {
    return liveProp.isCleared ? 100 : 0;
  }
  if (liveProp.selectionSide === 'under') {
    return Math.max(0, Math.min((liveProp.currentValue / required) * 100, 100));
  }
  return Math.max(0, Math.min((liveProp.currentValue / required) * 100, 100));
};

const remainingLabel = (selectedProp: SelectedProp, liveProp?: LiveSelectedProp): string | null => {
  if (!liveProp || liveProp.remainingToClear == null) {
    return null;
  }
  if (selectedProp.selectionSide === 'under') {
    return `${liveProp.remainingToClear.toFixed(1)} room to line`;
  }
  return `${liveProp.remainingToClear.toFixed(1)} remaining`;
};

const cardTitle = (selectedProp: SelectedProp): string =>
  selectedProp.propType === 'game_total_runs'
    ? (selectedProp.matchupLabel ?? selectedProp.playerName)
    : selectedProp.playerName;

export function SelectedPropCard({
  selectedProp,
  liveProp,
  onRemove,
}: {
  selectedProp: SelectedProp;
  liveProp?: LiveSelectedProp;
  onRemove: (selectedPropId: string) => void;
}) {
  return (
    <article className="selected-prop-card">
      <div className="selected-prop-top">
        <div>
          <p className="player-team">
            {selectedProp.team} vs {selectedProp.opponent}
          </p>
          <h3>{cardTitle(selectedProp)}</h3>
          <p className="selected-prop-label">
            {selectedProp.selectionLabel ?? propTypeLabels[selectedProp.propType]}
          </p>
        </div>

        <button
          type="button"
          className="button-secondary selected-prop-remove"
          onClick={() => onRemove(selectedProp.id)}
        >
          Remove
        </button>
      </div>

      <div className="prop-meta-row">
        <span className="chip chip-muted">{propTypeLabels[selectedProp.propType]}</span>
        <span className={statusChipClass(liveProp?.resultStatus ?? 'pregame')}>
          {liveProp?.resultStatus ?? 'pregame'}
        </span>
        <span className={statusChipClass(liveProp?.paceStatus ?? 'pregame')}>
          {liveProp?.paceStatus?.replaceAll('_', ' ') ?? 'pregame'}
        </span>
        {liveProp?.isLive ? <span className="chip chip-confirmed">Live</span> : null}
      </div>

      <div className="prop-stat-grid selected-prop-stat-grid">
        <div>
          <InfoLabel label="Line" glossaryKey="line" />
          <strong>{formatLine(selectedProp.lineValue, selectedProp.selectionSide)}</strong>
        </div>
        <div>
          <InfoLabel label="Projection" glossaryKey="projection" />
          <strong>{formatProjection(selectedProp.propType, selectedProp.projectionValue)}</strong>
        </div>
        <div>
          <InfoLabel label="Live" glossaryKey="live" />
          <strong>
            {selectedProp.propType === 'hitter_home_run'
              ? liveProp?.currentValue
                ? 'Home run hit'
                : 'No home run yet'
              : liveProp
                ? liveProp.currentValue.toFixed(0)
                : '--'}
          </strong>
        </div>
        <div>
          <InfoLabel label="Delta" glossaryKey="delta" />
          <strong>{deltaLabel(liveProp)}</strong>
        </div>
      </div>

      <div className="selected-prop-progress">
        <div className={progressBarClass(liveProp)} aria-hidden="true">
          <span style={{ width: `${progressWidth(liveProp)}%` }} />
        </div>
        <p className="helper-text">{progressSummary(selectedProp, liveProp)}</p>
      </div>

      <div className="metric-row">
        <span>{selectedProp.matchupLabel ?? `${selectedProp.team} vs ${selectedProp.opponent}`}</span>
        <span>{inningLabel(liveProp)}</span>
        {liveProp?.scoreLabel ? <span>{liveProp.scoreLabel}</span> : null}
        {selectedProp.confidence ? <span>Confidence {selectedProp.confidence}</span> : null}
        {remainingLabel(selectedProp, liveProp) ? <span>{remainingLabel(selectedProp, liveProp)}</span> : null}
      </div>

      {selectedProp.explanationSummary ? (
        <p className="helper-text">{selectedProp.explanationSummary}</p>
      ) : null}

      <p className="helper-text">
        Last updated{' '}
        {liveProp?.lastUpdatedAt
          ? new Date(liveProp.lastUpdatedAt).toLocaleTimeString()
          : new Date(selectedProp.createdAt).toLocaleTimeString()}
        .
      </p>
    </article>
  );
}
