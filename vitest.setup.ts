// Vitest global setup (WR-002). Adds jest-dom matchers and unmounts React trees between tests.
// Safe under the node environment too (matchers/cleanup only touch the DOM when invoked).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// maplibre-gl touches URL.createObjectURL at import time; jsdom lacks it. Stub so modules that
// transitively import the map load cleanly (the map itself still no-ops without WebGL).
if (typeof window !== 'undefined' && typeof window.URL.createObjectURL !== 'function') {
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
}

afterEach(() => {
  cleanup();
});
