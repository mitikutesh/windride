import { useEffect, useState, type ReactNode } from 'react';
import { CuratedCredit } from './components/CuratedCredit';
import type { Route } from './useHashRoute';

interface NavItem {
  route: Route;
  label: string;
  icon: ReactNode;
}

/** Stroke-style tab glyphs (currentColor, so the active tint comes from CSS). */
const ICONS = {
  plan: (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 8.5 L13 13 L8.5 15.5 L11 11 Z" fill="currentColor" />
    </svg>
  ),
  results: (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      <path
        d="M5 18c6 0 3-11 14-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="5" cy="18" r="2.4" fill="currentColor" />
      <circle cx="19" cy="6" r="2.4" fill="currentColor" />
    </svg>
  ),
  ride: (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      <path d="M12 2.5 L18.5 20.5 L12 16.8 L5.5 20.5 Z" fill="currentColor" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      <circle cx="5" cy="12" r="2.1" fill="currentColor" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
      <circle cx="19" cy="12" r="2.1" fill="currentColor" />
    </svg>
  ),
};

/** The three primary destinations — always one thumb away (DEC-055 mobile-first shell). */
const TABS: NavItem[] = [
  { route: 'plan', label: 'Plan', icon: ICONS.plan },
  { route: 'results', label: 'Routes', icon: ICONS.results },
  { route: 'ride', label: 'Ride', icon: ICONS.ride },
];
/** Secondary destinations, tucked behind the More tab. */
const MORE: { route: Route; label: string }[] = [
  { route: 'kit', label: 'Kit — keys & calibration' },
  { route: 'help', label: 'Help' },
  { route: 'about', label: 'About' },
  { route: 'privacy', label: 'Privacy' },
];

interface AppShellProps {
  route: Route;
  children: ReactNode;
}

/**
 * App shell (WR-002, redesigned in DEC-055): slim brand header, content, the required attribution
 * footer, and a fixed bottom tab bar (Plan / Routes / Ride / More) sized for a gloved thumb.
 * Tabs are real anchors so links stay copyable and announced as links; useHashRoute swaps screens.
 */
export function AppShell({ route, children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((m) => m.route === route);

  // Navigating anywhere closes the More sheet; Escape closes it in place.
  useEffect(() => setMoreOpen(false), [route]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <div className="wr-shell">
      <header className="wr-shell__header">
        <span className="wr-shell__brand">WindRide</span>
      </header>

      <main className="wr-shell__main">{children}</main>

      <footer className="wr-shell__footer">
        Built by{' '}
        <a
          className="wr-link"
          href="https://mitikuteshome.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Mitiku Geleta
        </a>{' '}
        · © OpenStreetMap contributors · Weather by the Finnish Meteorological Institute &amp;
        Open-Meteo (CC-BY 4.0)
        <CuratedCredit /> ·{' '}
        <a className="wr-link" href="#/privacy">
          Privacy
        </a>
      </footer>

      {moreOpen ? (
        // Click-away layer under the sheet: any tap outside the menu dismisses it.
        <div className="wr-more__scrim" aria-hidden="true" onClick={() => setMoreOpen(false)} />
      ) : null}
      {moreOpen ? (
        <div className="wr-more" id="wr-more-menu" aria-label="More">
          {MORE.map((item) => (
            <a
              key={item.route}
              href={`#/${item.route}`}
              className={['wr-more__link', route === item.route ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-current={route === item.route ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </div>
      ) : null}

      <nav className="wr-tabbar" aria-label="Primary">
        {TABS.map((item) => (
          <a
            key={item.route}
            href={`#/${item.route}`}
            className={['wr-tab', route === item.route ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-current={route === item.route ? 'page' : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
        <button
          type="button"
          className={['wr-tab', moreActive || moreOpen ? 'is-active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-expanded={moreOpen}
          aria-controls="wr-more-menu"
          onClick={() => setMoreOpen((o) => !o)}
        >
          {ICONS.more}
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
