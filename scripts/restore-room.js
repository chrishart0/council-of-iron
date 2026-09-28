/** One-off, operator-run: move a room that is still in play from the board it was created on to the
 * current map, in a NEW COPY of the database. It never writes the source database and never touches the
 * live service; deploying the copy is a separate, deliberate operator step (docs/OPERATIONS.md).
 *
 *   node scripts/restore-room.js --db data/council.db --out /tmp/restored.db --room 877de196 \
 *     [--from-map tests/fixtures/handplay-map.json] [--verify]
 *
 * Only a board change is migrated: same province and country IDs, identical rules. The room keeps its
 * ownership, troops, armies, battles, wars, alliances, messages and clock. What changes:
 *   - `scenario`, `positions` and both travel tables are rebuilt from the current map exactly as
 *     createGame builds them, so every new march uses the current borders;
 *   - armies already on the road finish their current leg as committed (arrival tick unchanged), even
 *     where the two provinces no longer border each other; a column whose LATER leg uses a vanished
 *     border is rerouted from the end of its current leg by the engine's own friendly-path rule, or stops
 *     there when no friendly route exists;
 *   - the private opening checkpoint (`reviewOrigin`) is removed: the history cannot be replayed on one
 *     board, so the finished match publishes its final scores without a replay (fail closed);
 *   - its activity record is refreshed so the restored room counts as live again.
 * Refuses (nothing written) on anything else: a different province set, other rules, a pending order on
 * a vanished border, or a failed forward simulation. --verify then serves a scratch copy of the output on
 * a random local port and checks list/observe/plan/act and that the match can run to its end.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RULES, createGame, observe, tick } from '../src/engine.js';
import { friendlyPath } from '../public/movement.js';
import { MAP, loadable, makeServer } from '../src/server.js';
import { Store } from '../src/store.js';

const args = process.argv.slice(2), flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const db = option('--db'), out = option('--out'), roomId = option('--room');
const fromMapPath = option('--from-map', new URL('../tests/fixtures/handplay-map.json', import.meta.url).pathname);
if (!db || !out || !roomId) { console.error('Usage: node scripts/restore-room.js --db SRC.db --out NEW.db --room ID [--from-map OLD.json] [--verify]'); process.exit(2); }
const fail = message => { console.error(`restore-room: REFUSED: ${message}`); process.exit(1); };
if (resolve(db) === resolve(out)) fail('--out must be a new file, not the source database');
if (existsSync(out)) fail(`${out} already exists`);
const oldMap = JSON.parse(readFileSync(fromMapPath, 'utf8')), newMap = MAP;

/** Pure: returns { g, notes } for the migrated room, or throws with the reason. `g` is not mutated. */
function migrate(source, from, to) {
  const g = structuredClone(source), notes = [];
  assert.equal(g.scenario, from.id, `the room is on ${g.scenario}, not ${from.id}`);
  assert.ok(['running', 'lobby'].includes(g.status), `the room is ${g.status}; only unfinished rooms are restored`);
  assert.notEqual(from.id, to.id, 'the room is already on the current map');
  const ids = m => m.provinces.map(p => p.id).sort().join(), countries = m => m.countries.map(c => c.id).sort().join();
  assert.equal(ids(to), ids(from), 'the province IDs differ between the two maps');
  assert.equal(countries(to), countries(from), 'the country IDs differ between the two maps');
  for (const key of Object.keys(RULES)) assert.deepEqual(g.rules[key], RULES[key], `rule ${key} differs from the current rules`);
  assert.equal(Object.keys(g.rules).filter(k => k !== 'revealAllianceChatAfterMatch').length, Object.keys(RULES).length, 'the room has extra rule fields');
  // Prove --from-map is the board the room was created on (same geometry and travel tables).
  const before = createGame({ id: 'check', name: 'check', hostId: 'check' }, from);
  for (const key of ['positions', 'travelTimes', 'internalTravelTimes'])
    assert.deepEqual(g[key], before[key], `--from-map is not the board this room was created on (${key} differ)`);

  const board = createGame({ id: 'board', name: 'board', hostId: 'board' }, to);
  Object.assign(g, { scenario: to.id, positions: board.positions, travelTimes: board.travelTimes, internalTravelTimes: board.internalTravelTimes });
  const border = (a, b) => Boolean(g.travelTimes[a]?.[b]);
  for (const o of g.orders) {
    const legs = o.path ? [o.from, ...o.path] : o.from && o.to ? [o.from, o.to] : [];
    for (let i = 1; i < legs.length; i++) assert.ok(border(legs[i - 1], legs[i]), `pending order ${o.id} uses a vanished border ${legs[i - 1]}-${legs[i]}`);
  }
  for (const a of g.armies) {
    if (!border(a.from, a.to)) notes.push(`${a.id} (${a.country}, ${a.amount}) finishes its current leg ${a.from}->${a.to} at tick ${a.arrivesAt} as committed; the two no longer border each other`);
    if (!a.path || a.returning || a.pathIndex >= a.path.length - 1) continue;
    const rest = a.path.slice(a.pathIndex);
    if (rest.every((id, i) => i === 0 || border(rest[i - 1], id))) continue;
    const goal = a.path.at(-1), route = friendlyPath(g, a.country, a.to, goal);
    const was = a.path.join('>');
    a.path = [...a.path.slice(0, a.pathIndex + 1), ...(route ? route.path : [])];
    notes.push(`${a.id} (${a.country}, ${a.amount}) column ${was} ${route ? `rerouted after ${a.to}: ${a.path.join('>')}` : `has no friendly route on the new board and stops at ${a.to}`}`);
  }
  delete g.reviewOrigin;
  notes.push('reviewOrigin removed: the finished match will publish final scores without a replay');
  assert.ok(loadable(g, to), 'the migrated room is still not loadable');
  return { g, notes };
}
/** Run a clone forward until it ends (bounded) and check the numbers stay sane. */
function simulate(g, ticks) {
  const s = structuredClone(g);
  for (let i = 0; i < ticks && s.status === 'running'; i++) {
    tick(s);
    for (const a of s.armies) assert.ok(Number.isSafeInteger(a.arrivesAt) && Number.isSafeInteger(a.amount) && s.travelTimes[a.from] && s.positions[a.to], `army ${a.id} broke at tick ${s.tick}`);
    for (const p of s.provinces) assert.ok(Number.isSafeInteger(p.troops) && p.troops >= 0, `province ${p.id} broke at tick ${s.tick}`);
  }
  for (const p of s.players) observe(s, p.id);
  return s;
}

