import { useBriefingStore } from '../../state/briefingStore';
import type { BriefingConditions, BriefingWinter } from '../../engine/briefing';
import type { ScoredCandidate } from '../../engine/scoring';

interface Props {
  scored: ScoredCandidate;
  cond: BriefingConditions | null;
  winter?: BriefingWinter | null;
  /** Hours from now the ride departs (plan input) — threads through to the daylight margin. */
  departureHour?: number;
}

/**
 * On-demand AI ride briefing for the selected route (WR-045). Opt-in: the parent only mounts this
 * when AI is set up. The actual AI call lives in briefingStore (UI never touches adapters); this is
 * a pure view over its status machine. The briefing is tagged by routeId so switching the selected
 * route doesn't show a stale briefing.
 */
export function RideBriefing({ scored, cond, winter, departureHour }: Props) {
  const status = useBriefingStore((s) => s.status);
  const briefing = useBriefingStore((s) => s.briefing);
  const error = useBriefingStore((s) => s.error);
  const routeId = useBriefingStore((s) => s.routeId);
  const generate = useBriefingStore((s) => s.generate);

  const forThisRoute = routeId === scored.candidate.id;
  const loading = forThisRoute && status === 'loading';
  const ready = forThisRoute && status === 'ready' && briefing !== null;
  const failed = forThisRoute && status === 'error';

  const run = () => {
    if (cond) void generate(scored, cond, winter ?? null, { departureHour });
  };

  return (
    <div className="wr-briefing">
      {ready && briefing ? (
        <div className="wr-briefing__out">
          <p className="wr-briefing__summary">{briefing.summary}</p>
          <h4>What to wear</h4>
          <ul>
            {briefing.clothing.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <h4>Fuel &amp; water</h4>
          <p>{briefing.fuel}</p>
          {briefing.safety.length > 0 ? (
            <>
              <h4>Safety</h4>
              <ul>
                {briefing.safety.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="wr-muted wr-briefing__note">
            Written by your AI from this ride’s numbers. Use your own judgement on the day.
          </p>
        </div>
      ) : null}

      <button type="button" className="wr-navlink" onClick={run} disabled={loading || !cond}>
        {loading ? 'Thinking…' : ready ? 'Refresh briefing' : 'Get today’s briefing'}
      </button>
      {!cond ? (
        <p className="wr-muted">Today’s conditions aren’t loaded yet — try again in a moment.</p>
      ) : null}
      {failed ? <p className="wr-muted">{error}</p> : null}
    </div>
  );
}
