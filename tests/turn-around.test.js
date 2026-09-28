import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, turnAroundPlan, returnTicks } from '../src/engine.js';
import { journeyPoint } from '../public/movement.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let next = 0;
function game(ids = ['usa', 'britain', 'france', 'germany']) {
  const g = createGame({ id: `turn-${++next}`, name: 'Turn around', hostId: ids[0] }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id });
  start(g); return g;
}
const send = (g, id, action, opId = `turn-op-${++next}`) => act(g, map, id, action, opId);
const advance = (g, n) => { for (let i = 0; i < n; i++) tick(g); };
const at = (g, id) => g.provinces.find(p => p.id === id);

test('recall, then march again: resumes from the actual position with the time back plus what was left', () => {
  const g = game();
  const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 6 });
  advance(g, 8);
  const army = g.armies.find(a => a.groupId === sent.groupId), left = army.arrivesAt - (g.tick + 1);
  assert.equal(turnAroundPlan(g, 'usa', army.id).mode, 'recall');
  assert.equal(send(g, 'usa', { type: 'turn_around', armyId: army.id }).mode, 'recall'); tick(g);
  assert.equal(army.returning, true); assert.equal(army.resume.to, 'mexico'); assert.equal(army.resume.remaining, left);
  advance(g, 3);
  const plan = turnAroundPlan(g, 'usa', army.id);
  assert.equal(plan.mode, 'resume'); assert.equal(plan.to, 'mexico');
  assert.equal(plan.arrivesAt, g.tick + 1 + left + 4, 'what was left plus the ticks spent coming back');
  const point = journeyPoint(army, g.positions, g.tick + 1);
  const receipt = send(g, 'usa', { type: 'turn_around', armyId: army.id }, 'again');
  assert.deepEqual(send(g, 'usa', { type: 'turn_around', armyId: army.id }, 'again'), receipt, 'idempotent retry');
  assert.equal(g.orders.filter(o => o.type === 'turn_around').length, 1);
  tick(g);
  assert.equal(army.returning, undefined); assert.equal(army.to, 'mexico'); assert.equal(army.turnArounds, 1);
  assert.deepEqual(army.startPoint, point, 'from where it actually is');
  assert.equal(army.arrivesAt, plan.arrivesAt);
  assert.ok(g.events.some(e => e.type === 'army_turned_around' && e.armyId === army.id && !e.recipients));
  // Recalling it again measures the way home by how far out it is, not the time since it turned.
  advance(g, 2);
  assert.equal(returnTicks(army, g.tick), g.tick - army.originDepartedAt);
  assert.equal(returnTicks(army, g.tick), 4 + 2, 'four ticks from home when it turned again, then two more out');
});

test('an army turned back automatically can march again once the war exists; internal speed on the way', () => {
  const g = game();
  Object.assign(at(g, 'mexico'), { owner: 'britain', troops: 3 });
  const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 6, declareWar: true });
  advance(g, 5);
  const army = g.armies.find(a => a.groupId === sent.groupId);
  send(g, 'britain', { type: 'offer_peace', country: 'usa' });
  send(g, 'usa', { type: 'accept_peace', offerId: g.peaceOffers[0].id });
  assert.equal(army.returning, true);
  assert.ok(g.events.some(e => e.type === 'army_recalled' && e.armyId === army.id && e.reason === 'peace'));
  assert.throws(() => turnAroundPlan(g, 'usa', army.id), /Declare war/);
  assert.throws(() => send(g, 'usa', { type: 'turn_around', armyId: army.id }), /Declare war/);
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  assert.equal(turnAroundPlan(g, 'usa', army.id).to, 'mexico');
  // A column crossing its own land resumes toward the far target along friendly land.
  const long = send(g, 'usa', { type: 'march', from: 'west-us', to: 'east-us', amount: 3 });
  advance(g, 2);
  const column = g.armies.find(a => a.groupId === long.groupId);
  assert.deepEqual(column.path, ['central-us', 'east-us']);
  send(g, 'usa', { type: 'recall', id: column.id }); advance(g, 2);
  const plan = turnAroundPlan(g, 'usa', column.id);
  assert.equal(plan.via, 'central-us'); assert.equal(plan.to, 'east-us');
  assert.equal(plan.arrivesAt - (g.tick + 1) - (column.resume.remaining + (g.tick + 1 - column.resume.turnedAt)),
    g.internalTravelTimes['central-us']['east-us'], 'the onward leg is charged at the internal speed');
  send(g, 'usa', { type: 'turn_around', armyId: column.id }); tick(g);
  assert.deepEqual(column.path, ['central-us', 'east-us']);
  advance(g, plan.arrivesAt - g.tick);
  assert.ok(!g.armies.includes(column)); assert.ok(g.events.some(e => e.type === 'reinforced' && e.province === 'east-us'));
});

