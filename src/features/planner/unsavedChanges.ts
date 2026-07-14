import { useEffect, useRef, useSyncExternalStore } from 'react';

const sources = new Set<symbol>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function useUnsavedChanges(isDirty: boolean): void {
  const source = useRef(Symbol('unsaved-form'));

  useEffect(() => {
    const token = source.current;
    if (isDirty) sources.add(token);
    else sources.delete(token);
    notify();
    return () => {
      sources.delete(token);
      notify();
    };
  }, [isDirty]);
}

export function useHasUnsavedChanges(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sources.size > 0,
    () => false,
  );
}
