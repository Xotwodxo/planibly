import { useCallback, useEffect, useState } from 'react';
import { agendaRepository } from '../../data/agendaRepository';
import { PLANNER_DATA_CHANGED_EVENT } from '../../data/plannerRepository';
import type { PlanningCapacityRecord } from '../../data/plannerTypes';
import { logDiagnostic } from '../../diagnostics/logger';

export function usePlanningCapacities() {
  const [capacities, setCapacities] = useState<PlanningCapacityRecord[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const next = await agendaRepository.getCapacities();
      setCapacities((current) => (sameCapacities(current, next) ? current : next));
      setError(undefined);
    } catch (cause) {
      setError('Planning capacity could not be loaded.');
      void logDiagnostic('error', 'planning.capacity.load_failed', cause);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(PLANNER_DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PLANNER_DATA_CHANGED_EVENT, onChange);
  }, [refresh]);

  return { capacities, error, refresh };
}

function sameCapacities(
  left: readonly PlanningCapacityRecord[],
  right: readonly PlanningCapacityRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => {
    const candidate = right[index];
    return (
      record.id === candidate?.id &&
      record.kind === candidate.kind &&
      record.weekday === candidate.weekday &&
      record.localDate === candidate.localDate &&
      record.minutes === candidate.minutes &&
      record.modifiedAt === candidate.modifiedAt
    );
  });
}
