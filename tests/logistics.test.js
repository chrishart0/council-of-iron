import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, RULES } from '../src/engine.js';
import { travelTicks, distanceKm } from '../public/movement.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let next = 0;
/** USA, Britain and Japan; `setup` edits ownership before the start so recruitment timers run. */
function game({ setup } = {}) {
  const g = createGame({ id: `logistics-${++next}`, name: 'Logistics', hostId: 'usa' }, map);
  for (const id of ['usa', 'britain', 'japan']) join(g, map, { profileId: id, name: id, country: id });
  setup?.(g); start(g); return g;
}
const at = (g, id) => g.provinces.find(p => p.id === id);
const own = (g, id, owner, troops) => Object.assign(at(g, id), { owner, troops });
const send = (g, country, action, opId = `op-${++next}`) => act(g, map, country, action, opId);
const advance = (g, n) => { for (let i = 0; i < n; i++) tick(g); };
const until = (g, predicate, limit = 400) => { for (let i = 0; i < limit && !predicate(); i++) tick(g); assert.ok(predicate(), 'condition reached'); };
const rallyArmies = g => g.armies.filter(a => a.rally);
const ally = (g, ...ids) => { for (const id of ids) g.players.find(p => p.id === id).side = 'coalition-test'; };
const mexicoToPacific = g => own(g, 'mexico', 'usa', 10);

test('one ruleset: every link ×1.2 faster than the distance table, internal links a further ×2, integer ceilings', () => {
  const g = game();
  assert.deepEqual(g.rules, RULES);
  assert.deepEqual(g.rules.developmentCosts, [0, 24, 48]); assert.deepEqual(g.rules.developmentTicks, [0, 120, 180]);
  const byId = new Map(map.provinces.map(p => [p.id, p]));
  for (const p of map.provinces) for (const id of p.neighbors) {
    const base = RULES.marchSetup + Math.ceil(distanceKm(p, byId.get(id)) / RULES.kmPerTick);
    assert.equal(g.travelTimes[p.id][id], Math.ceil(base * 5 / 6));
    assert.equal(g.internalTravelTimes[p.id][id], Math.ceil(base * 5 / 12));
    assert.equal(travelTicks(p, byId.get(id), RULES), g.travelTimes[p.id][id]);
  }
  assert.deepEqual(observe(g, 'usa').internalTravelTimes, g.internalTravelTimes);
});

test('internal speed is charged speed only when both ends are friendly at departure', () => {
  const g = game({ setup: g => own(g, 'west-us', 'usa', 60) });
  const inside = send(g, 'usa', { type:'march', from: 'west-us', to: 'central-us', amount: 10 });
  const outside = send(g, 'usa', { type:'march', from: 'west-us', to: 'mexico', amount: 10 });
  assert.equal(inside.arrivesAt, g.tick + 1 + g.internalTravelTimes['west-us']['central-us']);
  assert.equal(outside.arrivesAt, g.tick + 1 + g.travelTimes['west-us'].mexico);
  assert.equal(g.provinces.length > 0 && observe(g, 'usa').internalTravelTimes['west-us']['central-us'], 28);
  tick(g);
  const fast = g.armies.find(a => a.to === 'central-us');
  assert.equal(fast.arrivesAt - fast.departedAt, 28);
  // A recall takes as long as the army has been out.
  advance(g, 5); send(g, 'usa', { type: 'recall', id: fast.id }); tick(g);
  assert.equal(fast.returning, true); assert.equal(fast.arrivesAt, g.tick + 6);
  assert.ok(g.internalTravelTimes['west-us']['central-us'] < g.travelTimes['west-us']['central-us']);
});

test('battles resolve four rounds per five ticks with unchanged dice per round', () => {
  for (const [ruleset, expected] of [['current', 8]]) {
    const g = game({ setup: g => { own(g, 'mexico', 'britain', 400); own(g, 'west-us', 'usa', 400); } });
    send(g, 'usa', { type: 'declare_war', country: 'britain' });
    send(g, 'usa', { type:'march', from: 'west-us', to: 'mexico', amount: 300 });
    until(g, () => g.battles.length === 1);
    const rounds = new Set();
    for (let i = 0; i < 10; i++) { tick(g); if (g.battles[0]?.lastRound) rounds.add(g.battles[0].lastRound.tick); }
    assert.equal(rounds.size, expected, ruleset);
    const r = g.battles[0].lastRound; assert.ok(r.attackDice.length === 3 && r.defendDice.length === 2);
  }
});

