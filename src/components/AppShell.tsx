import { Outlet, useLocation } from 'react-router-dom';

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

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="side-navigation" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Planibly home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>Planibly</span>
        </a>
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

        <nav className="bottom-navigation" aria-label="Primary navigation">
          <AppNavigation layout="bottom" />
        </nav>
      </div>
    </div>
  );
}
