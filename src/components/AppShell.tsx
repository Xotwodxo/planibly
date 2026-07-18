import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { plannerRepository } from '../data/plannerRepository';
import { calendarRepository } from '../data/calendarRepository';
import { routineRepository } from '../data/routineRepository';
import { focusRepository } from '../data/focusRepository';
import type { DeletionReceipt } from '../data/plannerTypes';
import { OPEN_QUICK_ADD_EVENT, SHOW_UNDO_EVENT } from '../features/planner/plannerEvents';
import { QuickAddDialog } from '../features/planner/QuickAddDialog';
import { SearchDialog } from '../features/planner/SearchDialog';
import { AppNavigation } from './AppNavigation';
import { Icon } from './Icon';
import { IconButton } from './ui/IconButton';

const titles: Record<string, string> = {
  '/': 'Home',
  '/plan': 'Plan',
  '/calendar': 'Calendar',
  '/lists': 'Lists',
  '/routines': 'Routines',
  '/insights': 'Insights',
  '/settings': 'Settings',
};

export function AppShell() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? 'Planibly';
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [undoReceipt, setUndoReceipt] = useState<DeletionReceipt | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    const open = () => setQuickAddOpen(true);
    window.addEventListener(OPEN_QUICK_ADD_EVENT, open);
    return () => window.removeEventListener(OPEN_QUICK_ADD_EVENT, open);
  }, []);

  useEffect(() => {
    const show = (event: Event) => {
      setUndoReceipt((event as CustomEvent<DeletionReceipt>).detail);
      setUndoError(null);
    };
    window.addEventListener(SHOW_UNDO_EVENT, show);
    return () => window.removeEventListener(SHOW_UNDO_EVENT, show);
  }, []);

  useEffect(() => {
    if (!undoReceipt) return;
    const timeout = window.setTimeout(() => setUndoReceipt(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [undoReceipt]);

  async function undoDeletion() {
    if (!undoReceipt) return;
    try {
      if (
        undoReceipt.kind === 'calendar' ||
        undoReceipt.kind === 'event' ||
        undoReceipt.kind === 'occurrence' ||
        undoReceipt.kind === 'template'
      ) {
        await calendarRepository.restoreDeletionGroup(undoReceipt.groupId, undoReceipt);
      } else if (undoReceipt.kind === 'routine' || undoReceipt.kind === 'routineItem') {
        await routineRepository.restoreDeletionGroup(undoReceipt.groupId);
      } else if (undoReceipt.kind === 'prepItem') {
        await focusRepository.restoreDeletionGroup(undoReceipt.groupId);
      } else {
        await plannerRepository.restoreDeletionGroup(undoReceipt.groupId, undoReceipt);
      }
      setUndoReceipt(null);
      setUndoError(null);
    } catch (caughtError) {
      setUndoError(caughtError instanceof Error ? caughtError.message : 'Undo could not complete.');
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="side-navigation" aria-label="Primary navigation">
        <Link className="brand" to="/" aria-label="Planibly home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>Planibly</span>
        </Link>
        <AppNavigation layout="side" />
        <p className="privacy-note">Private by design. Your data stays on this device.</p>
      </nav>

      <div className="app-column">
        <header className="top-bar">
          <div>
            <span className="mobile-brand">Planibly</span>
            <strong className="current-section">{title}</strong>
          </div>
          <div className="top-bar__actions">
            <IconButton label="Search" onClick={() => setSearchOpen(true)}>
              <Icon name="search" />
            </IconButton>
            {pathname === '/' ? (
              <IconButton label="Open settings" to="/settings">
                <Icon name="settings" />
              </IconButton>
            ) : null}
          </div>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>

        <button className="quick-add-fab" type="button" onClick={() => setQuickAddOpen(true)}>
          <span aria-hidden="true">+</span>
          <span>Quick Add</span>
        </button>

        <nav className="bottom-navigation" aria-label="Primary navigation">
          <AppNavigation layout="bottom" />
        </nav>
      </div>
      {quickAddOpen ? <QuickAddDialog onClose={() => setQuickAddOpen(false)} /> : null}
      {searchOpen ? <SearchDialog onClose={() => setSearchOpen(false)} /> : null}
      {undoReceipt ? (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>
            {undoReceipt.undoMessage ?? (
              <>
                {undoReceipt.label}{' '}
                {undoReceipt.operation === 'archive' ? 'archived.' : 'moved to Recently Deleted.'}
              </>
            )}
          </span>
          <button type="button" onClick={() => void undoDeletion()}>
            Undo
          </button>
          {undoError ? <span className="form-error">{undoError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
