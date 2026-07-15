import { useEffect, useId, useRef, type PropsWithChildren } from 'react';

type DialogProps = PropsWithChildren<{
  title: string;
  description?: string;
  onClose: () => void;
}>;

export function Dialog({ children, description, onClose, title }: DialogProps) {
  const dialogReference = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogReference.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogReference}
      className="dialog"
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog__heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <button className="dialog__close" type="button" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
