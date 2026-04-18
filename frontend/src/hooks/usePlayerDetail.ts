import type { PlayerDetailResponse } from '@mlb-analyzer/shared';
import { useEffect, useRef, useState } from 'react';

import { getPlayerDetail } from '../api/client';
import type { PlayerDetailSelection } from '../types/playerDetail';

interface PlayerDetailState {
  data: PlayerDetailResponse | null;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

export const usePlayerDetail = (selection: PlayerDetailSelection): PlayerDetailState => {
  const [data, setData] = useState<PlayerDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);
  const pendingRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const forceRefresh = pendingRefreshRef.current;

    pendingRefreshRef.current = false;
    setIsLoading(true);
    setError(null);

    void getPlayerDetail(selection, controller.signal, { forceRefresh })
      .then((response) => {
        setData(response);
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name === 'AbortError') {
          return;
        }

        setError(reason instanceof Error ? reason.message : 'Unable to load player detail.');
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [selection.date, selection.gameId, selection.playerId, selection.role, requestVersion]);

  return {
    data,
    error,
    isLoading,
    refresh: () => {
      pendingRefreshRef.current = true;
      setRequestVersion((current) => current + 1);
    },
  };
};
