import { describe, expect, it } from 'vitest';
import { describeWeatherProviderContract } from '../providerContract';
import { MockWeatherProvider } from './mock';

describeWeatherProviderContract(
  'MockWeatherProvider',
  () => new MockWeatherProvider(),
  (kind) => new MockWeatherProvider({ failWith: kind }),
);

describe('MockWeatherProvider scenarios', () => {
  it('sw-steady is a constant 8 m/s wind FROM 225°', async () => {
    const grid = await new MockWeatherProvider({ scenario: 'sw-steady' }).windAlong(
      [{ lat: 60, lon: 24 }],
      3,
    );
    for (const s of grid[0]) {
      expect(s.windMs).toBe(8);
      expect(s.windFromDeg).toBe(225);
    }
  });

  it('shifting veers the wind direction across hours', async () => {
    const grid = await new MockWeatherProvider({ scenario: 'shifting' }).windAlong(
      [{ lat: 60, lon: 24 }],
      4,
    );
    expect(grid[0][0].windFromDeg).not.toBe(grid[0][3].windFromDeg);
  });

  it('fixture scenario is fed by the captured sample (not the sw-steady defaults)', async () => {
    const grid = await new MockWeatherProvider({ scenario: 'fixture' }).windAlong(
      [{ lat: 60, lon: 24 }],
      3,
    );
    // Values unique to the captured fixtures/openmeteo/real-espoo.json (sw-steady is 8/17/225 flat).
    expect(grid[0][0].tempC).toBe(22.4);
    expect(grid[0][1].windMs).toBe(3.8);
    expect(grid[0][2].windFromDeg).toBe(171);
  });
});
