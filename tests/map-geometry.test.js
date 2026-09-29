import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { borderNetwork, insideRings, provinceRings, segmentDistance } from '../public/map-geometry.js';

const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url)));
const signedArea = ring => ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

for (const name of ['imperial-map.json']) {
  const map = load(name);
  const provinces = map.provinces.map(p => ({ ...p, rings: provinceRings(p.path) }));
  const boundaryDistance = (point, other) => Math.min(...other.rings.flatMap(ring => ring.map((a, i) => segmentDistance(point, a, ring[(i + 1) % ring.length]))));
  // The same distance, exact up to NEAR (farther segments report Infinity): a 1-unit grid of each province's segments.
  const NEAR = .1, grids = new Map(provinces.map(p => {
    const grid = new Map();
    for (const ring of p.rings) ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      for (let x = Math.floor(Math.min(a[0], b[0]) - NEAR); x <= Math.floor(Math.max(a[0], b[0]) + NEAR); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) - NEAR); y <= Math.floor(Math.max(a[1], b[1]) + NEAR); y++) {
          const key = `${x},${y}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([a, b]);
        }
    });
    return [p.id, grid];
  }));
  const nearDistance = (point, other) => Math.min(Infinity, ...(grids.get(other.id).get(`${Math.floor(point[0])},${Math.floor(point[1])}`) || []).map(([a, b]) => segmentDistance(point, a, b)));
  const boxes = new Map(provinces.map(p => {
    const xs = p.rings.flat().map(v => v[0]), ys = p.rings.flat().map(v => v[1]);
    return [p.id, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]];
  }));
  const inBox = ([x, y], p) => { const q = boxes.get(p.id); return q[0] <= x && x <= q[2] && q[1] <= y && y <= q[3]; };
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
        const d = nearDistance(v, b);
        // A vertex either lies on the neighbour's border (split-province junctions are rounded to
        // 0.01 units, invisible at maximum zoom) or is clearly separate from it (narrow straits).
        if (d > .01 && d < .09) drift.push(`${a.id}/${b.id} ${d.toFixed(4)} @${v}`);
        if (d > .05 && inBox(v, b) && insideRings(v, b.rings)) overlaps.push(`${a.id} vertex inside ${b.id} @${v}`);
        if (nearDistance(mid, b) > .05 && inBox(mid, b) && insideRings(mid, b.rings)) overlaps.push(`${a.id} edge inside ${b.id} @${mid}`);
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

  test(`${name}: a shared border is a land link or a declared barrier; every other link is a declared sea link`, () => {
    const { shared, borders, coast } = borderNetwork(map);
    const key = e => [e.from, e.to].sort().join('|');
    const land = map.edges.filter(e => !e.sea).map(key), sea = map.edges.filter(e => e.sea), any = new Set(map.edges.map(key));
    assert.equal(new Set(map.edges.map(key)).size, map.edges.length, 'one edge per pair');
    // No exceptions list: a land link needs a readable shared border; a shared border is a land link, or it is
    // a declared barrier (impassable terrain, drawn on the map), never both.
    const barriers = (map.barriers || []).map(b => [b.a, b.b].sort().join('|'));
    assert.equal(new Set(barriers).size, barriers.length, 'one barrier per pair');
    assert.deepEqual(land.filter(k => !(shared.get(k) >= 1)).sort(), []);
    assert.deepEqual(barriers.filter(k => !(shared.get(k) >= 1) || any.has(k)), [], 'a barrier is a shared border without a link');
    assert.deepEqual([...shared].filter(([k, length]) => length > .05 && !land.includes(k) && !barriers.includes(k)).map(([k]) => k).sort(), []);
    for (const b of map.barriers || []) {
      assert.ok(['mountains', 'desert'].includes(b.terrain), b.name);
      assert.ok(b.name.length > 2 && b.around.length > 10, `${b.name} says how to go around`);
    }
    // A sea link joins provinces that do not touch, and says which strait or lane it is.
    for (const e of sea) {
      assert.ok(!(shared.get(key(e)) > 0), `${key(e)} touches but is declared a sea link`);
      assert.ok(typeof e.strait === 'string' && e.strait.length > 2, `${key(e)} names its strait`);
    }
    // neighbors[] mirrors edges[] in both directions.
    const neighbors = new Map(map.provinces.map(p => [p.id, new Set(p.neighbors)]));
    for (const e of map.edges) assert.ok(neighbors.get(e.from)?.has(e.to) && neighbors.get(e.to)?.has(e.from), key(e));
    for (const p of map.provinces) assert.equal(p.neighbors.length, map.edges.filter(e => e.from === p.id || e.to === p.id).length, p.id);
    // Border network is drawable: every shared pair has a path and every province has an outline.
    assert.equal(borders.length, [...shared.keys()].length);
    for (const p of provinces) assert.ok(coast.has(p.id) || borders.some(b => b.a === p.id || b.b === p.id), p.id);
  });

  test(`${name}: every province is reachable and every power can still reach neutral land`, () => {
    const next = new Map(map.provinces.map(p => [p.id, p.neighbors]));
    const reach = from => { const seen = new Set(from); for (const id of seen) for (const n of next.get(id)) seen.add(n); return seen; };
    assert.equal(reach([map.provinces[0].id]).size, map.provinces.length);
    const held = new Set(map.countries.flatMap(c => c.start));
    assert.equal(held.size, map.countries.flatMap(c => c.start).length, 'country starts do not overlap');
    for (const c of map.countries) {
      const frontier = new Set(c.start.flatMap(id => next.get(id)).filter(id => !c.start.includes(id)));
      assert.ok([...frontier].some(id => !held.has(id)), `${c.id} borders no neutral province`);
    }
  });

  test(`${name}: regions partition the provinces and no province is a sliver`, () => {
    const listed = map.regions.flatMap(r => r.provinces);
    assert.deepEqual([...listed].sort(), map.provinces.map(p => p.id).sort());
    for (const r of map.regions) {
      assert.ok(r.provinces.every(id => map.provinces.find(p => p.id === id).region === r.id), r.id);
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && r.x >= 0 && r.x < map.width, r.id);
    }
    // The landmass carrying each counter is big enough to see and tap (Hawaii, the smallest, is ~60 square units).
    for (const p of provinces) {
      const home = p.rings.find(ring => insideRings([p.x, p.y], [ring]));
      assert.ok(home && Math.abs(signedArea(home)) >= 55, `${p.id} home landmass ${home && Math.abs(signedArea(home))}`);
    }
  });
}

test('the published map is exactly the output of the deterministic builder', () => {
  const run = spawnSync(process.execPath, [new URL('../scripts/build-imperial-v6.js', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
