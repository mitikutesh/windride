import { useId } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible text that is also the control's accessible name. */
  label: string;
  /** Disabled switches (e.g. "Shelter me" until Epic 3) stay focusable and describe why. */
  disabled?: boolean;
  title?: string;
}

/** An accessible switch (DESIGN §4). The label text is the accessible name. */
export function Toggle({ checked, onChange, label, disabled = false, title }: ToggleProps) {
  const descId = useId();
  const describe = disabled && title ? descId : undefined;
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        // aria-disabled (not the `disabled` attribute) keeps the control focusable so keyboard
        // and screen-reader users can still read why it is off (WCAG-friendlier than a dead button).
        aria-disabled={disabled || undefined}
        aria-describedby={describe}
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
      {describe ? (
        <span id={descId} className="wr-visually-hidden">
          {title}
        </span>
      ) : null}
    </>
  );
}
