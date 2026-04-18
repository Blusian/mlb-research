import { resolveGlossaryKey, type StatGlossaryKey } from '../content/statGlossary';
import { InfoTip } from './InfoTip';

interface InfoLabelProps {
  label: string;
  glossaryKey?: StatGlossaryKey | null;
  className?: string;
}

export function InfoLabel({ label, glossaryKey, className }: InfoLabelProps) {
  const resolvedGlossaryKey = glossaryKey ?? resolveGlossaryKey(label);

  return (
    <span className={className ? `info-label ${className}` : 'info-label'}>
      {label}
      {resolvedGlossaryKey ? <InfoTip glossaryKey={resolvedGlossaryKey} /> : null}
    </span>
  );
}
