import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, preview } from '../src/engine.js';
import { friendlyPath } from '../public/movement.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let next = 0;
/** USA, Britain, France, Germany; `setup` edits ownership before the start. */
function game(setup) {
  const g = createGame({ id: `long-${++next}`, name: 'Long march', hostId: 'usa' }, map);
  for (const id of ['usa', 'britain', 'france', 'germany']) join(g, map, { profileId: id, name: id, country: id });
  setup?.(g); start(g); return g;
}
const send = (g, id, action, opId = `long-op-${++next}`) => act(g, map, id, action, opId);
const advance = (g, n) => { for (let i = 0; i < n; i++) tick(g); };
const at = (g, id) => g.provinces.find(p => p.id === id);
const own = (g, id, owner, troops = 10) => Object.assign(at(g, id), { owner, troops });
const ally = (g, a, b) => { const { proposalId } = send(g, a, { type: 'propose', country: b }); send(g, b, { type: 'accept', proposalId }); advance(g, 30); };

test('a march crosses any chain of your own land by the quickest route, at internal speed', () => {
  const g = game(g => { own(g, 'mexico', 'usa', 30); own(g, 'west-canada', 'usa'); });
  const plan = preview(g, map, 'usa', { from: 'mexico', to: 'alaska', amount: 20 });
  const path = plan.sources[0].path;
  assert.equal(path.at(-1), 'alaska'); assert.ok(path.length >= 3, 'several provinces, not a neighbour');
  assert.equal(plan.sources[0].travel, path.reduce((n, id, i) => n + g.internalTravelTimes[i ? path[i - 1] : 'mexico'][id], 0), 'every leg at internal speed');
  assert.deepEqual(friendlyPath(observe(g, 'usa'), 'usa', 'mexico', 'alaska'), { path: plan.sources[0].path, travel: plan.sources[0].travel }, 'clients draw the same route');
  const sent = send(g, 'usa', { type: 'march', from: 'mexico', to: 'alaska', amount: 20 });
  assert.equal(sent.arrivesAt, plan.arrivesAt);
  advance(g, sent.arrivesAt - g.tick);
  const alaska = at(g, 'alaska').troops;
  assert.ok(g.events.some(e => e.type === 'reinforced' && e.province === 'alaska' && e.amount === 20), String(alaska));
});

test('through an ally without gifting troops; an attack goes only from a bordering province', () => {
  const g = game(g => { own(g, 'central-us', 'britain'); });
  ally(g, 'usa', 'britain');
  const through = send(g, 'usa', { type: 'march', from: 'west-us', to: 'east-us', amount: 5 });
  assert.deepEqual(through.orders[0].path, ['central-us', 'east-us']);
  Object.assign(at(g, 'caribbean'), { owner: 'france', troops: 2 });
  assert.throws(() => send(g, 'usa', { type: 'march', from: 'east-us', to: 'caribbean', amount: 5 }), /Declare war/);
  // No long strike through friendly land, even with a declaration: nothing is declared, nothing reserved.
  const before = JSON.stringify([g.wars, g.orders]);
  assert.throws(() => send(g, 'usa', { type: 'march', from: 'west-us', to: 'caribbean', amount: 5, declareWar: true }),
    /west-us does not border caribbean: an attack goes only from provinces next to the target \(a land border or a sea link\)\. March troops to a province bordering caribbean first \(yours: east-us\), then attack\./);
  assert.equal(JSON.stringify([g.wars, g.orders]), before);
  const strike = send(g, 'usa', { type: 'march', from: 'east-us', to: 'caribbean', amount: 5, declareWar: true });
  assert.deepEqual(strike.orders[0].path, ['caribbean']);
  assert.equal(strike.warDeclared, true);
  assert.deepEqual(strike.sources, [{ from: 'east-us', amount: 5, departsAt: strike.orders[0].executeAt }]);
  advance(g, strike.arrivesAt - g.tick);
  assert.ok(g.battles.some(b => b.province === 'caribbean') || at(g, 'caribbean').owner === 'usa');
});

