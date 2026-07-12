import type { HTMLAttributes, PropsWithChildren } from 'react';

type SurfaceProps = PropsWithChildren<HTMLAttributes<HTMLElement>>;

export function Surface({ children, className = '', ...props }: SurfaceProps) {
  return (
    <section className={`surface ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}
