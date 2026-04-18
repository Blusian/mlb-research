import { useContext } from 'react';

import { SelectedPropsContext } from '../store/SelectedPropsContext';

export const useSelectedProps = () => {
  const context = useContext(SelectedPropsContext);

  if (!context) {
    throw new Error('useSelectedProps must be used within SelectedPropsProvider.');
  }

  return context;
};
