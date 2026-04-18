from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    port: int = Field(default=4000, alias="PORT")
    frontend_port: int = Field(default=5173, alias="FRONTEND_PORT")
    default_analysis_date: str | None = Field(default=None, alias="DEFAULT_ANALYSIS_DATE")
    mlb_stats_api_base_url: str = Field(
        default="https://statsapi.mlb.com/api/v1",
        alias="MLB_STATS_API_BASE_URL",
    )
    baseball_savant_base_url: str = Field(
        default="https://baseballsavant.mlb.com",
        alias="BASEBALL_SAVANT_BASE_URL",
    )
    fangraphs_base_url: str = Field(
        default="https://www.fangraphs.com",
        alias="FANGRAPHS_BASE_URL",
    )
    open_meteo_base_url: str = Field(
        default="https://api.open-meteo.com/v1",
        alias="OPEN_METEO_BASE_URL",
    )
    live_provider_timeout_ms: int = Field(default=8000, alias="LIVE_PROVIDER_TIMEOUT_MS")
    live_game_feed_timeout_ms: int = Field(default=3500, alias="LIVE_GAME_FEED_TIMEOUT_MS")
    live_game_feed_max_workers: int = Field(default=4, alias="LIVE_GAME_FEED_MAX_WORKERS")
    cache_ttl_minutes: int = Field(default=30, alias="CACHE_TTL_MINUTES")
    cache_namespace: str = Field(
        default="python-fastapi-v1",
        alias="PYTHON_API_CACHE_NAMESPACE",
    )
    cache_directory: Path = Field(
        default=Path(".cache/python-api"),
        alias="PYTHON_API_CACHE_DIRECTORY",
    )
    database_url: str = Field(
        default="sqlite:///database/mlb_analytics.sqlite3",
        alias="DATABASE_URL",
    )
    enable_open_meteo_weather: bool = Field(default=True, alias="ENABLE_OPEN_METEO_WEATHER")
    enable_fangraphs_support: bool = Field(default=True, alias="ENABLE_FANGRAPHS_SUPPORT")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    statcast_start_month_day: str = Field(default="03-01", alias="STATCAST_START_MONTH_DAY")

    @property
    def timeout_seconds(self) -> float:
        return self.live_provider_timeout_ms / 1000

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.cache_directory.mkdir(parents=True, exist_ok=True)
    Path("database").mkdir(parents=True, exist_ok=True)
    return settings
