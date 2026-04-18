import type { ReactNode } from 'react';

interface RankingSectionProps {
  sectionId?: string;
  title: string;
  subtitle: string;
  count: number;
  emptyMessage?: string;
  children: ReactNode;
}

export const RankingSection = ({
  sectionId,
  title,
  subtitle,
  count,
  emptyMessage = 'No players matched the current filters.',
  children,
}: RankingSectionProps) => (
  <section id={sectionId} className="panel ranking-panel">
    <div className="section-heading">
      <div>
        <p className="eyebrow">{subtitle}</p>
        <h2>{title}</h2>
      </div>
      <span className="chip">{count} shown</span>
    </div>

    {count > 0 ? <div className="ranking-stack">{children}</div> : <p className="empty-state">{emptyMessage}</p>}
  </section>
);
