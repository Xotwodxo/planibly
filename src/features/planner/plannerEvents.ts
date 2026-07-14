export const OPEN_QUICK_ADD_EVENT = 'planibly:open-quick-add';

export function openQuickAdd(): void {
  window.dispatchEvent(new Event(OPEN_QUICK_ADD_EVENT));
}
