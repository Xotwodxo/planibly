import { useState, type CSSProperties, type FormEvent } from 'react';

import { ENTITY_COLORS, type ListMode } from '../../data/plannerTypes';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useUnsavedChanges } from './unsavedChanges';

type EntityEditorDialogProps = {
  entityLabel: 'area' | 'list';
  initialName?: string;
  initialColor?: string;
  initialMode?: ListMode;
  onClose: () => void;
  onSave: (name: string, color: string, mode: ListMode) => Promise<void>;
};

export function EntityEditorDialog({
  entityLabel,
  initialName = '',
  initialColor = ENTITY_COLORS[0].value,
  initialMode = 'standard',
  onClose,
  onSave,
}: EntityEditorDialogProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [mode, setMode] = useState<ListMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const title = initialName ? `Edit ${entityLabel}` : `New ${entityLabel}`;
  useUnsavedChanges(name !== initialName || color !== initialColor || mode !== initialMode);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(`Enter a name for this ${entityLabel}.`);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(name.trim(), color, mode);
      onClose();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `The ${entityLabel} could not be saved.`,
      );
      setIsSaving(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
        </label>
        <fieldset className="color-fieldset">
          <legend>Colour</legend>
          <div className="color-options">
            {ENTITY_COLORS.map((option) => (
              <label key={option.value} className="color-option" title={option.label}>
                <input
                  type="radio"
                  name="color"
                  value={option.value}
                  checked={color === option.value}
                  onChange={() => setColor(option.value)}
                />
                <span
                  className="color-swatch"
                  style={{ '--entity-color': option.value } as CSSProperties}
                />
                <span className="visually-hidden">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {entityLabel === 'list' && !initialName ? (
          <fieldset className="choice-fieldset">
            <legend>List type</legend>
            <label>
              <input
                type="radio"
                name="list-mode"
                value="standard"
                checked={mode === 'standard'}
                onChange={() => setMode('standard')}
              />
              Standard List
            </label>
            <label>
              <input
                type="radio"
                name="list-mode"
                value="project"
                checked={mode === 'project'}
                onChange={() => setMode('project')}
              />
              Project
            </label>
          </fieldset>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog__actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
