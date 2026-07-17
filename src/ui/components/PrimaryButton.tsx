import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/** The one aurora call-to-action (DESIGN §4). Pill-shaped, glove-sized (>=44px). */
export function PrimaryButton({
  children,
  className,
  type = 'button',
  ...rest
}: PrimaryButtonProps) {
  return (
    <button type={type} className={['wr-btn', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}
