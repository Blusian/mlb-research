from __future__ import annotations

from datetime import datetime, timezone

from app.core.config import get_settings
from app.data_sources.http_client import RateLimitedHttpClient
from app.data_sources.park_factors import HOME_TEAM_COORDINATES


WEATHER_CODE_LABELS = {
    0: "Clear skies",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    51: "Light drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    80: "Showers",
    95: "Thunderstorms",
}


def to_compass(degrees: float | None) -> str:
    if degrees is None:
        return "variable"
    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return directions[round(degrees / 45) % len(directions)]


class WeatherApiSource:
    def __init__(self, client: RateLimitedHttpClient | None = None) -> None:
        self.settings = get_settings()
        self.client = client or RateLimitedHttpClient()

    def get_game_weather(self, home_team_abbreviation: str, start_time: str) -> dict | None:
        coordinates = HOME_TEAM_COORDINATES.get(home_team_abbreviation)
        if not coordinates:
            return None
        url = (
            f"{self.settings.open_meteo_base_url}/forecast"
            f"?latitude={coordinates['latitude']}&longitude={coordinates['longitude']}"
            "&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,weather_code,relative_humidity_2m,cloud_cover,surface_pressure"
            "&forecast_days=2&timezone=UTC"
        )
        payload = self.client.get_json(url)
        hourly = payload.get("hourly") or {}
        times = hourly.get("time") or []
        if not times:
            return None
        target = datetime.fromisoformat(start_time.replace("Z", "+00:00")).astimezone(timezone.utc)
        best_index = 0
        best_gap = float("inf")
        for index, value in enumerate(times):
            timestamp = datetime.fromisoformat(f"{value}+00:00")
            gap = abs((timestamp - target).total_seconds())
            if gap < best_gap:
                best_gap = gap
                best_index = index
        temperature_c = (hourly.get("temperature_2m") or [None])[best_index]
        wind_speed_kmh = (hourly.get("wind_speed_10m") or [None])[best_index]
        humidity = (hourly.get("relative_humidity_2m") or [None])[best_index]
        weather_code = (hourly.get("weather_code") or [None])[best_index]
        precipitation_probability = (hourly.get("precipitation_probability") or [None])[best_index]
        wind_direction = (hourly.get("wind_direction_10m") or [None])[best_index]
        wind_gusts_kmh = (hourly.get("wind_gusts_10m") or [None])[best_index]
        cloud_cover = (hourly.get("cloud_cover") or [None])[best_index]
        pressure_hpa = (hourly.get("surface_pressure") or [None])[best_index]
        temperature_f = temperature_c * (9 / 5) + 32 if temperature_c is not None else None
        wind_speed_mph = wind_speed_kmh * 0.621371 if wind_speed_kmh is not None else None
        wind_gusts_mph = wind_gusts_kmh * 0.621371 if wind_gusts_kmh is not None else None
        return {
            "condition": WEATHER_CODE_LABELS.get(weather_code, "Forecast available"),
            "temperatureF": round(temperature_f) if temperature_f is not None else None,
            "temperatureC": round(temperature_c, 1) if temperature_c is not None else None,
            "wind": f"{wind_speed_mph:.0f} mph {to_compass(wind_direction)}" if wind_speed_mph is not None else None,
            "windSpeedMph": round(wind_speed_mph, 1) if wind_speed_mph is not None else None,
            "windGustsMph": round(wind_gusts_mph, 1) if wind_gusts_mph is not None else None,
            "windDirection": to_compass(wind_direction),
            "windDirectionDegrees": wind_direction,
            "humidity": humidity,
            "precipitationProbability": precipitation_probability,
            "cloudCover": cloud_cover,
            "pressureHpa": round(pressure_hpa, 1) if pressure_hpa is not None else None,
        }
