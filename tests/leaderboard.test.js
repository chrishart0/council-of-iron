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
  start(g); act(g, map, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 5 }, 'lb-1'); tick(g); tick(g);
  const spectator = observe(g, null), player = observe(g, 'usa');
  assert.ok(spectator.armies.some(a => a.country === 'usa'), 'moving armies are public');
  const a = leaderboard(spectator), b = leaderboard(player, { you: 'usa' });
  // Only the viewer-relative fields differ; totals, ranks and wars are identical.
  assert.deepEqual(a.rows.map(({ you, relation, ...r }) => r), b.rows.map(({ you, relation, ...r }) => r));
  const usa = a.rows.find(r => r.id === 'usa');
  assert.equal(usa.troops, g.provinces.filter(p => p.owner === 'usa').reduce((n, p) => n + p.troops, 0) + 5);
});
test('rows carry public relations from relations.js; wars group into side-vs-side fronts', async () => {
  const { relationsOf } = await import('../public/relations.js');
  const { warsOf } = await import('../public/leaderboard.js');
  const sided = { ...view, rules: { warRequired: true }, wars: ['britain:germany', 'france:germany', 'germany:usa'],
    players: view.players.map(p => ({ ...p, side: view.sides.find(s => s.members.includes(p.id)).id })) };
  assert.deepEqual(relationsOf(sided, 'britain'), { allies: ['usa'], enemies: ['germany'], neutral: ['france', 'japan'] });
  // Fronts group country pairs by side: the coalition fights Germany once, France fights it separately.
  const fronts = warsOf(sided);
  assert.deepEqual(fronts.map(f => [f.sides.map(s => [s.side, s.name, s.countries]), f.pairs]), [
    [[['coalition-1', '<b>Accord</b>', ['britain', 'usa']], ['solo:germany:0', null, ['germany']]], [['britain', 'germany'], ['germany', 'usa']]],
    [[['solo:france:0', null, ['france']], ['solo:germany:0', null, ['germany']]], [['france', 'germany']]]]);
  assert.deepEqual(fronts.flatMap(f => f.pairs.map(p => p.join(':'))).sort(), [...sided.wars].sort());
  const rows = leaderboard(sided, { you: 'britain' }).rows;
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, [r.relation, r.atWarWith]])), {
    germany: ['enemy', ['britain', 'france', 'usa']], usa: ['ally', ['germany']], france: ['neutral', ['germany']],
    britain: ['you', ['germany']], japan: ['neutral', []] });
  assert.deepEqual(leaderboard(sided, { mode: 'alliances', you: 'france' }).rows.find(r => r.id === 'coalition-1').atWarWith, ['germany']);
  assert.equal(leaderboard(sided).rows[0].relation, undefined, 'no viewer, no relation');
});
test('teams: one total row per alliance with nested members; totals include every army; shares sum to 100%', async () => {
  const sided = { ...view, rules: { warRequired: true }, wars: ['britain:germany'], proposals: [],
    players: view.players.map(p => ({ ...p, side: view.sides.find(s => s.members.includes(p.id)).id })) };
  const b = leaderboard(sided, { mode: 'teams', you: 'britain' });
  assert.deepEqual(b.rows.map(r => [r.rank, r.id, r.kind, r.provinces, r.troops]),
    [[1, 'coalition-1', 'alliance', 3, 47], [2, 'germany', 'country', 2, 31], [3, 'france', 'country', 2, 4], [4, 'japan', 'country', 0, 0]]);
  const accord = b.rows[0];
  assert.equal(accord.name, '<b>Accord</b>'); assert.equal(accord.you, true); assert.equal(accord.relation, 'you');
  // Members sorted by strength; totals are the member sums, including engaged and returning armies.
  assert.deepEqual(accord.members.map(m => [m.id, m.troops, m.provinces, m.relation]), [['britain', 30, 1, 'you'], ['usa', 17, 2, 'ally']]);
  assert.equal(accord.troops, accord.members.reduce((n, m) => n + m.troops, 0));
  assert.equal(accord.provinces, accord.members.reduce((n, m) => n + m.provinces, 0));
  assert.equal(accord.members.find(m => m.id === 'usa').troops, 5 + 4 + 6 + 2, 'garrisons + engaged + returning armies');
  assert.ok(Math.abs(accord.members.reduce((n, m) => n + m.shareOfAlliance, 0) - 1) < 1e-9);
  assert.equal(accord.members[0].shareOfAlliance, 30 / 47);
  assert.deepEqual(accord.atWarWith, ['germany']); assert.equal(b.rows[1].relation, 'enemy');
  assert.equal(b.rows[1].members, undefined, 'independents are single rows');
  // A coalition inside its activation delay is grouped as forming, with the same totals rule.
  const forming = { ...sided, proposals: [{ id: 'p7', status: 'pending', name: 'New Pact', roster: ['france', 'germany'], activateAt: 90, coalition: null }] };
  const f = leaderboard(forming, { mode: 'teams' }).rows.find(r => r.id === 'p7');
  assert.equal(f.forming, true); assert.equal(f.troops, 31 + 4); assert.deepEqual(f.countries, ['germany', 'france']);
  assert.ok(!leaderboard(forming, { mode: 'teams' }).rows.some(r => r.id === 'france' || r.id === 'germany'), 'forming members are nested, not repeated');
  assert.throws(() => leaderboard(view, { mode: 'nope' }), /teams, players or alliances/);
});
