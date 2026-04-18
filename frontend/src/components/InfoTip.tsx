import { useEffect, useId, useRef, useState } from 'react';

import { STAT_GLOSSARY, type StatGlossaryKey } from '../content/statGlossary';

interface InfoTipProps {
  glossaryKey: StatGlossaryKey;
}

export function InfoTip({ glossaryKey }: InfoTipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const entry = STAT_GLOSSARY[glossaryKey];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <span ref={rootRef} className="info-tip">
      <button
        type="button"
        className="info-tip-button"
        aria-expanded={isOpen}
        aria-controls={tooltipId}
        aria-label={`Explain ${entry.label}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        i
      </button>
      {isOpen ? (
        <div id={tooltipId} className="info-tip-popover" role="tooltip">
          <strong>{entry.label}</strong>
          <p>{entry.description}</p>
        </div>
      ) : null}
    </span>
  );
}
