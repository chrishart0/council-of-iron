import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CURRENT, MAPS, mapFor } from '../src/maps.js';
import { createGame, join, start, act, tick, observe } from '../src/engine.js';
import { buildReview } from '../src/review.js';
import { replayReader } from '../public/replay-model.js';
import { makeServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { replay } from '../scripts/replay-handplay.js';

const v3 = MAPS.get('imperial-1910-v3'), v4 = MAPS.get('imperial-1910-v4');
const root = new URL('../', import.meta.url);

test('v3 is frozen byte-for-byte; v4 is the published current map and matches its builder', () => {
  const bytes = readFileSync(new URL('public/maps/imperial-1910-v3.json', root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5e71abad601fbb2411415eb3371eef02c1814cdc93f5467bf3befb06201ed8f1');
  assert.equal(CURRENT.id, 'imperial-1910-v4'); assert.equal(CURRENT, v4);
  execFileSync(process.execPath, ['scripts/build_imperial_v4.js', '--check'], { cwd: root });
});

test('v4 is v3 plus one neutral Hawaii with three sea links; nothing else changes for play', () => {
  assert.equal(v4.provinces.length, v3.provinces.length + 1);
  const hawaii = v4.provinces.find(p => p.id === 'hawaii');
  assert.deepEqual(hawaii.neighbors, ['philippines', 'south-japan', 'west-us']);
  assert.deepEqual(v4.countries, v3.countries); // nobody starts in Hawaii; garrisons/industry unchanged
  assert.ok(!v4.countries.some(c => c.start.includes('hawaii')));
  const key = e => `${e.from}|${e.to}|${e.sea}`;
  assert.deepEqual(v4.edges.filter(e => e.from !== 'hawaii' && e.to !== 'hawaii').map(key), v3.edges.map(key)); // direct Pacific links kept
  assert.deepEqual(v4.edges.filter(e => e.from === 'hawaii' || e.to === 'hawaii').map(e => e.sea), [true, true, true]);
  for (const p of v3.provinces) {
    const q = v4.provinces.find(q => q.id === p.id);
    assert.deepEqual([q.name, q.x, q.y], [p.name, p.x, p.y]);
    assert.deepEqual(q.neighbors.filter(n => n !== 'hawaii'), p.neighbors);
    if (p.id !== 'west-us') assert.equal(q.path, p.path); // west-us only loses the Hawaiian islands it drew in v3
  }
  const g = createGame({ id: 'v4', name: 'v4', hostId: 'usa' }, v4);
  assert.deepEqual(g.provinces.find(p => p.id === 'hawaii'), { id: 'hawaii', owner: null, troops: 2, nextRecruit: null, route: null, development: 1, developing: null });
  // The Pacific crossing times this produces (game seconds at the current rules).
  assert.deepEqual([g.travelTimes['west-us'].hawaii, g.travelTimes.hawaii['south-japan'], g.travelTimes.hawaii.philippines,
    g.travelTimes['west-us']['south-japan'], g.travelTimes['west-us'].philippines], [136, 219, 264, 281, 345]);
});

test('a v3 room keeps resolving against v3: observe, act, tick and review without Hawaii', () => {
  const { game } = replay();
  assert.equal(game.scenario, 'imperial-1910-v3'); assert.equal(mapFor(game), v3);
  assert.ok(!game.provinces.some(p => p.id === 'hawaii') && !JSON.stringify(game.travelTimes).includes('hawaii'));
  for (const p of [null, ...game.players.map(p => p.id)]) observe(game, p, 0, 10000);
  const review = buildReview(structuredClone(game), mapFor(game));
  assert.equal(review.replay.map.id, 'imperial-1910-v3');
  const read = replayReader(review.replay); read(0); read(game.tick);
  // A running v3 room still accepts orders and advances.
  const live = createGame({ id: 'old', name: 'old', hostId: 'usa' }, v3);
  for (const c of ['usa', 'japan']) join(live, v3, { profileId: c, name: c, country: c });
  start(live);
  assert.ok(act(live, mapFor(live), 'usa', { type: 'move', from: 'west-us', to: 'mexico', amount: 3 }, 'm').ok);
  assert.throws(() => act(live, mapFor(live), 'usa', { type: 'move', from: 'west-us', to: 'hawaii', amount: 3 }, 'h'), /adjacent|connect|Unknown|province/i);
  for (let i = 0; i < 40; i++) tick(live);
});

test('server: stored v3 rooms load and serve the v3 map; new rooms and /map.json use v4', async t => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'map-versions-')), dbPath = pathJoin(dir, 'rooms.db');
  const old = createGame({ id: 'old-v3', name: 'Old room', hostId: 'usa' }, v3);
  for (const c of ['usa', 'japan']) join(old, v3, { profileId: c, name: c, country: c });
  start(old); for (let i = 0; i < 25; i++) tick(old);
  const store = new Store(dbPath); store.save(old); store.close();
  const app = makeServer({ dbPath, automatic: false });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = async path => (await fetch(base + path)).json();
  assert.ok(app.games.has('old-v3'));
  const oldMap = await get('/api/games/old-v3/map');
  assert.equal(oldMap.id, 'imperial-1910-v3'); assert.equal(oldMap.provinces.length, 79);
  const view = await get('/api/games/old-v3');
  assert.equal(view.scenario, 'imperial-1910-v3'); assert.ok(!view.provinces.some(p => p.id === 'hawaii'));
  assert.equal((await get('/map.json')).id, 'imperial-1910-v4');
  const profile = app.store.register('Host'), created = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.token}` }, body: JSON.stringify({ name: 'New room' }) });
  const { id } = await created.json();
  assert.equal((await get(`/api/games/${id}/map`)).id, 'imperial-1910-v4');
  assert.ok((await get(`/api/games/${id}`)).provinces.some(p => p.id === 'hawaii'));
  app.step(old, 10); // the automatic loop's step function runs an old room without throwing
});
