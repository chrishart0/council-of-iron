import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, preview, RULES, RuleError } from '../src/engine.js';
import { choose } from '../agents/policy.js';
import { boardView } from '../agents/board.js';
import { decisionView } from '../agents/decision-view.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let next = 0;
function game(ids = ['usa', 'britain', 'france', 'germany']) {
  const g = createGame({ id: `truce-${++next}`, name: 'Truce rules', hostId: ids[0] }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id });
  start(g); return g;
}
const send = (g, id, action) => act(g, map, id, action, `truce-${++next}`);
const advance = (g, n) => { for (let i = 0; i < n; i++) tick(g); };
const peace = (g, from, to) => { const offer = send(g, from, { type: 'offer_peace', country: to }); return send(g, to, { type: 'accept_peace', offerId: offer.offerId }); };
const refusal = fn => { try { fn(); } catch (e) { assert.ok(e instanceof RuleError); return e; } assert.fail('expected a refusal'); };

test('peace starts a truce: neither side may declare war until it ends, and the error names the end', () => {
  assert.equal(RULES.truce, 60); assert.equal(RULES.peaceRetry, 30);
  const g = game();
  advance(g, 10);
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  const made = peace(g, 'usa', 'britain');
  assert.equal(made.truceUntil, g.tick + 60);
  assert.ok(g.events.some(e => e.type === 'peace_accepted' && e.truceUntil === made.truceUntil && !e.recipients));
  for (const [a, b] of [['usa', 'britain'], ['britain', 'usa']]) {
    const e = refusal(() => send(g, a, { type: 'declare_war', country: b }));
    assert.equal(e.status, 409); assert.equal(e.details.truceUntil, made.truceUntil);
    assert.match(e.message, new RegExp(`Truce with ${b} until 01:10 \\(tick ${made.truceUntil}\\)`));
  }
  // Declare-and-march is refused whole; a plain march names the truce; the preview carries it.
  Object.assign(g.provinces.find(p => p.id === 'mexico'), { owner: 'britain', troops: 2 });
  const orders = g.orders.length, budget = g.players[0].orderTicks.length;
  assert.throws(() => send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 3, declareWar: true }), /Truce with britain/);
  assert.throws(() => send(g, 'usa', { type: 'march', from: 'west-us', to: 'mexico', amount: 3 }), /Truce with britain/);
  assert.equal(g.orders.length, orders); assert.equal(g.players[0].orderTicks.length, budget); assert.deepEqual(g.wars, []);
  assert.equal(preview(g, map, 'usa', { to: 'mexico', from: 'west-us', amount: 3 }).truceUntil, made.truceUntil);
  // Public: every viewer sees the truce; the board shows it from your side.
  assert.deepEqual(observe(g, null).truces, [{ countries: ['britain', 'usa'], since: made.truceUntil - 60, until: made.truceUntil }]);
  const board = boardView(observe(g, 'usa'), map);
  assert.deepEqual(board.truces, [{ with: 'britain', until: made.truceUntil }]);
  assert.equal(board.own.find(p => p.id === 'west-us').neighbors.find(n => n.id === 'mexico').truceUntil, made.truceUntil);
  assert.equal(decisionView(observe(g, 'usa'), map).frontier.find(t => t.id === 'mexico')?.truceUntil, made.truceUntil);
  advance(g, made.truceUntil - g.tick - 1);
  assert.throws(() => send(g, 'britain', { type: 'declare_war', country: 'usa' }), /Truce/);
  tick(g);
  assert.deepEqual(g.truces, [], 'expired truces are dropped');
  assert.deepEqual(boardView(observe(g, 'usa'), map).truces, []);
  send(g, 'britain', { type: 'declare_war', country: 'usa' });
});

