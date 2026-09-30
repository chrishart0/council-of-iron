import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { borderNetwork, insideRings, provinceRings, segmentDistance, terrainBox } from '../public/map-geometry.js';

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

  test(`${name}: a shared border between provinces is a land link; terrain is never a link; every other link is a declared sea link`, () => {
    const { shared, borders, coast } = borderNetwork(map);
    const key = e => [e.from, e.to].sort().join('|');
    const land = map.edges.filter(e => !e.sea).map(key), sea = map.edges.filter(e => e.sea);
    assert.equal(new Set(map.edges.map(key)).size, map.edges.length, 'one edge per pair');
    // Impassable terrain is unowned land drawn between provinces: not a province, never an edge end.
    const ids = new Set(map.provinces.map(p => p.id)), terrain = new Set(map.terrain.map(t => t.id));
    assert.equal(terrain.size, map.terrain.length, 'one entry per terrain id');
    assert.deepEqual([...terrain].filter(id => ids.has(id)), [], 'terrain ids are not province ids');
    for (const t of map.terrain) {
      assert.ok(['mountains', 'desert', 'ice'].includes(t.terrain), t.id);
      assert.ok(typeof t.name === 'string' && t.name.length > 2, `${t.id} has a name`);
      assert.ok(provinceRings(t.path).length > 0 && Number.isFinite(t.x) && Number.isFinite(t.y), `${t.id} has a drawable shape`);
    }
    assert.deepEqual(map.edges.filter(e => terrain.has(e.from) || terrain.has(e.to)).map(key), [], 'terrain is never linked');
    // No exceptions list: a land link needs a readable shared border, and a shared border between two provinces is
    // a land link. A shared run against terrain is never a link.
    assert.deepEqual(land.filter(k => !(shared.get(k) >= 1)).sort(), []);
    const betweenProvinces = k => k.split('|').every(id => ids.has(id));
    assert.deepEqual([...shared].filter(([k, length]) => length > .05 && betweenProvinces(k) && !land.includes(k)).map(([k]) => k).sort(), []);
    // Each wasteland separates a pair that would otherwise meet: they share no border, and each borders the terrain.
    for (const [a, b, between] of [['india', 'tibet', 'himalayas'], ['siberia', 'west-russia', 'urals'], ['italy', 'south-france', 'alps'], ['maghreb', 'sahel', 'sahara']]) {
      assert.ok(!shared.has(`${a}|${b}`) && !land.includes(`${a}|${b}`), `${a} and ${b} share no border`);
      for (const id of [a, b]) assert.ok(shared.get([id, between].sort().join('|')) >= 1, `${id} borders the ${between}`);
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

/** Pixel size of a WebP (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(bytes) {
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (chunk === 'VP8L') { const b = bytes.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}
test('every terrain texture covers exactly the box the atlas places it on (regenerate them after a terrain change)', () => {
  const PX = 8; // pixels per map unit, as scripts/map-source/terrain-textures.py paints them
  for (const t of load('imperial-map.json').terrain) {
    const [, , width, height] = terrainBox(t.path);
    assert.deepEqual(webpSize(readFileSync(new URL(`../public/terrain/${t.id}.webp`, import.meta.url))), [width * PX, height * PX], t.id);
  }
});
