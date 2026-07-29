import { describe, expect, it } from 'vitest';
import { escapeXml, fromGpx, gpxFilename, toGpx, type GpxTrack } from './gpx';

const track: GpxTrack = {
  name: 'WindRide 52 km',
  points: [
    { lat: 60.15, lon: 24.65, ele: 12 },
    { lat: 60.153, lon: 24.652, ele: 13.5 },
    { lat: 60.156, lon: 24.655, ele: 15 },
  ],
};

describe('toGpx / fromGpx', () => {
  it('produces GPX 1.1 with a WindRide creator and <trk>/<ele>', () => {
    const xml = toGpx(track);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('creator="WindRide"');
    expect(xml).toContain('http://www.topografix.com/GPX/1/1');
    expect(xml).toContain('<trk>');
    expect(xml).toContain('<ele>12</ele>');
  });

  it('round-trips coordinates and elevation (ε 1e-6)', () => {
    const back = fromGpx(toGpx(track));
    expect(back).toHaveLength(track.points.length);
    back.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(track.points[i].lat, 6);
      expect(p.lon).toBeCloseTo(track.points[i].lon, 6);
      expect(p.ele).toBeCloseTo(track.points[i].ele!, 6);
    });
  });

  it('escapes XML in names', () => {
    expect(escapeXml('A & B <"quote">')).toBe('A &amp; B &lt;&quot;quote&quot;&gt;');
    const xml = toGpx({ name: 'Ride & <go>', points: track.points });
    expect(xml).toContain('Ride &amp; &lt;go&gt;');
    expect(xml).not.toContain('<go>');
  });

  it('names the file windride-<date>-<km>km.gpx', () => {
    expect(gpxFilename(51.8, '2026-07-17T12:00:00Z')).toBe('windride-2026-07-17-52km.gpx');
  });

  it('tolerates a malformed track from legacy idb: no throw, junk points skipped (F-002)', () => {
    const noPoints = { name: 'broken' } as unknown as GpxTrack;
    expect(toGpx(noPoints)).toContain('<trkseg>');
    const junk = {
      points: [
        { lat: 60.15, lon: 24.65 },
        { lat: NaN, lon: 24.66 },
        { lat: '61" onload="x' as unknown as number, lon: 24.67 },
        { lat: 60.16, lon: 24.68, ele: NaN },
      ],
    } as GpxTrack;
    const xml = toGpx(junk);
    expect(fromGpx(xml)).toHaveLength(2); // only the two finite points survive
    expect(xml).not.toContain('onload'); // string lat can't inject attributes
    expect(xml).not.toContain('NaN');
  });

  it('parses a mix of self-closing and paired trkpts without dropping points', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lat="60.1" lon="24.1"/>
      <trkpt lat="60.2" lon="24.2"><ele>15</ele></trkpt>
      <trkpt lat="60.3" lon="24.3"/>
    </trkseg></trk></gpx>`;
    const pts = fromGpx(xml);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ lat: 60.1, lon: 24.1 });
    expect(pts[1].ele).toBe(15); // ele stays on its own point, not migrated
    expect(pts[2]).toEqual({ lat: 60.3, lon: 24.3 });
  });
});