test('a truce binds both whole alliances as they were at peace, pair by pair, even after they change', () => {
  const g = game();
  // Leaving and forming a new alliance takes two notice periods (60 ticks); a longer room truce keeps it holding meanwhile.
  g.rules = { ...g.rules, truce: 120 };
  const offer = send(g, 'usa', { type: 'propose', country: 'france', name: 'Accord' });
  send(g, 'france', { type: 'accept', proposalId: offer.proposalId }); advance(g, 30);
  send(g, 'france', { type: 'declare_war', country: 'britain' });
  peace(g, 'britain', 'usa');
  assert.deepEqual(g.truces.map(t => t.countries), [['britain', 'france'], ['britain', 'usa']]);
  for (const [a, b] of [['usa', 'britain'], ['france', 'britain'], ['britain', 'france'], ['britain', 'usa']])
    assert.throws(() => send(g, a, { type: 'declare_war', country: b }), /Truce/);
  // France leaves and allies with Germany: that new side may not declare war on Britain either.
  send(g, 'france', { type: 'leave' }); advance(g, 30);
  assert.throws(() => send(g, 'france', { type: 'declare_war', country: 'britain' }), /Truce with britain/);
  const pact = send(g, 'germany', { type: 'propose', country: 'france', name: 'Pact' });
  send(g, 'france', { type: 'accept', proposalId: pact.proposalId }); advance(g, 30);
  assert.throws(() => send(g, 'germany', { type: 'declare_war', country: 'britain' }), /Truce with britain/);
});

test('an unanswered peace offer cannot be repeated to the same side for peaceRetry ticks; one open offer per pair', () => {
  const g = game();
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  const offer = send(g, 'usa', { type: 'offer_peace', country: 'britain' });
  assert.throws(() => send(g, 'usa', { type: 'offer_peace', country: 'britain' }), /already open/);
  assert.throws(() => send(g, 'britain', { type: 'offer_peace', country: 'usa' }), /already open/);
  advance(g, offer.expiresAt - g.tick);
  assert.equal(g.peaceOffers.length, 0);
  const e = refusal(() => send(g, 'usa', { type: 'offer_peace', country: 'britain' }));
  assert.equal(e.status, 429); assert.equal(e.details.retryAt, g.tick + 30); assert.match(e.message, /went unanswered/);
  send(g, 'britain', { type: 'offer_peace', country: 'usa' }); // the other side may still offer
  advance(g, 30);
  assert.equal(g.peaceRetries.length, 0);
});

test('bots respect truces and do not loop war and peace against a peace-spamming seat', () => {
  const ids = map.countries.map(c => c.id);
  const g = createGame({ id: 'truce-bots', name: 'Loop check', hostId: 'usa' }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id, kind: id === 'usa' ? 'agent' : 'bot' });
  start(g);
  const memory = new Map(ids.map(id => [id, new Map()]));
  let serial = 0;
  const safe = (id, action) => { try { act(g, map, id, action, `loop-${++serial}`); } catch (e) { if (!(e instanceof RuleError)) throw e; } };
  while (g.status === 'running') {
    tick(g);
    if (g.status !== 'running') break;
    if (g.tick % 5) continue;
    // The "USA agent": declares war on its neighbours early, then offers peace to everyone it is at war with.
    if (g.tick === 5) for (const id of ['britain', 'japan']) safe('usa', { type: 'declare_war', country: id });
    for (const id of ids.filter(id => id !== 'usa' && g.wars.includes(['usa', id].sort().join(':')))) safe('usa', { type: 'offer_peace', country: id });
    for (const id of ids.filter(id => id !== 'usa')) {
      const action = choose(observe(g, id, g.sequence), map, id, memory.get(id));
      if (action) safe(id, action);
    }
  }
  const declarations = new Map();
  for (const e of g.events.filter(e => e.type === 'war_declared')) {
    const key = [e.country, ...e.toRoster].sort().join(':');
    declarations.set(key, (declarations.get(key) || 0) + 1);
  }
  const peaces = g.events.filter(e => e.type === 'peace_accepted').length;
  if (process.env.SHOW) console.log([...declarations], peaces);
  assert.ok(Math.max(0, ...declarations.values()) <= 4, `war declarations per pair: ${JSON.stringify([...declarations])}`);
  assert.ok(peaces <= 12, `peace treaties: ${peaces}`);
  // No declaration ever broke a truce.
  for (const e of g.events.filter(e => e.type === 'war_declared')) {
    const earlier = g.events.filter(p => p.type === 'peace_accepted' && p.id < e.id && p.tick + RULES.truce > e.tick);
    assert.ok(!earlier.some(p => [...p.fromRoster, ...p.toRoster].includes(e.country) && [...p.fromRoster, ...p.toRoster].some(c => e.toRoster.includes(c))));
  }
});
