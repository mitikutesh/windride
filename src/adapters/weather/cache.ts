// adapters/weather/cache.ts — weather grid cache (WR-004, migrated to the shared idbCache in
// WR-005). In-memory + IndexedDB with resilient degrade-to-memory and expiry pruning.
import type { WindGrid } from '../../domain';
import { createIdbCache, type TtlCache } from '../idbCache';

export type WeatherCache = TtlCache<WindGrid>;

/**
 * @param now injectable clock (ms) so TTL is deterministic in tests. Defaults to the wall clock;
 *            this is an adapter (Date is allowed here, unlike engine/).
 */
export function createWeatherCache(now: () => number = () => Date.now()): WeatherCache {
  return createIdbCache<WindGrid>('windride-weather', 'grids', now);
}