// 1. Consistent copy of the source (read-only handle), then work only on the copy.
new DatabaseSync(db, { readOnly: true }).exec(`VACUUM INTO '${resolve(out).replaceAll("'", "''")}'`);
const store = new Store(out), source = store.load().find(g => g.id === roomId);
if (!source) { store.close(); rmSync(out, { force: true }); fail(`room ${roomId} is not in ${db}`); }
let result;
try { result = migrate(source, oldMap, newMap); simulate(result.g, 400); }
catch (error) { store.close(); rmSync(out, { force: true }); fail(error.message); }
const { g, notes } = result;
store.save(g); store.touch(g.id, Date.now()); store.close();
console.log(`restore-room: ${g.id} ${JSON.stringify(g.name)} tick ${g.tick}: ${oldMap.id} -> ${newMap.id}, written to ${out} only`);
for (const note of notes) console.log(`  - ${note}`);

if (flag('--verify')) {
  // A scratch copy of the output, so verification actions never reach the file an operator would deploy.
  const dir = mkdtempSync(pathJoin(tmpdir(), 'council-restore-')), scratch = pathJoin(dir, 'verify.db');
  copyFileSync(out, scratch);
  const app = makeServer({ dbPath: scratch, automatic: false, allowDropRunning: false });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, method = 'GET', data, token) => {
    const res = await fetch(url + path, { method, body: data && JSON.stringify(data),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) } });
    return { status: res.status, data: await res.json() };
  };
  try {
    const listed = (await call('/api/games')).data.games.find(x => x.id === roomId);
    assert.equal(listed?.status, 'running', 'the room is not listed as running');
    const seat = g.players.find(p => p.kind === 'human') || g.players[0];
    const token = app.store.credential(seat.profileId, roomId); // scratch copy only
    const view = await call(`/api/games/${roomId}`, 'GET', undefined, token);
    assert.equal(view.status, 200); assert.equal(view.data.scenario, newMap.id); assert.equal(view.data.tick, g.tick);
    assert.equal((await call(`/api/games/${roomId}/map`)).data.id, newMap.id);
    const owned = view.data.provinces.filter(p => p.owner === seat.id).sort((a, b) => b.troops - a.troops);
    const from = owned.find(p => p.troops > 2 && newMap.provinces.find(x => x.id === p.id).neighbors.some(n => owned.some(o => o.id === n)));
    const to = newMap.provinces.find(x => x.id === from.id).neighbors.find(n => owned.some(o => o.id === n));
    const plan = await call(`/api/games/${roomId}/plan`, 'POST', { to, from: from.id, amount: 1 }, token);
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    const acted = await call(`/api/games/${roomId}/actions`, 'POST', { opId: 'restore-verify-1', action: { type: 'march', to, from: from.id, amount: 1 } }, token);
    assert.equal(acted.status, 200, JSON.stringify(acted.data));
    const room = app.games.get(roomId);
    app.step(room, g.rules.duration - g.tick + 1);
    assert.equal(room.status, 'finished', 'the restored match did not reach its end');
    const review = await call(`/api/games/${roomId}/review`);
    assert.equal(review.status, 200); assert.equal(review.data.historyAvailable, false);
    console.log(`restore-room: verified on ${url} (scratch copy): listed running; ${seat.id} observes tick ${g.tick} on ${newMap.id};` +
      ` plan+march ${from.id}->${to} accepted; ran to the end (tick ${room.tick}, ${room.outcome.draw ? 'draw' : `winner ${room.outcome.winningSide}`}); review is score-only`);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
