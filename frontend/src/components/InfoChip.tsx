import type { ReactNode } from 'react';

import type { StatGlossaryKey } from '../content/statGlossary';
import { InfoTip } from './InfoTip';

interface InfoChipProps {
  className: string;
  label: string;
  value?: ReactNode;
  glossaryKey: StatGlossaryKey;
}

export function InfoChip({ className, label, value, glossaryKey }: InfoChipProps) {
  return (
    <span className={className}>
      {label}
      {value != null ? ` ${String(value)}` : ''}
      <InfoTip glossaryKey={glossaryKey} />
    </span>
  );
}
