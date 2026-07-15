import { useCallback, useEffect, useRef, useState } from 'react';

import { initializeDatabase } from '../../data/database';
import { dashboardRepository, type DashboardRepository } from '../../data/dashboardRepository';
import type { DashboardState } from '../../data/dashboardTypes';
import { PLANNER_DATA_CHANGED_EVENT } from '../../data/plannerRepository';

const EMPTY_STATE: DashboardState = { layouts: [], activeLayoutId: '' };

export function useDashboardState(repository: DashboardRepository = dashboardRepository) {
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestNumber.current;
    try {
      await initializeDatabase();
      const nextState = await repository.getState();
      if (request === requestNumber.current) {
        setState(nextState);
        setError(null);
      }
    } catch (caughtError) {
      if (request === requestNumber.current) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Dashboard layouts could not be loaded.',
        );
      }
    } finally {
      if (request === requestNumber.current) setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(PLANNER_DATA_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(PLANNER_DATA_CHANGED_EVENT, handleChange);
  }, [refresh]);

  return { state, isLoading, error, refresh };
}
