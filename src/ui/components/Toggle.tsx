interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible text that is also the control's accessible name. */
  label: string;
  /** Disabled switches (e.g. "Shelter me" until Epic 3) show a tooltip via `title`. */
  disabled?: boolean;
  title?: string;
}

/** An accessible switch (DESIGN §4). The label text is the accessible name. */
export function Toggle({ checked, onChange, label, disabled = false, title }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      className={['wr-toggle', checked ? 'is-on' : '', disabled ? 'is-disabled' : '']
        .filter(Boolean)
        .join(' ')}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="wr-toggle__track" aria-hidden="true">
        <span className="wr-toggle__thumb" />
      </span>
      <span className="wr-toggle__label">{label}</span>
    </button>
  );
}
