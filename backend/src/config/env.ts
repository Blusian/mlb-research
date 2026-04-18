import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATA_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  MLB_STATS_API_BASE_URL: z.string().url().default('https://statsapi.mlb.com/api/v1'),
  BASEBALL_SAVANT_BASE_URL: z
    .string()
    .url()
    .default('https://baseballsavant.mlb.com'),
  FANGRAPHS_BASE_URL: z.string().url().default('https://www.fangraphs.com'),
  OPEN_METEO_BASE_URL: z
    .string()
    .url()
    .default('https://api.open-meteo.com/v1'),
  CACHE_TTL_MINUTES: z.coerce.number().min(1).default(30),
  CACHE_DIRECTORY: z.string().default('.cache/daily-slates'),
  LIVE_PROVIDER_TIMEOUT_MS: z.coerce.number().min(1000).default(8000),
  ENABLE_OPEN_METEO_WEATHER: z.coerce.boolean().default(true),
  ENABLE_FANGRAPHS_SUPPORT: z.coerce.boolean().default(true),
  DEFAULT_ANALYSIS_DATE: z.string().optional(),
  MODELING_SNAPSHOT_DIRECTORY: z
    .string()
    .default('.cache/modeling/snapshots'),
  MODELING_RESULT_DIRECTORY: z
    .string()
    .default('.cache/modeling/results'),
  MODELING_ODDS_DIRECTORY: z.string().default('.cache/modeling/odds'),
});

export const env = envSchema.parse(process.env);