test('turn-around is checked again at execution, refused for engaged or foreign armies, and capped at two', () => {
  const g = game();
  Object.assign(at(g, 'mexico'), { owner: 'britain', troops: 40 });
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 5 });
  advance(g, 4);
  const army = g.armies.find(a => a.groupId === sent.groupId);
  assert.throws(() => send(g, 'britain', { type: 'turn_around', armyId: army.id }), e => e.status === 403);
  for (let round = 1; round <= 2; round++) {
    send(g, 'usa', { type: 'turn_around', armyId: army.id }); advance(g, 2);
    assert.equal(army.returning, true);
    send(g, 'usa', { type: 'turn_around', armyId: army.id }); tick(g);
    assert.equal(army.turnArounds, round); advance(g, 1);
  }
  send(g, 'usa', { type: 'turn_around', armyId: army.id }); advance(g, 2);
  assert.throws(() => send(g, 'usa', { type: 'turn_around', armyId: army.id }), /at most 2 times/);
  // Peace before execution: the queued order fails with the reason, nothing moves.
  const other = send(g, 'usa', { type: 'march', from: 'central-us', to: 'mexico', amount: 5 }); advance(g, 3);
  const b = g.armies.find(a => a.groupId === other.groupId);
  send(g, 'usa', { type: 'recall', id: b.id }); advance(g, 2);
  const order = send(g, 'usa', { type: 'turn_around', armyId: b.id });
  send(g, 'usa', { type: 'offer_peace', country: 'britain' }); send(g, 'britain', { type: 'accept_peace', offerId: g.peaceOffers[0].id });
  tick(g);
  assert.equal(b.returning, true);
  assert.ok(g.events.some(e => e.type === 'order_failed' && e.orderId === order.orderId && /Declare war/.test(e.reason)));
  // Engaged armies cannot turn around; they are recalled from the battle instead.
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  const fight = send(g, 'usa', { type: 'march', from: 'central-us', to: 'mexico', amount: 3 });
  advance(g, fight.arrivesAt - g.tick);
  const engaged = g.armies.find(a => a.groupId === fight.groupId && a.engaged);
  assert.ok(engaged); assert.throws(() => send(g, 'usa', { type: 'turn_around', armyId: engaged.id }), /fighting/);
});

test('turn-around counts toward the anti-spam limit, survives save/load and is deterministic', () => {
  const run = () => {
    const g = game();
    const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 6 }, 'a'); advance(g, 6);
    const id = g.armies.find(a => a.groupId === sent.groupId).id;
    send(g, 'usa', { type: 'turn_around', armyId: id }, 'b'); advance(g, 3);
    send(g, 'usa', { type: 'turn_around', armyId: id }, 'c');
    return g;
  };
  const a = run(), b = JSON.parse(JSON.stringify(run()));
  advance(a, 40); advance(b, 40);
  const strip = g => JSON.stringify({ ...g, id: 0, reviewOrigin: 0 });
  assert.equal(strip(a), strip(b));
  const g = game();
  const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 6 }); advance(g, 4);
  const id = g.armies.find(a => a.groupId === sent.groupId).id;
  send(g, 'usa', { type: 'turn_around', armyId: id }); tick(g);
  for (let i = 0; i < 8; i++) send(g, 'usa', { type: 'march', from: 'central-us', to: 'east-us', amount: 1 });
  assert.throws(() => send(g, 'usa', { type: 'turn_around', armyId: id }), e => e.status === 429);
  assert.equal(observe(g, 'usa').rules.maxTurnArounds, 2);
});

test('march again into land you no longer border is refused', () => {
  const g = game();
  const sent = send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 6 });
  advance(g, 8);
  const army = g.armies.find(a => a.groupId === sent.groupId);
  send(g, 'usa', { type: 'recall', id: army.id }); tick(g);
  assert.equal(army.returning, true);
  // Every USA province bordering Mexico changes hands (fixture): no border of your own, no attack.
  for (const id of ['west-us', 'central-us']) Object.assign(at(g, id), { owner: 'germany', troops: 30 });
  assert.throws(() => turnAroundPlan(g, 'usa', army.id), /You have no province bordering mexico\. Take or hold a province next to it first\./);
});
