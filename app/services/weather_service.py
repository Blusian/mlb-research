from __future__ import annotations

from app.core.config import get_settings
from app.data_sources.weather_api import WeatherApiSource


class WeatherService:
    def __init__(self, source: WeatherApiSource | None = None) -> None:
        self.settings = get_settings()
        self.source = source or WeatherApiSource()

    def get_weather(self, home_team_abbreviation: str, start_time: str) -> dict | None:
        if not self.settings.enable_open_meteo_weather:
            return None
        try:
            return self.source.get_game_weather(home_team_abbreviation, start_time)
        except Exception:
            return None
