import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM JS Lambda handler (no types); imported directly for a unit test.
import { route } from '../lambda/index.mjs';

function ev(method: string, path: string) {
  return { requestContext: { http: { method } }, rawPath: path };
}

describe('API Lambda handler (WR-038)', () => {
  it('GET /health returns 200 with status + version', async () => {
    const res = await route(ev('GET', '/health'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
  });

  it('unknown route returns 404', async () => {
    const res = await route(ev('GET', '/nope'));
    expect(res.statusCode).toBe(404);
  });

  it('is JSON with the right content-type', async () => {
    const res = await route(ev('GET', '/health'));
    expect(res.headers['content-type']).toBe('application/json');
  });
});
