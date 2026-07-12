import { useRegisterSW } from 'virtual:pwa-register/react';

import { Button } from './ui/Button';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed.', error);
    },
  });

  if (!needRefresh) {
    return null;
  }

  return (
    <aside className="update-prompt" aria-live="polite" aria-label="Application update">
      <p>An update is ready. Reload now?</p>
      <div className="update-prompt__actions">
        <Button variant="quiet" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button onClick={() => void updateServiceWorker(true)}>Reload</Button>
      </div>
    </aside>
  );
}
