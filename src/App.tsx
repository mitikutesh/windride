import { AppShell } from './ui/AppShell';
import { useHashRoute } from './ui/useHashRoute';
import { PlanScreen } from './ui/screens/PlanScreen';
import { ResultsScreen } from './ui/screens/ResultsScreen';
import { KitScreen } from './ui/screens/KitScreen';
import { RideScreen } from './ui/screens/RideScreen';

/** WindRide app root (WR-002): design-token shell + hash-routed screens. */
export function App() {
  const [route] = useHashRoute();

  // Ride is chrome-free (no tab bar during a ride, WR-016) — render it full-screen.
  if (route === 'ride') return <RideScreen />;

  const screen =
    route === 'results' ? <ResultsScreen /> : route === 'kit' ? <KitScreen /> : <PlanScreen />;
  return <AppShell route={route}>{screen}</AppShell>;
}
