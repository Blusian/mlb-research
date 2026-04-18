from __future__ import annotations

from app.data_sources.mlb_stats_api import MlbStatsApiSource


class PlayerStatsService:
    def __init__(self, source: MlbStatsApiSource | None = None) -> None:
        self.source = source or MlbStatsApiSource()

    def get_hitter_stats(self, hitter_ids: list[str], season: str) -> dict:
        return self.source.get_people_stats(hitter_ids, "hitting", season)

    def get_pitcher_stats(self, pitcher_ids: list[str], season: str) -> dict:
        return self.source.get_people_stats(pitcher_ids, "pitching", season)

    def get_pitch_arsenal(self, pitcher_ids: list[str], season: str) -> dict:
        return self.source.get_pitch_arsenal_stats(pitcher_ids, season)

    def get_hitter_play_logs(self, hitter_ids: list[str], season: str, limit: int = 160) -> dict:
        return self.source.get_play_log_stats(hitter_ids, "hitting", season, limit)

    def get_hitter_career_splits(self, hitter_ids: list[str]) -> dict:
        return self.source.get_career_split_stats(hitter_ids, "hitting")

    def get_batter_vs_pitcher_history(self, matchup_groups: list[dict]) -> dict:
        return self.source.get_vs_player_total_stats(matchup_groups)
