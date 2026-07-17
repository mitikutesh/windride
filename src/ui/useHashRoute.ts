import { useEffect, useState } from 'react';

// Minimal hash router (WR-002). A dependency-free stand-in until routing needs grow;
// hash routes work offline in a PWA without server history fallback. Real screens land in
// WR-008 (Plan) / WR-009 (Results).
export type Route = 'plan' | 'results' | 'kit' | 'ride';
const ROUTES: readonly Route[] = ['plan', 'results', 'kit', 'ride'];

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'plan';
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = `#/${r}`;
  };
  return [route, navigate];
}
