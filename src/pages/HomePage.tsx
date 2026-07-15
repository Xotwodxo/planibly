import { useEffect, useMemo, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import {
  DASHBOARD_CARD_LABELS,
  copyDashboardCards,
  dashboardSuggestions,
  moveDashboardCard,
  setDashboardCardSize,
  setDashboardCardVisibility,
} from '../data/dashboard';
import { dashboardRepository } from '../data/dashboardRepository';
import {
  DASHBOARD_CARD_SIZES,
  type DashboardCardConfig,
  type DashboardCardSize,
  type DashboardCardType,
  type DashboardLayoutRecord,
} from '../data/dashboardTypes';
import { localDateFromDate } from '../data/planning';
import { plannerRepository } from '../data/plannerRepository';
import type { TaskRecord } from '../data/plannerTypes';
import { DashboardCard } from '../features/dashboard/DashboardCard';
import { useDashboardState } from '../features/dashboard/useDashboardState';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';
import { useUnsavedChanges } from '../features/planner/unsavedChanges';

type Confirmation = 'cancel' | 'delete' | 'restoreDefaults' | null;

export function HomePage() {
  const { snapshot, isLoading: plannerLoading, error: plannerError } = usePlannerSnapshot();
  const { state, isLoading: dashboardLoading, error: dashboardError } = useDashboardState();
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [draftCards, setDraftCards] = useState<DashboardCardConfig[]>([]);
  const [draftName, setDraftName] = useState('');
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const today = localDateFromDate(new Date());
  const activeLayout =
    state.layouts.find((layout) => layout.id === state.activeLayoutId) ?? state.layouts[0];
  const isDirty = Boolean(
    isCustomizing &&
    activeLayout &&
    (draftName.trim() !== activeLayout.name ||
      JSON.stringify(draftCards) !== JSON.stringify(activeLayout.cards)),
  );
  useUnsavedChanges(isDirty);
  useDashboardNavigationWarning(isDirty);

  const suggestions = useMemo(
    () => (activeLayout ? dashboardSuggestions(snapshot, activeLayout, today) : []),
    [activeLayout, snapshot, today],
  );

  if (plannerLoading || dashboardLoading || !activeLayout) {
    return <p role="status">Opening your dashboard&hellip;</p>;
  }
  const currentLayout = activeLayout;

  function startCustomizing(cardToShow?: DashboardCardType) {
    let cards = copyDashboardCards(currentLayout.cards);
    if (cardToShow) cards = setDashboardCardVisibility(cards, cardToShow, true);
    setDraftCards(cards);
    setDraftName(currentLayout.name);
    setIsCustomizing(true);
    setActionError(null);
  }

  function requestCancel() {
    if (isDirty) setConfirmation('cancel');
    else setIsCustomizing(false);
  }

  async function saveCustomization() {
    try {
      const saved = await dashboardRepository.saveCustomization(
        currentLayout.id,
        currentLayout.builtInKey && draftName.trim() === currentLayout.name
          ? `${currentLayout.name} custom`
          : draftName,
        draftCards,
      );
      setIsCustomizing(false);
      setAnnouncement(`${saved.name} saved.`);
      setActionError(null);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : 'The dashboard could not be saved.',
      );
    }
  }

  async function completeTask(task: TaskRecord, completed: boolean) {
    try {
      await plannerRepository.setTaskCompleted(task.id, completed);
      setAnnouncement(completed ? `${task.title} completed.` : `${task.title} returned to Home.`);
    } catch (caughtError) {
      setAnnouncement(
        caughtError instanceof Error ? caughtError.message : 'Task could not update.',
      );
    }
  }

  async function duplicateLayout() {
    const duplicate = await dashboardRepository.duplicateLayout(currentLayout.id);
    setAnnouncement(`${duplicate.name} created.`);
  }

  async function createLayout() {
    const created = await dashboardRepository.createLayout('New layout');
    setAnnouncement(`${created.name} created. You can now customise it.`);
  }

  async function confirmAction() {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'cancel') {
      setDraftCards(copyDashboardCards(currentLayout.cards));
      setDraftName(currentLayout.name);
      setIsCustomizing(false);
    } else if (action === 'delete') {
      await dashboardRepository.deleteLayout(currentLayout.id);
      setAnnouncement(`${currentLayout.name} deleted.`);
    } else if (action === 'restoreDefaults') {
      await dashboardRepository.restoreBuiltInDefaults();
      setIsCustomizing(false);
      setAnnouncement('Built-in dashboard layouts restored.');
    }
  }

  const visibleCards = (isCustomizing ? draftCards : currentLayout.cards)
    .filter((cardConfig) => !cardConfig.hidden)
    .sort((left, right) => left.order - right.order);
  const error = plannerError ?? dashboardError ?? actionError;

  return (
    <div className="page page--home-dashboard">
      <header className="dashboard-heading">
        <div>
          <span className="eyebrow">Home</span>
          <h1>{isCustomizing ? 'Customise dashboard' : 'A calm view of what matters'}</h1>
          <p>
            {isCustomizing
              ? 'Changes stay in this draft until you save.'
              : 'A concise local overview, ready online or offline.'}
          </p>
        </div>
        {!isCustomizing ? (
          <div className="dashboard-heading__controls">
            <label className="field dashboard-layout-select">
              <span>Dashboard layout</span>
              <select
                value={activeLayout.id}
                onChange={(event) => void dashboardRepository.setActiveLayout(event.target.value)}
              >
                {state.layouts.map((layout) => (
                  <option key={layout.id} value={layout.id}>
                    {layout.name}
                    {layout.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="secondary" onClick={() => startCustomizing()}>
              Customise dashboard
            </Button>
            <details className="dashboard-layout-options">
              <summary>Layout options</summary>
              <div>
                <Button type="button" variant="quiet" onClick={() => void createLayout()}>
                  New layout
                </Button>
                <Button type="button" variant="quiet" onClick={() => void duplicateLayout()}>
                  Duplicate layout
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={activeLayout.isDefault}
                  onClick={() => void dashboardRepository.setDefaultLayout(activeLayout.id)}
                >
                  Set as default
                </Button>
                {!activeLayout.builtInKey ? (
                  <Button
                    type="button"
                    variant="quiet"
                    className="destructive-text"
                    onClick={() => setConfirmation('delete')}
                  >
                    Delete layout
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setConfirmation('restoreDefaults')}
                >
                  Restore built-in defaults
                </Button>
              </div>
            </details>
          </div>
        ) : null}
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {isCustomizing ? (
        <DashboardCustomizer
          layout={activeLayout}
          name={draftName}
          cards={draftCards}
          dirty={isDirty}
          onNameChange={setDraftName}
          onCardsChange={setDraftCards}
          onCancel={requestCancel}
          onSave={() => void saveCustomization()}
        />
      ) : suggestions.length > 0 ? (
        <aside className="dashboard-suggestions" aria-labelledby="dashboard-suggestions-title">
          <h2 id="dashboard-suggestions-title">Optional suggestions</h2>
          {suggestions.map((suggestion) => (
            <div key={suggestion.type}>
              <p>{suggestion.message}</p>
              <div>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => startCustomizing(suggestion.cardType)}
                >
                  Review card
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() =>
                    void dashboardRepository.dismissSuggestion(activeLayout.id, suggestion.type)
                  }
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </aside>
      ) : null}

      <div className="dashboard-grid" aria-label={`${activeLayout.name} dashboard`}>
        {visibleCards.map((cardConfig) => (
          <DashboardCard
            key={cardConfig.type}
            config={cardConfig}
            snapshot={snapshot}
            today={today}
            onComplete={completeTask}
            onEdit={setEditingTask}
          />
        ))}
      </div>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      {editingTask ? (
        <TaskEditorDialog
          task={editingTask}
          snapshot={snapshot}
          onClose={() => setEditingTask(null)}
        />
      ) : null}
      {confirmation ? (
        <ConfirmDashboardAction
          action={confirmation}
          layoutName={activeLayout.name}
          onClose={() => setConfirmation(null)}
          onConfirm={() => void confirmAction()}
        />
      ) : null}
    </div>
  );
}

function DashboardCustomizer({
  layout,
  name,
  cards,
  dirty,
  onNameChange,
  onCardsChange,
  onCancel,
  onSave,
}: {
  layout: DashboardLayoutRecord;
  name: string;
  cards: DashboardCardConfig[];
  dirty: boolean;
  onNameChange: (name: string) => void;
  onCardsChange: (cards: DashboardCardConfig[]) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const ordered = [...cards].sort((left, right) => left.order - right.order);
  return (
    <section className="dashboard-customizer" aria-labelledby="dashboard-customizer-title">
      <div className="dashboard-customizer__heading">
        <div>
          <h2 id="dashboard-customizer-title">Editing {layout.name}</h2>
          {layout.builtInKey ? (
            <p>Saving creates a custom copy. The built-in layout stays unchanged.</p>
          ) : null}
        </div>
        <span className="editing-badge">Customising</span>
      </div>
      <label className="field">
        <span>Layout name</span>
        <input value={name} maxLength={80} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <ol className="dashboard-card-controls">
        {ordered.map((cardConfig, index) => (
          <li key={cardConfig.type}>
            <label className="dashboard-card-toggle">
              <input
                type="checkbox"
                checked={!cardConfig.hidden}
                onChange={(event) =>
                  onCardsChange(
                    setDashboardCardVisibility(cards, cardConfig.type, event.target.checked),
                  )
                }
              />
              <span>{DASHBOARD_CARD_LABELS[cardConfig.type]}</span>
            </label>
            <label className="field dashboard-size-select">
              <span>Size</span>
              <select
                aria-label={`Size for ${DASHBOARD_CARD_LABELS[cardConfig.type]}`}
                value={cardConfig.size}
                onChange={(event) =>
                  onCardsChange(
                    setDashboardCardSize(
                      cards,
                      cardConfig.type,
                      event.target.value as DashboardCardSize,
                    ),
                  )
                }
              >
                {DASHBOARD_CARD_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size[0]!.toUpperCase() + size.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <div className="dashboard-move-controls">
              <button
                type="button"
                disabled={index === 0}
                aria-label={`Move ${DASHBOARD_CARD_LABELS[cardConfig.type]} up`}
                onClick={() => onCardsChange(moveDashboardCard(cards, cardConfig.type, -1))}
              >
                <span aria-hidden="true">&uarr;</span>
              </button>
              <button
                type="button"
                disabled={index === ordered.length - 1}
                aria-label={`Move ${DASHBOARD_CARD_LABELS[cardConfig.type]} down`}
                onClick={() => onCardsChange(moveDashboardCard(cards, cardConfig.type, 1))}
              >
                <span aria-hidden="true">&darr;</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="dialog__actions">
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!dirty || !name.trim()} onClick={onSave}>
          Save dashboard
        </Button>
      </div>
    </section>
  );
}

function ConfirmDashboardAction({
  action,
  layoutName,
  onClose,
  onConfirm,
}: {
  action: Exclude<Confirmation, null>;
  layoutName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const content = {
    cancel: {
      title: 'Discard dashboard changes?',
      description: 'Your saved layout will stay as it was before customising.',
      label: 'Discard changes',
    },
    delete: {
      title: `Delete ${layoutName}?`,
      description: 'The layout will be removed. Your tasks and other layouts are unaffected.',
      label: 'Delete layout',
    },
    restoreDefaults: {
      title: 'Restore built-in layouts?',
      description:
        'Overview, Focus, and Planning will return to their original card arrangements. Custom layouts remain.',
      label: 'Restore defaults',
    },
  }[action];
  return (
    <Dialog title={content.title} description={content.description} onClose={onClose}>
      <div className="dialog__actions">
        <Button type="button" variant="quiet" onClick={onClose}>
          Keep current
        </Button>
        <Button
          type="button"
          className={action === 'delete' ? 'button--destructive' : ''}
          onClick={onConfirm}
        >
          {content.label}
        </Button>
      </div>
    </Dialog>
  );
}

function useDashboardNavigationWarning(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const message = 'Discard unsaved dashboard changes?';
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };
    const protectNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (target && !window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', protectNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', protectNavigation, true);
    };
  }, [isDirty]);
}
