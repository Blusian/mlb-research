import type { DailyAnalysisQuery, DailyAnalysisResponse } from '@mlb-analyzer/shared';
import { useEffect, useRef, useState } from 'react';

import { getDailyAnalysis } from '../api/client';

interface DailyAnalysisState {
  data: DailyAnalysisResponse | null;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

export const useDailyAnalysis = (query: DailyAnalysisQuery): DailyAnalysisState => {
  const [data, setData] = useState<DailyAnalysisResponse | null>(null);
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

    void getDailyAnalysis(query, controller.signal, { forceRefresh })
      .then((response) => {
        setData(response);
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name === 'AbortError') {
          return;
        }

        setError(reason instanceof Error ? reason.message : 'Unable to load analysis.');
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [
    query.date,
    query.team,
    query.matchup,
    query.handedness,
    query.hitterScoreType,
    query.pitcherScoreType,
    requestVersion,
  ]);

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
