import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { OPEN_QUICK_ADD_EVENT } from '../features/planner/plannerEvents';
import { QuickAddDialog } from '../features/planner/QuickAddDialog';
import { AppNavigation } from './AppNavigation';
import { Icon } from './Icon';
import { IconButton } from './ui/IconButton';

const titles: Record<string, string> = {
  '/': 'Home',
  '/plan': 'Plan',
  '/calendar': 'Calendar',
  '/lists': 'Lists',
  '/insights': 'Insights',
  '/settings': 'Settings',
};

export function AppShell() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? 'Planibly';
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    const open = () => setQuickAddOpen(true);
    window.addEventListener(OPEN_QUICK_ADD_EVENT, open);
    return () => window.removeEventListener(OPEN_QUICK_ADD_EVENT, open);
  }, []);

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
          {pathname === '/' ? (
            <IconButton label="Open settings" to="/settings">
              <Icon name="settings" />
            </IconButton>
          ) : null}
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
    </div>
  );
}
