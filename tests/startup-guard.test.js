import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { ABANDONED_AFTER_MS, MAP, StartupRefused, abandoned, loadable, makeServer, occupied, startupPlan } from '../src/server.js';
import { createGame, join, start } from '../src/engine.js';
import { Store } from '../src/store.js';

const MIN = 60 * 1000, NOW = Date.UTC(2026, 8, 28, 19, 0);
function room(id, { status = 'running', kinds = ['human', 'agent'], scenario = MAP.id } = {}) {
  const g = createGame({ id, name: `Room ${id}`, hostId: 'host' }, MAP);
  kinds.forEach((kind, i) => join(g, MAP, { profileId: `p${i}`, name: `P${i}`, country: MAP.countries[i].id, kind }));
  if (status !== 'lobby') start(g);
  if (status === 'finished') g.status = 'finished';
  g.scenario = scenario;
  return g;
}
const ids = plan => Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.map(g => g.id)]));

test('occupied and abandoned: live rooms, downtime does not count, unknown activity is live', () => {
  assert.equal(occupied(room('a')), true);
  assert.equal(occupied(room('b', { status: 'lobby', kinds: ['human'] })), true);
  assert.equal(occupied(room('c', { status: 'lobby', kinds: ['agent', 'bot'] })), false);
  assert.equal(occupied(room('d', { status: 'lobby', kinds: [] })), false);
  assert.equal(occupied(room('e', { status: 'finished' })), false);
  assert.equal(abandoned(undefined), false, 'no record: never abandoned');
  assert.equal(abandoned({ activeAt: NOW, seenAt: NOW + ABANDONED_AFTER_MS }), false, 'exactly 30 minutes is still live');
  assert.equal(abandoned({ activeAt: NOW, seenAt: NOW + ABANDONED_AFTER_MS + 1 }), true);
  assert.equal(abandoned({ activeAt: NOW, seenAt: NOW + MIN }, NOW + 5 * MIN), false, 'runtime check uses now');
  assert.equal(abandoned({ activeAt: NOW }, NOW + 31 * MIN), true);
  // Server stopped one minute after the last action and restarted hours later: still live.
  assert.equal(abandoned({ activeAt: NOW, seenAt: NOW + MIN }), false);
});

test('startupPlan: loads current rooms, skips finished/abandoned/dropped old rooms, blocks live old rooms', () => {
  const old = 'imperial-1910-v0';
  const stored = [
    room('current'), room('current-lobby', { status: 'lobby', kinds: ['human'] }),
    room('old-running', { scenario: old }),
    room('old-lobby-human', { status: 'lobby', kinds: ['human'], scenario: old }),
    room('old-lobby-agents', { status: 'lobby', kinds: ['agent'], scenario: old }),
    room('old-finished', { status: 'finished', scenario: old }),
    room('old-idle', { scenario: old }), room('old-dropped', { scenario: old }), room('old-downtime', { scenario: old }),
    { id: 'garbage', status: 'running' },
  ];
  const activity = new Map([
    ['old-idle', { activeAt: NOW, seenAt: NOW + 31 * MIN }],
    ['old-dropped', { activeAt: NOW, seenAt: NOW, droppedAt: NOW + MIN }],
    ['old-downtime', { activeAt: NOW, seenAt: NOW + 2 * MIN }],
  ]);
  assert.deepEqual(ids(startupPlan(stored, activity)), {
    load: ['current', 'current-lobby'],
    skip: ['old-lobby-agents', 'old-finished', 'old-idle', 'old-dropped'],
    block: ['old-running', 'old-lobby-human', 'old-downtime', 'garbage'],
  });
  assert.equal(loadable(stored[2]), false);
  // Changed rule set is also "another version".
  const rules = room('rules'); delete rules.rules.recruit;
  assert.deepEqual(ids(startupPlan([rules])), { load: [], skip: [], block: ['rules'] });
});

test('server startup refuses a live unloadable room, keeps its snapshot, and drops it only when allowed', async t => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'council-guard-')), dbPath = pathJoin(dir, 'state.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dbPath);
  store.save(room('live-old', { scenario: 'imperial-1910-v0' }));
  store.save(room('done-old', { status: 'finished', scenario: 'imperial-1910-v0' }));
  store.save(room('live-now'));
  store.close();
  const errors = [], log = console.error; console.error = (...a) => errors.push(a.join(' '));
  t.after(() => { console.error = log; });

  assert.throws(() => makeServer({ dbPath, automatic: false, allowDropRunning: false }),
    e => e instanceof StartupRefused && /REFUSING TO START/.test(e.message) && /live-old "Room live-old" \(running, tick 0/.test(e.message)
      && !/done-old/.test(e.message) && /COUNCIL_ALLOW_DROP_RUNNING=1/.test(e.message));

  let app = makeServer({ dbPath, automatic: false, allowDropRunning: true });
  assert.deepEqual([...app.games.keys()], ['live-now']);
  assert.match(errors.join('\n'), /WARNING: COUNCIL_ALLOW_DROP_RUNNING=1: dropping 1 room\(s\)[\s\S]*live-old/);
  await app.close();

  // Dropped once, it no longer blocks; the snapshot is still in the database.
  app = makeServer({ dbPath, automatic: false, allowDropRunning: false });
  assert.deepEqual([...app.games.keys()], ['live-now']);
  assert.ok(app.store.load().some(g => g.id === 'live-old'));
  assert.ok(app.store.activity().get('live-old').droppedAt > 0);
  await app.close();
});

test('seated requests record activity; /api/games reports abandoned rooms', async t => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'council-guard-')), dbPath = pathJoin(dir, 'state.db');
  const app = makeServer({ dbPath, automatic: false });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, method = 'GET', data, token) => (await fetch(url + path, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined })).json();
  const host = await call('/api/players', 'POST', { name: 'Host' });
  const before = Date.now();
  const { id } = await call('/api/games', 'POST', { name: 'Guarded' }, host.token);
  await call(`/api/games/${id}/join`, 'POST', { country: MAP.countries[0].id }, host.token);
  const a = app.store.activity().get(id);
  assert.ok(a.activeAt >= before && a.seenAt === a.activeAt && a.droppedAt === null);
  assert.equal((await call('/api/games')).games.find(g => g.id === id).abandoned, false);
  app.store.touch(id, before - 31 * MIN);
  const restarted = makeServer({ dbPath, automatic: false });
  await new Promise(r => restarted.server.listen(0, '127.0.0.1', r));
  t.after(() => restarted.close());
  const listed = await (await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/games`)).json();
  assert.equal(listed.games.find(g => g.id === id).abandoned, true);
});