test('attacks: a neighbour is fine; far sources are named in the error, with the provinces to stage in', () => {
  const g = game();
  const plan = preview(g, map, 'usa', { from: 'west-us', to: 'mexico', percent: 50 });
  assert.deepEqual(plan.sources[0].path, ['mexico']); assert.equal(plan.reinforcement, false);
  assert.throws(() => preview(g, map, 'usa', { from: 'east-us', to: 'mexico', amount: 3 }),
    /east-us does not border mexico.*yours: west-us, central-us/);
  assert.throws(() => send(g, 'usa', { type: 'march', to: 'hawaii', sources: [{ from: 'west-us', amount: 2 }, { from: 'east-us', amount: 2 }, { from: 'central-us', amount: 2 }] }),
    /^Error: east-us and central-us do not border hawaii.*yours: west-us, philippines/);
  assert.equal(g.orders.length, 0);
  // Nothing of yours or an ally's borders it: say so.
  assert.throws(() => preview(g, map, 'usa', { from: 'west-us', to: 'andes', amount: 3 }), /You hold no province bordering andes/);
  // Rally points still only go to your own provinces.
  assert.throws(() => send(g, 'usa', { type: 'rally', from: 'west-us', to: 'mexico' }), /own provinces/);
});

test('fromAllBordering: every province of yours next to the target with free troops, amount or percent per source', () => {
  const g = game(g => { own(g, 'central-us', 'usa', 1); own(g, 'mexico', 'usa', 21); });
  // Bordering central-america: mexico only (caribbean is neutral). Bordering caribbean: east-us only.
  const all = preview(g, map, 'usa', { to: 'caribbean', fromAllBordering: true, percent: 100 });
  assert.deepEqual(all.sources.map(s => [s.from, s.amount]), [['east-us', at(g, 'east-us').troops - 1]]);
  // Bordering hawaii: west-us only. Bordering central-us (own): west-us, mexico, east-us; central-us itself excluded.
  const home = preview(g, map, 'usa', { to: 'central-us', fromAllBordering: true, percent: 50 });
  assert.deepEqual(home.sources.map(s => s.from).sort(), ['east-us', 'mexico', 'west-us']);
  assert.equal(home.sources.find(s => s.from === 'mexico').amount, 10, 'half of each source\'s free troops');
  const sent = send(g, 'usa', { type: 'march', to: 'central-america', fromAllBordering: true, amount: 50 });
  assert.deepEqual(sent.sources.map(s => [s.from, s.amount]), [['mexico', 20]], 'amount is at most what each source has free');
  assert.equal(sent.total, 20);
  // Mexico now has no free troops, and nothing else borders central-america.
  assert.throws(() => send(g, 'usa', { type: 'march', to: 'central-america', fromAllBordering: true, percent: 100 }),
    /None of your provinces bordering central-america has free troops/);
  assert.throws(() => preview(g, map, 'usa', { to: 'mexico', from: 'west-us', fromAllBordering: true, percent: 5 }), /one source/);
  assert.throws(() => preview(g, map, 'usa', { to: 'mexico', fromAllBordering: true }), /exactly one of amount or percent/);
});

test('a friendly march whose destination turns hostile before a far source leaves fails at departure', () => {
  const g = game(g => { own(g, 'mexico', 'usa', 30); });
  const sent = send(g, 'usa', { type: 'march', to: 'east-us', sources: [{ from: 'mexico', amount: 5 }, { from: 'central-us', amount: 5 }] });
  const far = sent.orders.find(o => o.path.length > 1);
  assert.ok(far, 'mexico goes through central-us');
  own(g, 'east-us', 'germany', 3); send(g, 'usa', { type: 'declare_war', country: 'germany' });
  advance(g, far.executeAt - g.tick);
  assert.ok(g.events.some(e => e.type === 'order_failed' && e.orderId === far.id && /no longer friendly/.test(e.reason)));
});

