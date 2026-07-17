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

  it('fixture scenario is fed by the captured sample', async () => {
    const grid = await new MockWeatherProvider({ scenario: 'fixture' }).windAlong(
      [{ lat: 60, lon: 24 }],
      3,
    );
    expect(grid[0][0].windMs).toBeCloseTo(8.0);
    expect(grid[0][0].windFromDeg).toBe(225);
  });
});
