import { useEffect, useRef, type PropsWithChildren } from 'react';

type DialogProps = PropsWithChildren<{
  title: string;
  description?: string;
  onClose: () => void;
}>;

export function Dialog({ children, description, onClose, title }: DialogProps) {
  const dialogReference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogReference.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogReference}
      className="dialog"
      aria-describedby={description ? 'dialog-description' : undefined}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog__heading">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {description ? <p id="dialog-description">{description}</p> : null}
        </div>
        <button className="dialog__close" type="button" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