test('rally: a new recruit marches to the rally province; automatic dispatches are free', () => {
  const g = game({ setup: mexicoToPacific });
  const r = send(g, 'usa', { type: 'rally', from: 'mexico', to: 'west-us' });
  assert.deepEqual(r.sources.map(s => s.path), [['west-us']]);
  assert.deepEqual(g.rallies, [], 'executes next tick'); tick(g);
  assert.deepEqual(observe(g, 'usa').rallies.map(x => [x.from, x.to, x.status]), [['mexico', 'west-us', 'active']]);
  assert.deepEqual(observe(g, 'britain').rallies, [], 'rally points are private');
  assert.deepEqual(observe(g, null).rallies, []);
  const budget = [...g.players.find(p => p.id === 'usa').orderTicks];
  until(g, () => rallyArmies(g).length === 1);
  const a = rallyArmies(g)[0];
  assert.deepEqual([a.from, a.to, a.amount, a.rally, a.country], ['mexico', 'west-us', 1, true, 'usa']);
  assert.equal(at(g, 'mexico').troops, 10, 'the garrison is untouched; only the new recruit left');
  assert.deepEqual(g.players.find(p => p.id === 'usa').orderTicks, budget, 'automatic dispatch uses no command');
  assert.ok(g.events.some(e => e.type === 'rally_dispatched' && e.recipients?.join() === 'usa'));
  const before = at(g, 'west-us').troops; until(g, () => !g.armies.includes(a));
  assert.ok(at(g, 'west-us').troops >= before + 1);
});

test('rally takes the fastest path through allied land without gifting troops', () => {
  const g = game({ setup: g => { own(g, 'mexico', 'usa', 30); own(g, 'central-us', 'britain', 10); own(g, 'west-us', 'japan', 10); } });
  ally(g, 'usa', 'britain');
  const plan = send(g, 'usa', { type: 'rally', from: 'mexico', to: 'east-us' });
  assert.deepEqual(plan.sources[0].path, ['central-us', 'east-us']);
  assert.equal(plan.sources[0].travel, g.internalTravelTimes.mexico['central-us'] + g.internalTravelTimes['central-us']['east-us']);
  until(g, () => rallyArmies(g).length === 1);
  const a = rallyArmies(g)[0], east = at(g, 'east-us').troops, britain = at(g, 'central-us').troops;
  until(g, () => a.pathIndex === 1);
  assert.equal(a.to, 'east-us'); assert.equal(a.arrivesAt - a.departedAt, g.internalTravelTimes['central-us']['east-us']);
  until(g, () => !g.armies.includes(a));
  assert.equal(at(g, 'east-us').troops >= east + 1, true);
  assert.equal(at(g, 'central-us').troops >= britain, true, 'the ally keeps its own garrison');
  assert.equal(at(g, 'central-us').owner, 'britain');
});

test('an unreachable rally pauses with a visible reason and resumes when the path reopens', () => {
  const g = game({ setup: g => { own(g, 'mexico', 'usa', 30); own(g, 'west-us', 'usa', 10); own(g, 'central-us', 'usa', 10); } });
  send(g, 'usa', { type: 'rally', from: 'mexico', to: 'east-us' }); tick(g);
  own(g, 'central-us', 'japan', 10); own(g, 'west-us', 'japan', 10);
  assert.throws(() => send(g, 'usa', { type: 'rally', from: 'mexico', to: 'east-us' }), /No path/);
  until(g, () => g.rallies[0].status === 'paused');
  assert.equal(g.rallies[0].reason, 'no_path'); assert.equal(rallyArmies(g).length, 0);
  assert.ok(g.events.some(e => e.type === 'rally_paused' && e.reason === 'no_path' && e.recipients.join() === 'usa'));
  own(g, 'central-us', 'usa', 10);
  until(g, () => rallyArmies(g).length === 1);
  assert.equal(g.rallies[0].status, 'active'); assert.equal(g.rallies[0].reason, undefined);
  assert.ok(g.events.some(e => e.type === 'rally_resumed'));
});

test('a rally column never attacks: a lost destination turns it back', () => {
  const g = game({ setup: g => { own(g, 'mexico', 'usa', 30); own(g, 'west-us', 'usa', 10); } });
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  send(g, 'usa', { type: 'rally', from: 'mexico', to: 'west-us' });
  until(g, () => rallyArmies(g).length === 1);
  const a = rallyArmies(g)[0];
  own(g, 'west-us', 'britain', 3);
  until(g, () => a.returning);
  assert.equal(g.battles.length, 0, 'no battle begins');
  assert.ok(g.events.some(e => e.type === 'army_recalled' && e.armyId === a.id && e.reason === 'rally_blocked' && e.owner === 'britain'));
  until(g, () => g.rallies[0].reason === 'destination_lost');
  assert.throws(() => send(g, 'usa', { type: 'rally', from: 'mexico', to: 'mexico' }), /own provinces|itself/);
  assert.throws(() => send(g, 'usa', { type: 'rally', from: 'mexico', to: 'west-us' }), /own provinces/);
});

