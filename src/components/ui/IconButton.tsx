import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';

type IconButtonProps = PropsWithChildren<
  { label: string } & ({ to: string; onClick?: never } | { to?: never; onClick: () => void })
>;

export function IconButton(props: IconButtonProps) {
  const { children, label } = props;
  if (props.to) {
    return (
      <Link className="icon-button" to={props.to} aria-label={label} title={label}>
        {children}
      </Link>
    );
  }

  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      onClick={props.onClick}
    >
      {children}
    </button>
  );
}
