import { useSelectedProps } from './useSelectedProps';

export const useLiveSelectedProps = () => {
  const { liveSelectedProps, isLiveLoading } = useSelectedProps();

  return {
    liveSelectedProps,
    isLiveLoading,
  };
};