test('a rally column is an ordinary army: recallable; only lost territory pauses or clears a rally', () => {
  const g = game({ setup: g => { own(g, 'mexico', 'usa', 30); } });
  send(g, 'usa', { type: 'rally', from: 'mexico', to: 'west-us' });
  until(g, () => rallyArmies(g).length === 1);
  const a = rallyArmies(g)[0]; advance(g, 3);
  send(g, 'usa', { type: 'recall', id: a.id }); tick(g);
  assert.equal(a.returning, true); assert.equal(a.to, 'mexico');
  assert.throws(() => send(g, 'usa', { type: 'recall', id: a.id }), /returning/);
  // A battle at the source does not pause the rally (user decision); dispatched recruits count as routed defenders.
  const siege = { id: 'battle-test', province: 'mexico', startedAt: g.tick + 1e6, attackerSide: 'solo:japan', previousOwner: 'usa',
    before: 0, arrivals: [], defenderRecruited: 0, defenderRouted: 0, withdrawn: 0, engaged: 0, casualties: 0, lastRound: null };
  g.battles.push(siege); const columns = rallyArmies(g).length;
  until(g, () => rallyArmies(g).length > columns);
  assert.equal(g.rallies[0].status, 'active'); assert.ok(siege.defenderRouted > 0);
  assert.ok(!g.events.some(e => e.type === 'rally_paused' && e.reason === 'under_attack'));
  g.battles = g.battles.filter(b => b !== siege);
  // Source captured: the rally point is cleared and its owner told why.
  own(g, 'mexico', 'japan', 5); tick(g);
  assert.equal(g.rallies.length, 0);
  assert.ok(g.events.some(e => e.type === 'rally_cleared' && e.reason === 'source_lost'));
});

test('rally clear, bulk sources and idempotent retries', () => {
  const g = game({ setup: g => { own(g, 'mexico', 'usa', 30); own(g, 'canada', 'usa', 10); } });
  assert.throws(() => send(g, 'usa', { type: 'rally', from: 'mexico', to: null }), /No rally point/);
  const action = { type: 'rally', from: ['mexico', 'canada', 'central-us'], to: 'west-us' };
  const first = send(g, 'usa', action, 'rally-1'), again = send(g, 'usa', action, 'rally-1');
  assert.deepEqual(again, first); assert.equal(g.orders.filter(o => o.type === 'rally').length, 1);
  assert.throws(() => send(g, 'usa', { ...action, to: 'east-us' }, 'rally-1'), /different action/);
  assert.throws(() => send(g, 'usa', { type: 'rally', from: ['mexico', 'mexico'], to: 'west-us' }), /once/);
  assert.throws(() => send(g, 'usa', { type: 'rally', from: ['east-us', 'atlantis'], to: 'west-us' }), /Unknown province/);
  tick(g); assert.deepEqual(g.rallies.map(x => x.from), ['canada', 'central-us', 'mexico']);
  send(g, 'usa', { type: 'rally', from: ['mexico', 'central-us'], to: null });
  send(g, 'usa', { type: 'rally', from: 'east-us', to: 'west-us' });
  tick(g); assert.deepEqual(g.rallies.map(x => x.from), ['canada', 'east-us']);
  assert.ok(g.events.some(e => e.type === 'rally_cleared' && e.reason === 'order'));
  // Sources that cannot rally there are skipped and listed (the rally point keeps its own recruits);
  // a rally with no source left changes nothing.
  const partial = send(g, 'usa', { type: 'rally', from: ['east-us', 'west-us', 'england'], to: 'west-us' });
  assert.deepEqual(partial.sources.map(s => s.from), ['east-us']);
  assert.deepEqual(partial.skipped, [{ from: 'west-us', reason: 'it is the rally point' }, { from: 'england', reason: 'not yours' }]);
  assert.throws(() => send(g, 'usa', { type: 'rally', from: ['west-us'], to: 'west-us' }), /cannot rally to itself/);
});

test('rally matches are deterministic and survive a snapshot round trip', () => {
  const play = () => {
    const g = game({ setup: g => { own(g, 'mexico', 'usa', 30); own(g, 'central-us', 'britain', 10); } });
    ally(g, 'usa', 'britain');
    send(g, 'usa', { type: 'rally', from: ['mexico', 'west-us'], to: 'east-us' }, 'a');
    advance(g, 50); return g;
  };
  const a = play(), b = play();
  const strip = g => JSON.stringify({ ...g, id: 0, reviewOrigin: 0 });
  assert.equal(strip(a), strip(b));
  const copy = JSON.parse(JSON.stringify(a));
  advance(a, 150); advance(copy, 150);
  assert.equal(JSON.stringify(a), JSON.stringify(copy));
});
