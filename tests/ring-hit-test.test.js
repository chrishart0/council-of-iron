import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insideRings, provinceRings, ringHitTest } from '../public/map-geometry.js';

test('bounded hit tests preserve holes, islands, overlapping rings and boundary points', () => {
  const rings = provinceRings('M0,0L12,0L12,12L0,12ZM3,3L9,3L9,9L3,9ZM20,0L24,0L24,4L20,4Z');
  const contains = ringHitTest(rings);
  assert.equal(contains([1, 1]), true);
  assert.equal(contains([6, 6]), false);
  assert.equal(contains([22, 2]), true);
  assert.equal(contains([16, 2]), false);
  for (let x = -1; x <= 25; x += .5) for (let y = -1; y <= 13; y += .5) {
    assert.equal(contains([x, y]), insideRings([x, y], rings), `point ${x},${y}`);
  }
  const overlapping = [...rings, rings[0]];
  const overlapHit = ringHitTest(overlapping);
  for (const point of [[1, 1], [6, 6], [22, 2], [12, 12]]) assert.equal(overlapHit(point), insideRings(point, overlapping));
  assert.equal(ringHitTest([])([0, 0]), false);
});

test('bounded hit tests match every current map shape at sampled points and exact coast vertices', () => {
  const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
  for (const shape of [...map.provinces, ...map.terrain]) {
    const rings = provinceRings(shape.path), contains = ringHitTest(rings);
    const points = rings.flat();
    for (const point of points) assert.equal(contains(point), insideRings(point, rings), `${shape.id} vertex ${point}`);
    for (let x = 0; x <= 1280; x += 32) for (let y = 0; y <= 680; y += 34) {
      assert.equal(contains([x, y]), insideRings([x, y], rings), `${shape.id} point ${x},${y}`);
    }
  }
});
