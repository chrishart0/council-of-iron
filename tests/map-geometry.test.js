import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { borderNetwork, insideRings, provinceRings, segmentDistance } from '../public/map-geometry.js';

const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url)));
// Known gameplay links whose polygons do not share a border line. Reported, not silently changed:
// adjacency is a rule, geometry is presentation.
const KNOWN_LAND_LINKS_WITHOUT_BORDER = {
  'imperial-map.json': ['poland|west-russia'], // polygons meet only at a corner point
};

for (const name of ['imperial-map.json']) {
  const map = load(name);
  const provinces = map.provinces.map(p => ({ ...p, rings: provinceRings(p.path) }));
  const boundaryDistance = (point, other) => Math.min(...other.rings.flatMap(ring => ring.map((a, i) => segmentDistance(point, a, ring[(i + 1) % ring.length]))));
  const boxes = new Map(provinces.map(p => {
    const xs = p.rings.flat().map(v => v[0]), ys = p.rings.flat().map(v => v[1]);
    return [p.id, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]];
  }));
  const near = (a, b, pad) => { const [p, q] = [boxes.get(a.id), boxes.get(b.id)]; return p[0] <= q[2] + pad && q[0] <= p[2] + pad && p[1] <= q[3] + pad && q[1] <= p[3] + pad; };

  test(`${name}: every province path parses into finite closed rings`, () => {
    for (const p of provinces) {
      assert.ok(p.rings.length, p.id);
      for (const ring of p.rings) { assert.ok(ring.length >= 3, p.id); assert.ok(ring.flat().every(Number.isFinite), p.id); }
    }
  });

  test(`${name}: shared borders coincide exactly (no drift slivers) and provinces never overlap`, () => {
    const drift = [], overlaps = [];
    for (const a of provinces) for (const b of provinces) {
      if (a === b || !near(a, b, 1)) continue;
      for (const ring of a.rings) for (let i = 0; i < ring.length; i++) {
        const v = ring[i], w = ring[(i + 1) % ring.length], mid = [(v[0] + w[0]) / 2, (v[1] + w[1]) / 2];
        const d = boundaryDistance(v, b);
        // A vertex either lies on the neighbour's border (split-province junctions are rounded to
        // 0.01 units, invisible at maximum zoom) or is clearly separate from it (narrow straits).
        if (d > .01 && d < .09) drift.push(`${a.id}/${b.id} ${d.toFixed(4)} @${v}`);
        if (d > .05 && insideRings(v, b.rings)) overlaps.push(`${a.id} vertex inside ${b.id} @${v}`);
        if (boundaryDistance(mid, b) > .05 && insideRings(mid, b.rings)) overlaps.push(`${a.id} edge inside ${b.id} @${mid}`);
      }
    }
    assert.deepEqual(drift, []);
    assert.deepEqual(overlaps, []);
  });

  test(`${name}: counter anchors sit on their own province`, () => {
    for (const p of provinces) {
      const onLand = insideRings([p.x, p.y], p.rings) || boundaryDistance([p.x, p.y], p) < 1;
      assert.ok(onLand, `${p.id} anchor ${p.x},${p.y}`);
    }
  });

  test(`${name}: gameplay adjacency agrees with touching geometry, except documented links`, () => {
    const { shared, borders, coast } = borderNetwork(map);
    const land = new Set(map.edges.filter(e => !e.sea).map(e => [e.from, e.to].sort().join('|')));
    const any = new Set(map.edges.map(e => [e.from, e.to].sort().join('|')));
    const landWithoutBorder = [...land].filter(key => !(shared.get(key) > 0)).sort();
    assert.deepEqual(landWithoutBorder, KNOWN_LAND_LINKS_WITHOUT_BORDER[name]);
    // Provinces that share a visible border must have some connection (land or authored sea link).
    const touchingUnlinked = [...shared].filter(([key, length]) => length > .5 && !any.has(key)).map(([key]) => key);
    assert.deepEqual(touchingUnlinked, []);
    // neighbors[] mirrors edges[] in both directions.
    const neighbors = new Map(map.provinces.map(p => [p.id, new Set(p.neighbors)]));
    for (const e of map.edges) assert.ok(neighbors.get(e.from)?.has(e.to) && neighbors.get(e.to)?.has(e.from), `${e.from}|${e.to}`);
    for (const p of map.provinces) for (const n of p.neighbors) assert.ok(any.has([p.id, n].sort().join('|')), `${p.id}->${n}`);
    // Border network is drawable: every shared pair has a path and every province has an outline.
    assert.equal(borders.length, [...shared.keys()].length);
    for (const p of provinces) assert.ok(coast.has(p.id) || borders.some(b => b.a === p.id || b.b === p.id), p.id);
  });
}
