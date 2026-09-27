import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leaderboard } from '../public/leaderboard.js';
import { createGame, join, start, act, tick, observe } from '../src/engine.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));

const P = (id, owner, troops) => ({ id, owner, troops });
const view = {
  provinces: [P('a', 'usa', 5), P('b', 'usa', 4), P('c', 'britain', 10), P('d', 'france', 3), P('e', 'france', 1), P('f', null, 2), P('g', 'germany', 30), P('h', 'germany', 1)],
  armies: [{ country: 'britain', amount: 20 }, { country: 'usa', amount: 6, engaged: true }, { country: 'usa', amount: 2, returning: true }],
  players: [{ id: 'usa', eliminatedAt: null }, { id: 'britain', eliminatedAt: null }, { id: 'france', eliminatedAt: null },
    { id: 'germany', eliminatedAt: null }, { id: 'japan', eliminatedAt: 40 }],
  sides: [{ id: 'coalition-1', name: '<b>Accord</b>', members: ['usa', 'britain'] }, { id: 'solo:france:0', name: 'france', members: ['france'] },
    { id: 'solo:germany:0', name: 'germany', members: ['germany'] }, { id: 'solo:japan:0', name: 'japan', members: ['japan'] }],
};
test('players rank by land, then troops including every army on the map, then ID', () => {
  const b = leaderboard(view);
  assert.deepEqual(b.rows.map(r => [r.rank, r.id, r.provinces, r.troops]),
    [[1, 'germany', 2, 31], [2, 'usa', 2, 17], [3, 'france', 2, 4], [4, 'britain', 1, 30], [5, 'japan', 0, 0]]);
  assert.equal(b.rows[1].troops, 5 + 4 + 6 + 2, 'garrisons + engaged + returning armies');
  assert.equal(b.rows[0].share, 2 / 8); assert.equal(b.rows[4].eliminated, true);
  const tie = leaderboard({ ...view, armies: [], provinces: [P('a', 'usa', 3), P('b', 'britain', 3)] });
  assert.deepEqual(tie.rows.slice(0, 2).map(r => r.id), ['britain', 'usa']);
});
test('alliances sum their members; independents rank as themselves; own row always shown with its real rank', () => {
  const b = leaderboard(view, { mode: 'alliances' });
  assert.deepEqual(b.rows.map(r => [r.rank, r.id, r.kind, r.provinces, r.troops]),
    [[1, 'coalition-1', 'alliance', 3, 47], [2, 'germany', 'country', 2, 31], [3, 'france', 'country', 2, 4], [4, 'japan', 'country', 0, 0]]);
  assert.equal(b.rows[0].name, '<b>Accord</b>'); assert.deepEqual(b.rows[0].countries, ['usa', 'britain']);
  const mine = leaderboard(view, { you: 'britain', limit: 2 });
  assert.deepEqual(mine.rows.map(r => [r.rank, r.id, Boolean(r.you)]), [[1, 'germany', false], [2, 'usa', false], [4, 'britain', true]]);
  assert.equal(leaderboard(view, { mode: 'alliances', you: 'britain', limit: 1 }).rows[0].you, true);
  assert.throws(() => leaderboard(view, { mode: 'kills' }), /mode/);
});
test('a live engine observation gives spectators and players the same totals', () => {
  const g = createGame({ id: 'lb', name: 'Board', hostId: 'usa' }, map);
  for (const id of ['usa', 'britain', 'france']) join(g, map, { profileId: id, name: id, country: id });
  start(g); act(g, map, 'usa', { type: 'move', from: 'west-us', to: 'mexico', amount: 5 }, 'lb-1'); tick(g); tick(g);
  const spectator = observe(g, null), player = observe(g, 'usa');
  assert.ok(spectator.armies.some(a => a.country === 'usa'), 'moving armies are public');
  const a = leaderboard(spectator), b = leaderboard(player, { you: 'usa' });
  assert.deepEqual(a.rows.map(({ you, ...r }) => r), b.rows.map(({ you, ...r }) => r));
  const usa = a.rows.find(r => r.id === 'usa');
  assert.equal(usa.troops, g.provinces.filter(p => p.owner === 'usa').reduce((n, p) => n + p.troops, 0) + 5);
});
