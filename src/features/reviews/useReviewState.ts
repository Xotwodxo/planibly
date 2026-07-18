import { useCallback, useEffect, useRef, useState } from 'react';

import { initializeDatabase } from '../../data/database';
import { defaultReviewPreferences } from '../../data/review';
import {
  REVIEW_DATA_CHANGED_EVENT,
  reviewRepository,
  type ReviewRepository,
  type ReviewState,
} from '../../data/reviewRepository';

const EMPTY_STATE: ReviewState = {
  preferences: defaultReviewPreferences(new Date(0).toISOString()),
  records: [],
  dismissedKeys: new Set(),
};

export function useReviewState(repository: ReviewRepository = reviewRepository) {
  const [state, setState] = useState<ReviewState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      await initializeDatabase();
      const next = await repository.getState();
      if (request.current === current) {
        setState(next);
        setError(null);
      }
    } catch (caughtError) {
      if (request.current === current) {
        setError(caughtError instanceof Error ? caughtError.message : 'Reviews could not load.');
      }
    } finally {
      if (request.current === current) setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(REVIEW_DATA_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(REVIEW_DATA_CHANGED_EVENT, handleChange);
  }, [refresh]);

  return { state, isLoading, error, refresh };
}
