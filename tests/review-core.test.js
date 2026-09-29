// Regressions found in the core review pass (engine, server, agents).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, preview } from '../src/engine.js';

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
