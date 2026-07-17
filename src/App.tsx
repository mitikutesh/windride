import { AppShell } from './ui/AppShell';
import { useHashRoute } from './ui/useHashRoute';
import { PlanScreen } from './ui/screens/PlanScreen';
import { ResultsScreen } from './ui/screens/ResultsScreen';
import { KitScreen } from './ui/screens/KitScreen';

/** WindRide app root (WR-002): design-token shell + hash-routed screens. */
export function App() {
  const [route] = useHashRoute();
  const screen =
    route === 'results' ? <ResultsScreen /> : route === 'kit' ? <KitScreen /> : <PlanScreen />;
  return <AppShell route={route}>{screen}</AppShell>;
}
