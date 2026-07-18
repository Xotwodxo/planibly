import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { ENTITY_COLORS, type PlannerSnapshot } from '../../data/plannerTypes';
import { routineRepository } from '../../data/routineRepository';
import {
  ROUTINE_PRESENTATION_STYLES,
  ROUTINE_SCHEDULE_KINDS,
  ROUTINE_SCHEDULE_LABELS,
  ROUTINE_SECTIONS,
  ROUTINE_SECTION_LABELS,
  ROUTINE_STYLE_LABELS,
  type RoutineItemInput,
  type RoutinePresentationStyle,
  type RoutineRecord,
  type RoutineScheduleKind,
  type RoutineSection,
  type RoutineVariantInput,
} from '../../data/routineTypes';
import { useUnsavedChanges } from '../planner/unsavedChanges';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function newItem(title = ''): RoutineItemInput {
  return {
    id: crypto.randomUUID(),
    title,
    order: 0,
    isActive: true,
  };
}

export function RoutineEditorDialog({
  routine,
  snapshot,
  onClose,
  onSaved,
}: {
  routine?: RoutineRecord;
  snapshot: PlannerSnapshot;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const existingItems = routine
    ? snapshot.routineItems.filter((item) => item.routineId === routine.id)
    : [];
  const existingVariants = routine
    ? snapshot.routineVariants.filter((variant) => variant.routineId === routine.id)
    : [];
  const [name, setName] = useState(routine?.name ?? '');
  const [color, setColor] = useState(routine?.color ?? '#5B67C8');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [isActive, setIsActive] = useState(routine?.isActive ?? true);
  const [expectedDuration, setExpectedDuration] = useState(
    routine?.expectedDurationMinutes?.toString() ?? '',
  );
  const [presentationStyle, setPresentationStyle] = useState<RoutinePresentationStyle>(
    routine?.presentationStyle ?? 'checklist',
  );
  const [scheduleKind, setScheduleKind] = useState<RoutineScheduleKind>(
    routine?.scheduleKind ?? 'manual',
  );
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(
    routine?.selectedWeekdays ?? [],
  );
  const [defaultSection, setDefaultSection] = useState<RoutineSection>(
    routine?.defaultSection ?? 'anyTime',
  );
  const [items, setItems] = useState<RoutineItemInput[]>(
    existingItems.length ? existingItems.map((item) => ({ ...item })) : [newItem('')],
  );
  const [variants, setVariants] = useState<RoutineVariantInput[]>(
    existingVariants.map((variant) => ({
      ...variant,
      weekdays: [...variant.weekdays],
      itemIds: [...variant.itemIds],
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  useUnsavedChanges(dirty);

  function change(action: () => void) {
    action();
    setDirty(true);
  }

  function requestClose() {
    if (!dirty || window.confirm('Discard unsaved routine changes?')) onClose();
  }

  function updateItem(id: string, patch: Partial<RoutineItemInput>) {
    change(() =>
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item))),
    );
  }

  function moveItem(id: string, direction: -1 | 1) {
    change(() =>
      setItems((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.id === id);
        const other = next[index + direction];
        if (index < 0 || !other) return current;
        [next[index], next[index + direction]] = [other, next[index]!];
        return next.map((item, order) => ({ ...item, order }));
      }),
    );
  }

  function deleteItem(id: string) {
    change(() => {
      setItems((current) => current.filter((item) => item.id !== id));
      setVariants((current) =>
        current.map((variant) => ({
          ...variant,
          itemIds: variant.itemIds.filter((itemId) => itemId !== id),
        })),
      );
    });
  }

  function addVariant() {
    change(() =>
      setVariants((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name: 'Day variant',
          weekdays: [],
          itemIds: items.filter((item) => item.isActive).map((item) => item.id),
          order: current.length,
        },
      ]),
    );
  }

  function updateVariant(id: string, patch: Partial<RoutineVariantInput>) {
    change(() =>
      setVariants((current) =>
        current.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)),
      ),
    );
  }

  function moveVariantItem(variantId: string, itemId: string, direction: -1 | 1) {
    const variant = variants.find((candidate) => candidate.id === variantId);
    if (!variant) return;
    const itemIds = [...variant.itemIds];
    const index = itemIds.indexOf(itemId);
    const other = itemIds[index + direction];
    if (index < 0 || !other) return;
    [itemIds[index], itemIds[index + direction]] = [other, itemIds[index]!];
    updateVariant(variantId, { itemIds });
  }

  async function save() {
    try {
      const duration = expectedDuration === '' ? undefined : Number(expectedDuration);
      const saved = await routineRepository.saveRoutine(
        {
          name,
          color,
          description,
          isActive,
          expectedDurationMinutes: duration,
          presentationStyle,
          scheduleKind,
          selectedWeekdays,
          defaultSection,
          items: items.map((item, order) => ({ ...item, order })),
          variants: variants.map((variant, order) => ({ ...variant, order })),
        },
        routine?.id,
      );
      onSaved(`${saved.name} saved.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The routine could not be saved.');
    }
  }

  return (
    <Dialog
      title={routine ? `Edit ${routine.name}` : 'Create routine'}
      description="Routines stay separate from tasks and calendar events."
      onClose={requestClose}
    >
      <form
        className="routine-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            required
            maxLength={160}
            value={name}
            onChange={(event) => change(() => setName(event.target.value))}
          />
        </label>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>Colour</span>
            <select value={color} onChange={(event) => change(() => setColor(event.target.value))}>
              {ENTITY_COLORS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Expected total duration</span>
            <input
              type="number"
              min="1"
              max="1440"
              inputMode="numeric"
              value={expectedDuration}
              onChange={(event) => change(() => setExpectedDuration(event.target.value))}
            />
          </label>
        </div>
        <label className="field">
          <span>
            Description <small>Optional</small>
          </span>
          <textarea
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(event) => change(() => setDescription(event.target.value))}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => change(() => setIsActive(event.target.checked))}
          />
          <span>Active routine</span>
        </label>

        <fieldset>
          <legend>Default presentation</legend>
          <div className="routine-style-options">
            {ROUTINE_PRESENTATION_STYLES.map((style) => (
              <label key={style}>
                <input
                  type="radio"
                  name="routine-style"
                  checked={presentationStyle === style}
                  onChange={() => change(() => setPresentationStyle(style))}
                />
                <span>
                  <strong>{ROUTINE_STYLE_LABELS[style]}</strong>
                  <small>{styleDescription(style)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-grid form-grid--two">
          <label className="field">
            <span>Schedule</span>
            <select
              value={scheduleKind}
              onChange={(event) =>
                change(() => setScheduleKind(event.target.value as RoutineScheduleKind))
              }
            >
              {ROUTINE_SCHEDULE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ROUTINE_SCHEDULE_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Default section</span>
            <select
              value={defaultSection}
              onChange={(event) =>
                change(() => setDefaultSection(event.target.value as RoutineSection))
              }
            >
              {ROUTINE_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {ROUTINE_SECTION_LABELS[section]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {scheduleKind === 'selected' ? (
          <fieldset>
            <legend>Scheduled weekdays</legend>
            <div className="weekday-options">
              {WEEKDAYS.map((label, weekday) => (
                <label key={label}>
                  <input
                    type="checkbox"
                    checked={selectedWeekdays.includes(weekday)}
                    onChange={() =>
                      change(() => setSelectedWeekdays(toggleNumber(selectedWeekdays, weekday)))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <section className="routine-editor__section" aria-labelledby="routine-items-heading">
          <div className="section-heading">
            <div>
              <h3 id="routine-items-heading">Routine items</h3>
              <p>One ordered level. Items do not become tasks.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                change(() =>
                  setItems((current) => [...current, { ...newItem(), order: current.length }]),
                )
              }
            >
              Add item
            </Button>
          </div>
          <ol className="routine-item-editor-list">
            {items.map((item, index) => (
              <li key={item.id}>
                <div className="form-grid form-grid--two">
                  <label className="field">
                    <span>Item title</span>
                    <input
                      required
                      maxLength={160}
                      value={item.title}
                      onChange={(event) => updateItem(item.id, { title: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Estimated minutes <small>Optional</small>
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      inputMode="numeric"
                      value={item.estimatedDurationMinutes ?? ''}
                      onChange={(event) =>
                        updateItem(item.id, {
                          estimatedDurationMinutes: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>
                    Note <small>Optional</small>
                  </span>
                  <input
                    maxLength={500}
                    value={item.note ?? ''}
                    onChange={(event) => updateItem(item.id, { note: event.target.value })}
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={item.isActive}
                    onChange={(event) => updateItem(item.id, { isActive: event.target.checked })}
                  />
                  <span>Active item</span>
                </label>
                <div className="inline-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={index === 0}
                    onClick={() => moveItem(item.id, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={index === items.length - 1}
                    onClick={() => moveItem(item.id, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      change(() =>
                        setItems((current) => [
                          ...current,
                          {
                            ...item,
                            id: crypto.randomUUID(),
                            title: `${item.title} copy`,
                            order: current.length,
                          },
                        ]),
                      )
                    }
                  >
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    className="destructive-text"
                    disabled={items.length === 1}
                    onClick={() => deleteItem(item.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="routine-editor__section" aria-labelledby="routine-variants-heading">
          <div className="section-heading">
            <div>
              <h3 id="routine-variants-heading">Day variants</h3>
              <p>Optional day-specific inclusion, order and style.</p>
            </div>
            <Button type="button" variant="secondary" onClick={addVariant}>
              Add variant
            </Button>
          </div>
          {variants.map((variant) => (
            <VariantEditor
              key={variant.id}
              variant={variant}
              items={items}
              onChange={(patch) => updateVariant(variant.id, patch)}
              onMoveItem={(itemId, direction) => moveVariantItem(variant.id, itemId, direction)}
              onDelete={() =>
                change(() =>
                  setVariants((current) =>
                    current.filter((candidate) => candidate.id !== variant.id),
                  ),
                )
              }
            />
          ))}
          {!variants.length ? (
            <p className="plan-empty">The default items apply every day.</p>
          ) : null}
        </section>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog__actions">
          <Button type="button" variant="quiet" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit">Save routine</Button>
        </div>
      </form>
    </Dialog>
  );
}

function VariantEditor({
  variant,
  items,
  onChange,
  onMoveItem,
  onDelete,
}: {
  variant: RoutineVariantInput;
  items: RoutineItemInput[];
  onChange: (patch: Partial<RoutineVariantInput>) => void;
  onMoveItem: (itemId: string, direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const ordered = [
    ...variant.itemIds.flatMap((id) => {
      const item = items.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    }),
    ...items.filter((item) => !variant.itemIds.includes(item.id)),
  ];
  return (
    <fieldset className="routine-variant-editor">
      <legend>{variant.name}</legend>
      <label className="field">
        <span>Variant name</span>
        <input
          maxLength={120}
          value={variant.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <div className="weekday-options">
        {WEEKDAYS.map((label, weekday) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={variant.weekdays.includes(weekday)}
              onChange={() => onChange({ weekdays: toggleNumber(variant.weekdays, weekday) })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span>Presentation override</span>
        <select
          value={variant.presentationStyle ?? ''}
          onChange={(event) =>
            onChange({
              presentationStyle: event.target.value
                ? (event.target.value as RoutinePresentationStyle)
                : undefined,
            })
          }
        >
          <option value="">Use routine default</option>
          {ROUTINE_PRESENTATION_STYLES.map((style) => (
            <option key={style} value={style}>
              {ROUTINE_STYLE_LABELS[style]}
            </option>
          ))}
        </select>
      </label>
      <ol className="variant-item-list">
        {ordered.map((item) => {
          const included = variant.itemIds.includes(item.id);
          const index = variant.itemIds.indexOf(item.id);
          return (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() =>
                    onChange({
                      itemIds: included
                        ? variant.itemIds.filter((id) => id !== item.id)
                        : [...variant.itemIds, item.id],
                    })
                  }
                />
                <span>{item.title || 'Untitled item'}</span>
              </label>
              {included ? (
                <div className="inline-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={index === 0}
                    onClick={() => onMoveItem(item.id, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={index === variant.itemIds.length - 1}
                    onClick={() => onMoveItem(item.id, 1)}
                  >
                    Down
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="quiet" className="destructive-text" onClick={onDelete}>
        Delete variant
      </Button>
    </fieldset>
  );
}

function toggleNumber(values: number[], value: number): number[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value].sort();
}

function styleDescription(style: RoutinePresentationStyle): string {
  if (style === 'checklist') return 'Show every item and complete them in any order.';
  if (style === 'stepByStep') return 'Emphasise one item while keeping the full routine available.';
  return 'Use a condensed overview for quick checking.';
}