test('no route: a clear error naming what a march may pass through', () => {
  const g = game(g => { own(g, 'central-us', 'germany'); own(g, 'west-canada', 'germany'); own(g, 'mexico', 'germany'); });
  assert.throws(() => send(g, 'usa', { type: 'march', from: 'west-us', to: 'east-us', amount: 5 }),
    /No route from west-us to east-us: a move to your own or an ally's province passes only through your own or allied provinces/);
  assert.throws(() => preview(g, map, 'usa', { from: 'west-us', to: 'east-us', amount: 5 }), /No route/);
  assert.equal(g.orders.length, 0);
});

test('a column re-routes when its way is lost, and turns back with a reason when no way is left', () => {
  const g = game(g => { own(g, 'mexico', 'usa', 30); own(g, 'west-canada', 'usa'); });
  const sent = send(g, 'usa', { type: 'march', from: 'mexico', to: 'east-us', amount: 20 });
  assert.deepEqual(sent.orders[0].path, ['central-us', 'east-us']);
  advance(g, 2);
  const column = g.armies.find(a => a.groupId === sent.groupId);
  // central-us falls before the column reaches it: arriving there, it turns back (never stuck).
  own(g, 'central-us', 'germany', 3);
  advance(g, column.arrivesAt - g.tick);
  assert.equal(column.returning, true);
  assert.ok(g.events.some(e => e.type === 'army_recalled' && e.armyId === column.id && e.reason === 'transit_blocked' && e.owner === 'germany'));
  // A route lost further ahead is replaced by the quickest remaining friendly way.
  const h = game(g => { own(g, 'alaska', 'usa', 30); own(g, 'west-canada', 'usa'); own(g, 'east-canada', 'usa'); });
  const long = send(h, 'usa', { type: 'march', from: 'alaska', to: 'east-us', amount: 20 });
  const path = long.orders[0].path;
  assert.deepEqual(path, ['west-canada', 'central-us', 'east-us']);
  advance(h, 2);
  const c = h.armies.find(a => a.groupId === long.groupId);
  own(h, path[1], 'germany', 3);
  advance(h, c.arrivesAt - h.tick);
  assert.ok(h.events.some(e => e.type === 'army_rerouted' && e.armyId === c.id && e.recipients.join() === 'usa'));
  assert.deepEqual(c.path, ['west-canada', 'east-canada', 'east-us'], 'the quickest remaining friendly way');
  advance(h, 200);
  assert.ok(!h.armies.includes(c)); assert.ok(h.events.some(e => e.type === 'reinforced' && e.province === 'east-us'));
});

test('an ally leaving mid-route: the column finds another way or turns back; waiting sources re-route at departure', () => {
  const g = game(g => { own(g, 'central-us', 'britain', 10); own(g, 'mexico', 'britain', 10); });
  ally(g, 'usa', 'britain');
  const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'east-us', amount: 5 });
  advance(g, 1);
  send(g, 'britain', { type: 'leave' }); advance(g, 30);
  advance(g, 60);
  const army = g.armies.find(a => a.groupId === sent.groupId);
  assert.ok(!army || army.returning);
  assert.ok(g.events.some(e => e.type === 'army_recalled' && e.reason === 'transit_blocked') || g.events.some(e => e.type === 'reinforced' && e.province === 'east-us'));
  // Several sources, one of them far, reinforcing: they still arrive together.
  const h = game(g => own(g, 'mexico', 'usa', 30));
  const both = send(h, 'usa', { type: 'march', to: 'east-us', sources: [{ from: 'central-us', amount: 3 }, { from: 'mexico', amount: 3 }] });
  assert.equal(new Set(both.orders.map(o => o.arrivesAt)).size, 1);
  assert.ok(both.orders.find(o => o.from === 'mexico').path.length > 1);
});
