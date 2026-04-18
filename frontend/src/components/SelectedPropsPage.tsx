import { useMemo } from 'react';

import { useLiveSelectedProps } from '../hooks/useLiveSelectedProps';
import { useSelectedProps } from '../hooks/useSelectedProps';
import { SelectedPropCard } from './SelectedPropCard';

const groupOrder = [
  {
    key: 'live',
    title: 'Live Props',
    subtitle: 'Games currently in progress',
  },
  {
    key: 'pregame',
    title: 'Pregame Props',
    subtitle: 'Tracked plays waiting for first pitch',
  },
  {
    key: 'settled',
    title: 'Settled Props',
    subtitle: 'Final, won, lost, push, or postponed',
  },
] as const;

export function SelectedPropsPage() {
  const {
    selectedDate,
    selectedProps,
    removeSelectedProp,
    refreshSelectedProps,
    isLoading,
    error,
  } = useSelectedProps();
  const { liveSelectedProps, isLiveLoading } = useLiveSelectedProps();

  const liveStateById = useMemo(
    () => new Map(liveSelectedProps.map((item) => [item.selectedPropId, item])),
    [liveSelectedProps],
  );

  const groupedProps = useMemo(() => {
    const live: typeof selectedProps = [];
    const pregame: typeof selectedProps = [];
    const settled: typeof selectedProps = [];

    selectedProps.forEach((selectedProp) => {
      const liveProp = liveStateById.get(selectedProp.id);
      if (!liveProp) {
        pregame.push(selectedProp);
        return;
      }

      if (liveProp.gameStatus === 'Live') {
        live.push(selectedProp);
        return;
      }

      if (
        ['won', 'lost', 'cleared', 'final', 'push', 'postponed', 'suspended'].includes(
          liveProp.resultStatus,
        )
      ) {
        settled.push(selectedProp);
        return;
      }

      pregame.push(selectedProp);
    });

    return {
      live,
      pregame,
      settled,
    };
  }, [selectedProps, liveStateById]);

  const summary = {
    total: selectedProps.length,
    live: liveSelectedProps.filter((item) => item.gameStatus === 'Live').length,
    cleared: liveSelectedProps.filter((item) => ['cleared', 'won'].includes(item.resultStatus)).length,
    lost: liveSelectedProps.filter((item) => item.resultStatus === 'lost').length,
    push: liveSelectedProps.filter((item) => item.resultStatus === 'push').length,
  };

  return (
    <section className="panel selected-props-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Selected Props</p>
          <h2>Live tracker for the props you decided to follow</h2>
        </div>

        <div className="button-row">
          <button type="button" className="button-secondary" onClick={() => void refreshSelectedProps()}>
            {isLoading || isLiveLoading ? 'Refreshing...' : 'Refresh tracker'}
          </button>
        </div>
      </div>

      <div className="props-market-summary">
        <span className="chip chip-muted">{summary.total} tracked</span>
        <span className="chip chip-muted">{summary.live} live</span>
        <span className="chip chip-confirmed">{summary.cleared} cleared</span>
        <span className="chip chip-accent">{summary.lost} lost</span>
        <span className="chip chip-muted">{summary.push} push</span>
        <span className="chip chip-muted">Date {selectedDate}</span>
      </div>

      {error ? <p className="empty-state">{error}</p> : null}

      {selectedProps.length === 0 ? (
        <p className="empty-state">
          No props selected yet. Add player props from the boards or track a game total from the games tab.
        </p>
      ) : (
        <div className="selected-props-groups">
          {groupOrder.map((group) => {
            const items = groupedProps[group.key];
            if (items.length === 0) {
              return null;
            }

            return (
              <section key={group.key} className="selected-props-group">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">{group.subtitle}</p>
                    <h2>{group.title}</h2>
                  </div>
                  <span className="chip">{items.length} shown</span>
                </div>

                <div className="selected-props-grid">
                  {items.map((selectedProp) => (
                    <SelectedPropCard
                      key={selectedProp.id}
                      selectedProp={selectedProp}
                      liveProp={liveStateById.get(selectedProp.id)}
                      onRemove={(selectedPropId) => {
                        void removeSelectedProp(selectedPropId);
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
