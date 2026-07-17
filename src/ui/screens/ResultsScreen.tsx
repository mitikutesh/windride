/** Results screen placeholder (WR-002). The MapLibre map + route cards land in WR-009. */
export function ResultsScreen() {
  return (
    <section className="wr-screen">
      <h1>Your routes</h1>
      <p className="wr-muted">
        The top three candidates for today’s conditions will appear here on a map with per-segment
        wind colouring, wind-aware ETAs and a plain-language explanation.
      </p>
      <p className="wr-muted">The map and route cards arrive in WR-009.</p>
    </section>
  );
}
