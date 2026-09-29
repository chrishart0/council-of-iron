// Regressions found in the core review pass (engine, server, agents).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, preview, observe, turnAroundPlan } from '../src/engine.js';
import { threatening } from '../public/relations.js';
import { commsItems, systemCopy } from '../public/feed-model.js';

const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let serial = 0;
function game() {
  const g = createGame({ id: `core-${++serial}`, name: 'Core review', hostId: 'usa' }, map);
  for (const c of map.countries) join(g, map, { profileId: c.id, name: c.id, country: c.id });
  start(g); return g;
}
const send = (g, id, action) => act(g, map, id, action, `core-${++serial}`);
const army = (g, fields) => {
  const a = { id: `army-t${++serial}`, departedAt: g.tick, arrivesAt: g.tick + 1, ...fields };
  g.armies.push(a); return a;
};

test('an arrival that may not enter never takes first claim from a real attacker', () => {
  const g = game();
  send(g, 'usa', { type: 'declare_war', country: 'germany' });
  // France is not at war with Germany (e.g. its target changed hands on the way): it is turned back, and
  // the smaller American attack arriving on the same tick still fights.
  army(g, { country: 'france', from: 'north-france', to: 'ruhr', amount: 50 });
  const usa = army(g, { country: 'usa', from: 'north-france', to: 'ruhr', amount: 10 });
  tick(g);
  const battle = g.battles.find(b => b.province === 'ruhr');
  assert.ok(battle, 'the American attack starts a battle');
  assert.equal(battle.attackerSide, g.players.find(p => p.id === 'usa').side);
  assert.equal(g.armies.find(a => a.id === usa.id)?.engaged, true);
  const turned = g.events.filter(e => e.type === 'army_recalled' && e.country === 'france');
  assert.deepEqual(turned.map(e => e.reason), ['no_war']);
});

test('the arrival forecast counts defenders ending at the target, not columns passing through it', () => {
  const g = game();
  send(g, 'france', { type: 'declare_war', country: 'germany' });
  army(g, { country: 'germany', from: 'bavaria', to: 'ruhr', amount: 7, path: ['ruhr', 'prussia'], pathIndex: 0,
    origin: 'bavaria', originDepartedAt: g.tick });
  army(g, { country: 'germany', from: 'prussia', to: 'ruhr', amount: 4 });
  const plan = preview(g, map, 'france', { to: 'ruhr', from: 'north-france', amount: 3 });
  assert.equal(plan.defenseAtArrival.incoming, 4);
});

test('a truce blocks declarations, but joining an alliance at war brings you into its wars at once', () => {
  const g = game();
  send(g, 'usa', { type: 'declare_war', country: 'germany' });
  send(g, 'france', { type: 'declare_war', country: 'germany' });
  const offer = send(g, 'france', { type: 'offer_peace', country: 'germany' });
  const { truceUntil } = send(g, 'germany', { type: 'accept_peace', offerId: offer.offerId });
  // While no war exists, the truce blocks declarations either way.
  assert.throws(() => send(g, 'france', { type: 'declare_war', country: 'germany' }), /Truce with germany/);
  assert.throws(() => send(g, 'germany', { type: 'declare_war', country: 'france' }), /Truce with france/);
  const q = send(g, 'usa', { type: 'propose', country: 'france', name: 'Accord' });
  send(g, 'france', { type: 'accept', proposalId: q.proposalId });
  while (g.players.find(p => p.id === 'france').side !== g.players.find(p => p.id === 'usa').side) tick(g);
  assert.ok(g.tick < truceUntil, 'the alliance formed during the truce');
  assert.ok(g.wars.includes('france:germany'), 'France joined the alliance war with Germany at once');
});

test('a returning army whose home is captured by an enemy keeps advancing on it as an ordinary attack', () => {
  const g = game();
  send(g, 'ottoman', { type: 'declare_war', country: 'russia' });
  Object.assign(g.provinces.find(p => p.id === 'ukraine'), { troops: 0 });
  army(g, { country: 'ottoman', from: 'anatolia', to: 'ukraine', amount: 5 });
  const home = army(g, { country: 'russia', from: 'anatolia', to: 'ukraine', amount: 12, returning: true,
    resume: { to: 'anatolia', target: 'anatolia', remaining: 5, turnedAt: g.tick }, arrivesAt: g.tick + 30 });
  tick(g); tick(g);
  assert.equal(g.provinces.find(p => p.id === 'ukraine').owner, 'ottoman', 'The Ottomans took the empty province');
  assert.equal(home.returning, undefined); assert.equal(home.to, 'ukraine');
  const notice = g.events.find(e => e.type === 'army_advancing');
  assert.deepEqual({ ...notice, id: 0, tick: 0 }, { id: 0, tick: 0, type: 'army_advancing', country: 'russia', armyId: home.id,
    province: 'ukraine', owner: 'ottoman', amount: 12, arrivesAt: home.arrivesAt, reason: 'home_captured' });
  assert.ok(threatening(observe(g, 'ottoman'), observe(g, 'ottoman').armies.find(a => a.id === home.id), 'ottoman'),
    'the new owner sees an incoming attack');
  // The owner gets a personal row naming the reason; nobody else does.
  const mine = commsItems(observe(g, 'russia').events, [], { you: 'russia' }).find(i => i.system === 'home_captured');
  assert.deepEqual(mine.threads, ['mine']);
  const names = { country: id => id, side: id => id, time: t => `t${t}`, province: id => id };
  assert.equal(systemCopy(mine, names).detail,
    `Your 12 troops are attacking ukraine: it was captured while they marched home. They arrive at t${home.arrivesAt}.`);
  assert.ok(!commsItems(observe(g, 'ottoman').events, [], { you: 'ottoman' }).some(i => i.system === 'home_captured'));
  // Turn-around is a recall now; the recall sends it to the nearest province of its own.
  assert.equal(turnAroundPlan(g, 'russia', home.id).mode, 'recall');
  send(g, 'russia', { type: 'turn_around', armyId: home.id }); tick(g);
  assert.equal(home.returning, true);
  assert.equal(g.provinces.find(p => p.id === home.to).owner, 'russia');
  assert.ok(home.arrivesAt > g.tick);
  // And it can march again toward the province it was attacking.
  const again = send(g, 'russia', { type: 'turn_around', armyId: home.id });
  assert.equal(again.mode, 'resume'); assert.equal(again.to, 'ukraine');
});

test('a returning army whose home is held by a country it is not at war with keeps returning and is interned', () => {
  const g = game();
  Object.assign(g.provinces.find(p => p.id === 'ukraine'), { owner: 'ottoman', troops: 3 });
  const home = army(g, { country: 'russia', from: 'anatolia', to: 'ukraine', amount: 12, returning: true });
  tick(g);
  assert.ok(!g.armies.includes(home));
  assert.ok(g.events.some(e => e.type === 'army_interned' && e.armyId === home.id));
  assert.ok(!g.events.some(e => e.type === 'army_advancing'));
});
