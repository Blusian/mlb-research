import { useEffect, useState } from 'react';

import { glossaryEntries } from '../content/statGlossary';

export function StatGlossaryButton() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <>
      <button type="button" className="button-secondary glossary-trigger" onClick={() => setIsOpen(true)}>
        Stat glossary (i)
      </button>

      {isOpen ? (
        <div className="glossary-overlay" role="presentation" onClick={() => setIsOpen(false)}>
          <section
            className="glossary-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Stat glossary"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="glossary-header">
              <div>
                <p className="eyebrow">Stat Glossary</p>
                <h2>Definitions for the shorthand used across the app</h2>
              </div>
              <button type="button" className="button-secondary" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>

            <div className="glossary-grid">
              {glossaryEntries.map((entry) => (
                <article key={entry.key} className="glossary-item">
                  <strong>{entry.label}</strong>
                  <p>{entry.description}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
