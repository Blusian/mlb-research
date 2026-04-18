import type {
  CreateSelectedPropInput,
  DailyAnalysisQuery,
  DailyAnalysisResponse,
  LiveSelectedProp,
  PlayerDetailResponse,
  SelectedProp,
} from '@mlb-analyzer/shared';

import type { PlayerDetailSelection } from '../types/playerDetail';

const LOCAL_API_BASE_URL = 'http://127.0.0.1:4000';
const LOCAL_FRONTEND_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeApiBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const resolveApiBaseUrl = (): string => {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return normalizeApiBaseUrl(configuredBaseUrl);
  }

  if (
    typeof window !== 'undefined'
    && LOCAL_FRONTEND_HOSTS.has(window.location.hostname.toLowerCase())
  ) {
    return LOCAL_API_BASE_URL;
  }

  throw new Error(
    'API base URL is not configured. Set VITE_API_BASE_URL for this environment.',
  );
};

const apiUrl = (path: string): string => `${resolveApiBaseUrl()}${path}`;

interface DailyAnalysisRequestOptions {
  forceRefresh?: boolean;
}

interface PlayerDetailRequestOptions {
  forceRefresh?: boolean;
}

export const getDailyAnalysis = async (
  query: DailyAnalysisQuery,
  signal?: AbortSignal,
  options: DailyAnalysisRequestOptions = {},
): Promise<DailyAnalysisResponse> => {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value && value !== 'ALL') {
      searchParams.set(key, value);
    }
  });

  if (options.forceRefresh) {
    searchParams.set('refresh', 'true');
    searchParams.set('refreshToken', String(Date.now()));
  }

  const response = await fetch(apiUrl(`/api/daily-analysis?${searchParams.toString()}`), {
    signal,
    cache: options.forceRefresh ? 'no-store' : 'default',
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<DailyAnalysisResponse>;
};

export const getSelectedProps = async (
  date: string,
  signal?: AbortSignal,
): Promise<SelectedProp[]> => {
  const response = await fetch(apiUrl(`/api/selected-props?date=${encodeURIComponent(date)}`), {
    signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<SelectedProp[]>;
};

export const createSelectedProp = async (
  payload: CreateSelectedPropInput,
): Promise<SelectedProp> => {
  const response = await fetch(apiUrl('/api/selected-props'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<SelectedProp>;
};

export const deleteSelectedProp = async (selectedPropId: string): Promise<void> => {
  const response = await fetch(apiUrl(`/api/selected-props/${selectedPropId}`), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
};

export const getLiveSelectedProps = async (
  date: string,
  signal?: AbortSignal,
): Promise<LiveSelectedProp[]> => {
  const response = await fetch(
    apiUrl(`/api/selected-props/live?date=${encodeURIComponent(date)}`),
    {
      signal,
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<LiveSelectedProp[]>;
};

export const getPlayerDetail = async (
  selection: PlayerDetailSelection,
  signal?: AbortSignal,
  options: PlayerDetailRequestOptions = {},
): Promise<PlayerDetailResponse> => {
  const searchParams = new URLSearchParams({
    playerId: selection.playerId,
    role: selection.role,
    gameId: selection.gameId,
    date: selection.date,
  });

  if (options.forceRefresh) {
    searchParams.set('refresh', 'true');
  }

  const response = await fetch(apiUrl(`/api/player-details?${searchParams.toString()}`), {
    signal,
    cache: options.forceRefresh ? 'no-store' : 'default',
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<PlayerDetailResponse>;
};
