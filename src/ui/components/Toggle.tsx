interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible text that is also the control's accessible name. */
  label: string;
}

/** An accessible switch (DESIGN §4). The label text is the accessible name. */
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={['wr-toggle', checked ? 'is-on' : ''].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
    >
      <span className="wr-toggle__track" aria-hidden="true">
        <span className="wr-toggle__thumb" />
      </span>
      <span className="wr-toggle__label">{label}</span>
    </button>
  );
}
