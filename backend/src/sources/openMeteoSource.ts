import type { WeatherInfo } from '@mlb-analyzer/shared';

import { homeTeamCoordinates } from './stadiumCoordinates.js';
import { fetchJson } from './http.js';

interface OpenMeteoHourlyResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
  };
}

const weatherCodeLabels: Record<number, string> = {
  0: 'Clear skies',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Heavy showers',
  82: 'Violent showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms with hail',
  99: 'Severe thunderstorms with hail',
};

const toCompass = (degrees: number | undefined): string => {
  if (typeof degrees !== 'number' || Number.isNaN(degrees)) {
    return 'variable';
  }

  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(degrees / 45) % directions.length] ?? 'variable';
};

export class OpenMeteoSource {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async getGameWeather(
    homeTeamAbbreviation: string,
    startTime: string,
  ): Promise<WeatherInfo | undefined> {
    const coordinates = homeTeamCoordinates[homeTeamAbbreviation];

    if (!coordinates) {
      return undefined;
    }

    const forecast = await fetchJson<OpenMeteoHourlyResponse>(
      `${this.baseUrl}/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,weather_code&forecast_days=2&timezone=UTC`,
      this.timeoutMs,
    );

    const times = forecast.hourly?.time ?? [];

    if (times.length === 0) {
      return undefined;
    }

    const targetTimestamp = new Date(startTime).getTime();
    let bestIndex = 0;
    let smallestGap = Number.POSITIVE_INFINITY;

    times.forEach((time, index) => {
      const timestamp = new Date(`${time}Z`).getTime();
      const gap = Math.abs(timestamp - targetTimestamp);

      if (gap < smallestGap) {
        smallestGap = gap;
        bestIndex = index;
      }
    });

    const temperatureC = forecast.hourly?.temperature_2m?.[bestIndex];
    const temperatureF =
      typeof temperatureC === 'number' ? temperatureC * (9 / 5) + 32 : undefined;
    const windSpeedKmh = forecast.hourly?.wind_speed_10m?.[bestIndex];
    const windDirection = forecast.hourly?.wind_direction_10m?.[bestIndex];
    const precipitationProbability =
      forecast.hourly?.precipitation_probability?.[bestIndex];
    const weatherCode = forecast.hourly?.weather_code?.[bestIndex];
    const windSpeedMph =
      typeof windSpeedKmh === 'number' ? windSpeedKmh * 0.621371 : undefined;

    return {
      condition:
        weatherCode != null
          ? (weatherCodeLabels[weatherCode] ?? 'Forecast available')
          : 'Forecast available',
      temperatureF:
        typeof temperatureF === 'number' ? Math.round(temperatureF) : undefined,
      wind:
        typeof windSpeedMph === 'number'
          ? `${windSpeedMph.toFixed(0)} mph ${toCompass(windDirection)}`
          : undefined,
      precipitationProbability,
    };
  }
}
