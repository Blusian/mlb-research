interface WorkspaceTab {
  id: string;
  label: string;
  count?: number;
}

interface WorkspaceTabsProps {
  tabs: readonly WorkspaceTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function WorkspaceTabs({ tabs, activeTab, onChange }: WorkspaceTabsProps) {
  return (
    <section className="panel workspace-tabs-panel" aria-label="Workspace views">
      <div className="workspace-tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              type="button"
              className={`workspace-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => onChange(tab.id)}
              aria-pressed={isActive}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' ? (
                <strong>{tab.count}</strong>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
