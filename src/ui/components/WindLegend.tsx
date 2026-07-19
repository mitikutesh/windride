import type { WindKind } from './ribbon';

/**
 * Wind-colour legend for the results map + ribbons. The route line and ribbons are coloured by each
 * stretch's wind relationship; this decodes it so the red/amber/green isn't a mystery. Also names
 * the along-route direction arrows.
 */
const ITEMS: Array<{ kind: WindKind; label: string }> = [
  { kind: 'tail', label: 'Tailwind — wind pushes you' },
  { kind: 'cross', label: 'Crosswind — from the side' },
  { kind: 'head', label: 'Headwind — wind against you' },
  { kind: 'shelter', label: 'Sheltered — forest/terrain blocks it' },
];

export function WindLegend() {
  return (
    <div className="wr-legend" aria-label="Route colour key">
      <ul className="wr-legend__list">
        {ITEMS.map((i) => (
          <li key={i.kind} className="wr-legend__item">
            <span className={`wr-legend__swatch wr-legend__swatch--${i.kind}`} aria-hidden="true" />
            {i.label}
          </li>
        ))}
      </ul>
      <p className="wr-legend__note">➤ Arrows on the route show which way to ride.</p>
    </div>
  );
}
