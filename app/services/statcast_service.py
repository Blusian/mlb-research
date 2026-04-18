from __future__ import annotations

from app.data_sources.baseball_savant import BaseballSavantSource


class StatcastService:
    def __init__(self, source: BaseballSavantSource | None = None) -> None:
        self.source = source or BaseballSavantSource()

    def get_hitter_profiles(self, date: str) -> dict:
        return self.source.get_hitter_profiles(date)

    def get_pitcher_profiles(self, date: str) -> dict:
        return self.source.get_pitcher_profiles(date)

    def get_bat_tracking_profiles(self, season: str) -> dict:
        return self.source.get_bat_tracking_profiles(season)
