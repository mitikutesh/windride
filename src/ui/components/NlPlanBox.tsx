import { useState } from 'react';
import { useNlPlanStore } from '../../state/nlPlanStore';

/**
 * Natural-language planning box (WR-046). Opt-in: the parent only mounts this when AI is set up.
 * The AI call + validation + clamping live in nlPlanStore (UI never touches adapters); this just
 * captures the text and reflects the store's status. On success the plan controls below are filled;
 * the user reviews them and taps Plan — this never plans on its own.
 */
export function NlPlanBox() {
  const [text, setText] = useState('');
  const status = useNlPlanStore((s) => s.status);
  const summary = useNlPlanStore((s) => s.summary);
  const changed = useNlPlanStore((s) => s.changed);
  const error = useNlPlanStore((s) => s.error);
  const interpret = useNlPlanStore((s) => s.interpret);

  const loading = status === 'loading';

  return (
    <div className="wr-field wr-nlplan">
      <label className="wr-field__label" htmlFor="wr-nlplan-input">
        Describe your ride (AI)
      </label>
      <textarea
        id="wr-nlplan-input"
        className="wr-input wr-nlplan__input"
        rows={2}
        placeholder="e.g. a 40 km gravel loop on quiet roads, back before dark"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="wr-nlplan__actions">
        <button
          type="button"
          className="wr-navlink"
          onClick={() => void interpret(text)}
          disabled={loading || text.trim().length === 0}
        >
          {loading ? 'Reading…' : 'Fill from text'}
        </button>
      </div>
      <div className="wr-nlplan__status" aria-live="polite">
        {status === 'ready' ? (
          <>
            {changed.length > 0 ? (
              <p className="wr-nlplan__chips">
                <span className="wr-muted">Updated:</span>{' '}
                {changed.map((label) => (
                  <span key={label} className="wr-nlplan__chip">
                    {label}
                  </span>
                ))}
              </p>
            ) : null}
            {summary ? <p className="wr-muted">{summary} Review below, then Plan.</p> : null}
          </>
        ) : null}
        {status === 'error' && error ? <p className="wr-muted">{error}</p> : null}
      </div>
    </div>
  );
}
