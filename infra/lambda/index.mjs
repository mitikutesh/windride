// WindRide API Lambda (WR-038) — one function behind a Function URL, routing by path. The skeleton
// serves GET /health; auth'd endpoints (/me, sync) are added by later stories, each verifying the
// Cognito JWT in-handler. Plain ESM JS (no build step) so `Code.fromAsset` zips it as-is and `cdk
// synth` needs no Docker/bundler. Pure, dependency-light; unit-tested via test/health-handler.test.ts.

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Route a Lambda Function URL event. Exported for unit tests (no AWS needed). */
export async function route(event) {
  const method = event?.requestContext?.http?.method ?? 'GET';
  const path = event?.rawPath ?? '/';

  if (method === 'GET' && path === '/health') {
    return json(200, { status: 'ok', version: process.env.BUILD_VERSION ?? 'dev' });
  }
  return json(404, { error: 'not found', path });
}

export const handler = route;
