import type { ReactNode } from 'react';
import type { Route } from './useHashRoute';

interface NavItem {
  route: Route;
  label: string;
}
const NAV: NavItem[] = [
  { route: 'plan', label: 'Plan' },
  { route: 'results', label: 'Results' },
  { route: 'kit', label: 'Kit' },
];

interface AppShellProps {
  route: Route;
  children: ReactNode;
}

/** App shell (WR-002): header + Plan/Results nav, content, and the required attribution footer.
 *  Nav uses real anchors so links are copyable/openable and announced as links; the router's
 *  hashchange listener (useHashRoute) drives the screen swap. */
export function AppShell({ route, children }: AppShellProps) {
  return (
    <div className="wr-shell">
      <header className="wr-shell__header">
        <span className="wr-shell__brand">WindRide</span>
        <nav className="wr-shell__nav" aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.route}
              href={`#/${item.route}`}
              className={['wr-navlink', route === item.route ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-current={route === item.route ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="wr-shell__main">{children}</main>

      <footer className="wr-shell__footer">
        © OpenStreetMap contributors · Weather by the Finnish Meteorological Institute &amp;
        Open-Meteo (CC-BY 4.0)
      </footer>
    </div>
  );
}
