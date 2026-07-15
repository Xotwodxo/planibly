import type { DeletionReceipt } from '../../data/plannerTypes';

export const OPEN_QUICK_ADD_EVENT = 'planibly:open-quick-add';
export const SHOW_UNDO_EVENT = 'planibly:show-undo';

export function openQuickAdd(): void {
  window.dispatchEvent(new Event(OPEN_QUICK_ADD_EVENT));
}

export function showDeletionUndo(receipt: DeletionReceipt): void {
  window.dispatchEvent(new CustomEvent<DeletionReceipt>(SHOW_UNDO_EVENT, { detail: receipt }));
}
