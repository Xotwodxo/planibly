import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';

type IconButtonProps = PropsWithChildren<{
  label: string;
  to: string;
}>;

export function IconButton({ children, label, to }: IconButtonProps) {
  return (
    <Link className="icon-button" to={to} aria-label={label} title={label}>
      {children}
    </Link>
  );
}
