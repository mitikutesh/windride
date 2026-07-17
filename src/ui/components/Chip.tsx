import type { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  /** When provided, the chip is a toggle button reflecting `selected` via aria-pressed. */
  onClick?: () => void;
  selected?: boolean;
}

/** A pill (DESIGN §4). Interactive when `onClick` is given, otherwise a static label. */
export function Chip({ children, onClick, selected = false }: ChipProps) {
  if (!onClick) {
    return <span className="wr-chip">{children}</span>;
  }
  return (
    <button
      type="button"
      className={['wr-chip', 'wr-chip--btn', selected ? 'is-selected' : '']
        .filter(Boolean)
        .join(' ')}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
