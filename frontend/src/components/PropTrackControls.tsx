import type { SelectionSide } from '@mlb-analyzer/shared';
import { useEffect, useId, useState } from 'react';

import { InfoLabel } from './InfoLabel';

const normalizeLineInput = (value: string, fallback: number): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback.toFixed(1);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback.toFixed(1);
  }
  return parsed.toFixed(1);
};

interface PropTrackControlsProps {
  defaultLineValue: number;
  statLabel: string;
  lineStep?: number;
  selectionSide?: SelectionSide;
  onTrack: (selectionSide: SelectionSide, lineValue: number) => void;
  isTracked: (selectionSide: SelectionSide, lineValue: number) => boolean;
}

export function PropTrackControls({
  defaultLineValue,
  statLabel,
  lineStep = 0.5,
  selectionSide = 'over',
  onTrack,
  isTracked,
}: PropTrackControlsProps) {
  const [currentSide, setCurrentSide] = useState<SelectionSide>(selectionSide);
  const [lineInput, setLineInput] = useState(defaultLineValue.toFixed(1));
  const inputId = useId();

  useEffect(() => {
    setLineInput(defaultLineValue.toFixed(1));
  }, [defaultLineValue]);

  useEffect(() => {
    setCurrentSide(selectionSide);
  }, [selectionSide]);

  const parsedLineValue = Number(lineInput);
  const hasValidLine =
    lineInput.trim() !== '' && Number.isFinite(parsedLineValue) && parsedLineValue >= 0;
  const tracked = hasValidLine ? isTracked(currentSide, parsedLineValue) : false;
  const actionLabel = `${currentSide} ${hasValidLine ? parsedLineValue.toFixed(1) : '--'} ${statLabel}`;

  return (
    <div className="prop-track-controls">
      <div className="prop-track-row">
        <div className="prop-track-side-toggle" role="group" aria-label={`Track ${statLabel}`}>
          <button
            type="button"
            className={`prop-track-side-button ${currentSide === 'over' ? 'is-active' : ''}`}
            onClick={() => setCurrentSide('over')}
          >
            Over
          </button>
          <button
            type="button"
            className={`prop-track-side-button ${currentSide === 'under' ? 'is-active' : ''}`}
            onClick={() => setCurrentSide('under')}
          >
            Under
          </button>
        </div>

        <label className="field prop-track-line-field" htmlFor={inputId}>
          <InfoLabel label="Line" glossaryKey="line" />
          <input
            id={inputId}
            className="prop-track-line-input"
            type="number"
            min="0"
            step={lineStep}
            value={lineInput}
            onBlur={() => setLineInput((current) => normalizeLineInput(current, defaultLineValue))}
            onChange={(event) => setLineInput(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="button-secondary"
          disabled={!hasValidLine || tracked}
          onClick={() => {
            if (!hasValidLine) {
              return;
            }
            onTrack(currentSide, parsedLineValue);
          }}
        >
          {tracked ? `Tracking ${actionLabel}` : `Track ${actionLabel}`}
        </button>
      </div>

      <p className="helper-text">
        Default board line {defaultLineValue.toFixed(1)}. Change it if your book is offering a
        different number.
      </p>
    </div>
  );
}
