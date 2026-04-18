import type {
  DailyAnalysisFilters,
  Handedness,
  HitterScoreType,
  PitcherScoreType,
} from '@mlb-analyzer/shared';

interface FiltersBarProps {
  options?: DailyAnalysisFilters;
  selectedDate: string;
  selectedTeam: string;
  selectedMatchup: string;
  selectedHandedness: Handedness | 'ALL';
  selectedHitterScoreType: HitterScoreType;
  selectedPitcherScoreType: PitcherScoreType;
  onDateChange: (date: string) => void;
  onTeamChange: (team: string) => void;
  onMatchupChange: (matchup: string) => void;
  onHandednessChange: (handedness: Handedness | 'ALL') => void;
  onHitterScoreTypeChange: (scoreType: HitterScoreType) => void;
  onPitcherScoreTypeChange: (scoreType: PitcherScoreType) => void;
}

const hitterScoreLabels: Record<HitterScoreType, string> = {
  overall_hit_score: 'Overall hit score',
  home_run_upside_score: 'Home run upside',
  floor_score: 'Floor score',
  risk_score: 'Risk score',
};

const pitcherScoreLabels: Record<PitcherScoreType, string> = {
  overall_pitcher_score: 'Overall pitcher score',
  strikeout_upside_score: 'Strikeout upside',
  safety_score: 'Safety score',
  blowup_risk_score: 'Blowup risk',
};

const fallbackHitterScoreTypes: HitterScoreType[] = [
  'overall_hit_score',
  'home_run_upside_score',
  'floor_score',
  'risk_score',
];

const fallbackPitcherScoreTypes: PitcherScoreType[] = [
  'overall_pitcher_score',
  'strikeout_upside_score',
  'safety_score',
  'blowup_risk_score',
];

export const FiltersBar = ({
  options,
  selectedDate,
  selectedTeam,
  selectedMatchup,
  selectedHandedness,
  selectedHitterScoreType,
  selectedPitcherScoreType,
  onDateChange,
  onTeamChange,
  onMatchupChange,
  onHandednessChange,
  onHitterScoreTypeChange,
  onPitcherScoreTypeChange,
}: FiltersBarProps) => (
  <section className="panel">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Filters</p>
        <h2>Trim every board in the workspace the way you want to study it</h2>
      </div>
    </div>

    <div className="filters-grid filters-grid-wide">
      <label className="field">
        <span>Date</span>
        <input
          type="date"
          value={selectedDate}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Team</span>
        <select value={selectedTeam} onChange={(event) => onTeamChange(event.target.value)}>
          <option value="ALL">All teams</option>
          {options?.teams.map((team) => (
            <option key={team} value={team}>
              {team}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Matchup</span>
        <select value={selectedMatchup} onChange={(event) => onMatchupChange(event.target.value)}>
          <option value="ALL">All matchups</option>
          {options?.matchups.map((matchup) => (
            <option key={matchup.value} value={matchup.value}>
              {matchup.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Handedness</span>
        <select
          value={selectedHandedness}
          onChange={(event) => onHandednessChange(event.target.value as Handedness | 'ALL')}
        >
          <option value="ALL">All</option>
          <option value="L">Left</option>
          <option value="R">Right</option>
          <option value="S">Switch</option>
        </select>
      </label>

      <label className="field">
        <span>Hitter sort</span>
        <select
          value={selectedHitterScoreType}
          onChange={(event) => onHitterScoreTypeChange(event.target.value as HitterScoreType)}
        >
          {(options?.hitterScoreTypes ?? fallbackHitterScoreTypes).map((scoreType) => (
            <option key={scoreType} value={scoreType}>
              {hitterScoreLabels[scoreType]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Pitcher sort</span>
        <select
          value={selectedPitcherScoreType}
          onChange={(event) => onPitcherScoreTypeChange(event.target.value as PitcherScoreType)}
        >
          {(options?.pitcherScoreTypes ?? fallbackPitcherScoreTypes).map((scoreType) => (
            <option key={scoreType} value={scoreType}>
              {pitcherScoreLabels[scoreType]}
            </option>
          ))}
        </select>
      </label>
    </div>
  </section>
);
