import type {
  CreateSelectedPropInput,
  LiveSelectedProp,
  SelectionSide,
  SelectedProp,
  SelectedPropType,
} from '@mlb-analyzer/shared';
import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  createSelectedProp,
  deleteSelectedProp,
  getLiveSelectedProps,
  getSelectedProps,
} from '../api/client';

export interface SelectedPropsContextValue {
  selectedDate: string;
  selectedProps: SelectedProp[];
  liveSelectedProps: LiveSelectedProp[];
  isLoading: boolean;
  isLiveLoading: boolean;
  error: string | null;
  addSelectedProp: (payload: CreateSelectedPropInput) => Promise<void>;
  removeSelectedProp: (selectedPropId: string) => Promise<void>;
  refreshSelectedProps: () => Promise<void>;
  isPropSelected: (
    propType: SelectedPropType,
    playerId: string,
    gameId: string,
    lineValue?: number | null,
    selectionSide?: SelectionSide,
  ) => boolean;
}

export const SelectedPropsContext = createContext<SelectedPropsContextValue | null>(null);

const STORAGE_KEY = 'mlb-analyzer.selected-props.v1';

const sameLine = (left?: number | null, right?: number | null): boolean => {
  if (left == null && right == null) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return Math.abs(left - right) < 0.0001;
};

const normalizeSelectionSide = (value?: string | null): SelectionSide =>
  value === 'under' ? 'under' : 'over';

const sameSelectionSide = (
  left?: SelectionSide | null,
  right?: SelectionSide | null,
): boolean => normalizeSelectionSide(left) === normalizeSelectionSide(right);

const normalizeSelectedProp = (prop: SelectedProp): SelectedProp => ({
  ...prop,
  selectionSide: normalizeSelectionSide(prop.selectionSide),
});

const normalizeLiveSelectedProp = (prop: LiveSelectedProp): LiveSelectedProp => ({
  ...prop,
  selectionSide: normalizeSelectionSide(prop.selectionSide),
});

const loadLocalState = (date: string): SelectedProp[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Record<string, SelectedProp[]>;
    return Array.isArray(parsed[date]) ? parsed[date].map(normalizeSelectedProp) : [];
  } catch {
    return [];
  }
};

const persistLocalState = (date: string, props: SelectedProp[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SelectedProp[]>) : {};
    parsed[date] = props.map(normalizeSelectedProp);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage failures and keep backend persistence as source of truth.
  }
};

const nextPollDelay = (items: LiveSelectedProp[]): number | null => {
  if (items.some((item) => item.gameStatus === 'Live')) {
    return 25000;
  }
  if (items.some((item) => item.gameStatus === 'Pregame')) {
    return 60000;
  }
  if (items.some((item) => item.gameStatus === 'Delayed' || item.gameStatus === 'Suspended')) {
    return 45000;
  }
  return null;
};

export function SelectedPropsProvider({
  selectedDate,
  children,
}: {
  selectedDate: string;
  children: ReactNode;
}) {
  const [selectedProps, setSelectedProps] = useState<SelectedProp[]>(() => loadLocalState(selectedDate));
  const [liveSelectedProps, setLiveSelectedProps] = useState<LiveSelectedProp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const livePollTimerRef = useRef<number | null>(null);
  const selectedPropSignature = useMemo(
    () => selectedProps.map((prop) => prop.id).join('|'),
    [selectedProps],
  );

  useEffect(() => {
    setSelectedProps(loadLocalState(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    persistLocalState(selectedDate, selectedProps);
  }, [selectedDate, selectedProps]);

  const syncSelectedProps = async (signal?: AbortSignal): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getSelectedProps(selectedDate, signal);
      setSelectedProps(response.map(normalizeSelectedProp));
    } catch (reason: unknown) {
      if ((reason as Error).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : 'Unable to load selected props.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void syncSelectedProps(controller.signal);
    return () => {
      controller.abort();
    };
  }, [selectedDate]);

  useEffect(() => {
    if (livePollTimerRef.current) {
      window.clearTimeout(livePollTimerRef.current);
      livePollTimerRef.current = null;
    }

    if (selectedProps.length === 0) {
      setLiveSelectedProps([]);
      return;
    }

    let cancelled = false;
    let controller = new AbortController();

    const poll = async () => {
      setIsLiveLoading(true);
      try {
        const response = await getLiveSelectedProps(selectedDate, controller.signal);
        if (cancelled) {
          return;
        }
        setLiveSelectedProps(response.map(normalizeLiveSelectedProp));
        setError(null);
        const delay = nextPollDelay(response);
        if (delay != null) {
          livePollTimerRef.current = window.setTimeout(() => {
            controller = new AbortController();
            void poll();
          }, delay);
        }
      } catch (reason: unknown) {
        if ((reason as Error).name !== 'AbortError' && !cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to load live prop tracking.');
          livePollTimerRef.current = window.setTimeout(() => {
            controller = new AbortController();
            void poll();
          }, 60000);
        }
      } finally {
        if (!cancelled) {
          setIsLiveLoading(false);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (livePollTimerRef.current) {
        window.clearTimeout(livePollTimerRef.current);
        livePollTimerRef.current = null;
      }
    };
  }, [selectedDate, selectedPropSignature]);

  const value = useMemo<SelectedPropsContextValue>(
    () => ({
      selectedDate,
      selectedProps,
      liveSelectedProps,
      isLoading,
      isLiveLoading,
      error,
      addSelectedProp: async (payload: CreateSelectedPropInput) => {
        const created = await createSelectedProp(payload);
        setSelectedProps((current) => [
          normalizeSelectedProp(created),
          ...current.filter((entry) => entry.id !== created.id),
        ]);
      },
      removeSelectedProp: async (selectedPropId: string) => {
        await deleteSelectedProp(selectedPropId);
        setSelectedProps((current) => current.filter((entry) => entry.id !== selectedPropId));
        setLiveSelectedProps((current) =>
          current.filter((entry) => entry.selectedPropId !== selectedPropId),
        );
      },
      refreshSelectedProps: async () => {
        await syncSelectedProps();
        setIsLiveLoading(true);
        try {
          setLiveSelectedProps((await getLiveSelectedProps(selectedDate)).map(normalizeLiveSelectedProp));
        } finally {
          setIsLiveLoading(false);
        }
      },
      isPropSelected: (
        propType: SelectedPropType,
        playerId: string,
        gameId: string,
        lineValue?: number | null,
        selectionSide?: SelectionSide,
      ) =>
        selectedProps.some(
          (entry) =>
            entry.propType === propType &&
            entry.playerId === playerId &&
            entry.gameId === gameId &&
            sameLine(entry.lineValue, lineValue) &&
            sameSelectionSide(entry.selectionSide, selectionSide),
        ),
    }),
    [selectedDate, selectedProps, liveSelectedProps, isLoading, isLiveLoading, error],
  );

  return <SelectedPropsContext.Provider value={value}>{children}</SelectedPropsContext.Provider>;
}
