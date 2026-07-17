// Vitest global setup (WR-002). Adds jest-dom matchers and unmounts React trees between tests.
// Safe under the node environment too (matchers/cleanup only touch the DOM when invoked).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
