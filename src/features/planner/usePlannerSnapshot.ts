import { useCallback, useEffect, useRef, useState } from 'react';

import { initializeDatabase } from '../../data/database';
import {
  PLANNER_DATA_CHANGED_EVENT,
  plannerRepository,
  type PlannerRepository,
} from '../../data/plannerRepository';
import type { PlannerSnapshot } from '../../data/plannerTypes';

const EMPTY_SNAPSHOT: PlannerSnapshot = { areas: [], lists: [], tasks: [] };

export function usePlannerSnapshot(repository: PlannerRepository = plannerRepository) {
  const [snapshot, setSnapshot] = useState<PlannerSnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestNumber.current;
    try {
      await initializeDatabase();
      const nextSnapshot = await repository.getSnapshot();
      if (request === requestNumber.current) {
        setSnapshot(nextSnapshot);
        setError(null);
      }
    } catch (caughtError) {
      if (request === requestNumber.current) {
        setError(
          caughtError instanceof Error ? caughtError.message : 'Planner data could not be loaded.',
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

  return { snapshot, isLoading, error, refresh };
}
