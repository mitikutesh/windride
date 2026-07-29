/**
 * utils/gpx.ts — hand-rolled GPX 1.1 writer + minimal parser (WR-010). Pure, dependency-free.
 * The same writer serves the ride recorder (NAVIGATION_SPEC §6), which adds <time> per point.
 */
export interface GpxPoint {
  lat: number;
  lon: number;
  /** Elevation in metres. */
  ele?: number;
  /** ISO-8601 timestamp (recorder output). */
  time?: string;
}

export interface GpxTrack {
  name?: string;
  creator?: string;
  /** Track metadata time (ISO-8601). */
  time?: string;
  points: GpxPoint[];
}

const GPX_NS = 'http://www.topografix.com/GPX/1/1';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const SCHEMA = 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Serialise a track to a GPX 1.1 document (single <trk> with one <trkseg>). */
export function toGpx(track: GpxTrack): string {
  const creator = escapeXml(track.creator ?? 'WindRide');
  const name = track.name ? `    <name>${escapeXml(track.name)}</name>\n` : '';
  const metaTime = track.time ? `    <time>${escapeXml(track.time)}</time>\n` : '';
  // Tracks come from idb and may predate the sync-pull validation (F-002): a missing points array
  // or non-finite/string coordinates must degrade to a valid (if sparse) document, never a throw
  // on Export or attribute injection into the XML.
  const pts = (Array.isArray(track.points) ? track.points : [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
    .map((p) => {
      const ele = Number.isFinite(p.ele) ? `<ele>${p.ele}</ele>` : '';
      const time = p.time ? `<time>${escapeXml(String(p.time))}</time>` : '';
      const inner = ele || time ? `${ele}${time}` : '';
      return inner
        ? `      <trkpt lat="${p.lat}" lon="${p.lon}">${inner}</trkpt>`
        : `      <trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>`;
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${creator}" xmlns="${GPX_NS}" ` +
    `xmlns:xsi="${XSI_NS}" xsi:schemaLocation="${SCHEMA}">\n` +
    `  <metadata>\n${name}${metaTime}  </metadata>\n` +
    `  <trk>\n${name ? `    <name>${escapeXml(track.name!)}</name>\n` : ''}` +
    `    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`
  );
}

/** Parse the track points back out of a GPX document (for the round-trip test / re-import). */
export function fromGpx(xml: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  // One pattern handles both self-closing <trkpt .../> and paired <trkpt ...>...</trkpt>; the
  // self-closing branch must be tried first so its attributes don't swallow a later "/".
  const trkpt = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
  let m: RegExpExecArray | null;
  while ((m = trkpt.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const lat = Number(/lat="([-\d.]+)"/.exec(attrs)?.[1]);
    const lon = Number(/lon="([-\d.]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const point: GpxPoint = { lat, lon };
    const ele = /<ele>([-\d.]+)<\/ele>/.exec(inner)?.[1];
    if (ele !== undefined) point.ele = Number(ele);
    const time = /<time>([^<]+)<\/time>/.exec(inner)?.[1];
    if (time !== undefined) point.time = time;
    points.push(point);
  }
  return points;
}

/** e.g. windride-2026-07-17-50km.gpx */
export function gpxFilename(distanceKm: number, dateISO: string): string {
  const date = dateISO.slice(0, 10);
  return `windride-${date}-${Math.round(distanceKm)}km.gpx`;
}
