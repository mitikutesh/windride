import { useEffect } from 'react';
import { AppShell } from './ui/AppShell';
import { useHashRoute } from './ui/useHashRoute';
import { PlanScreen } from './ui/screens/PlanScreen';
import { ResultsScreen } from './ui/screens/ResultsScreen';
import { KitScreen } from './ui/screens/KitScreen';
import { RideScreen } from './ui/screens/RideScreen';
import { HelpScreen } from './ui/screens/HelpScreen';
import { AboutScreen } from './ui/screens/AboutScreen';
import { PrivacyScreen } from './ui/screens/PrivacyScreen';
import { useKeychainStore } from './state/keychainStore';

/** WindRide app root (WR-002): design-token shell + hash-routed screens. */
export function App() {
  const [route] = useHashRoute();

  // Hydrate bring-your-own API keys once at startup so live routing/transit pick them up from the
  // first plan, on any screen (task #33). Idempotent; safe if idb is unavailable.
  useEffect(() => {
    void useKeychainStore.getState().hydrate();
  }, []);

  // Ride is chrome-free (no tab bar during a ride, WR-016) — render it full-screen.
  if (route === 'ride') return <RideScreen />;

  const screen =
    route === 'results' ? (
      <ResultsScreen />
    ) : route === 'kit' ? (
      <KitScreen />
    ) : route === 'help' ? (
      <HelpScreen />
    ) : route === 'about' ? (
      <AboutScreen />
    ) : route === 'privacy' ? (
      <PrivacyScreen />
    ) : (
      <PlanScreen />
    );
  return <AppShell route={route}>{screen}</AppShell>;
}
