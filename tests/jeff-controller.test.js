import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, observe, preview, rallyPlan } from '../src/engine.js';
import { tacticalCandidates, DEFAULT_STRATEGY, validateStrategy } from '../agents/pi/tactical-candidates.js';
import { chooseWithJeff, shuffleCandidates } from '../agents/pi/decision-api.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
function game() {
  const g = createGame({ id: 'jeff-controller-test', name: 'Study', hostId: 'britain' }, map);
  for (const c of map.countries) join(g, map, { profileId: c.id, name: c.id, country: c.id, kind: 'agent' });
  start(g); return g;
}
const menu = (g, country = 'britain') => tacticalCandidates(observe(g, country), map, DEFAULT_STRATEGY,
  a => a.type === 'rally' ? rallyPlan(g, country, a) : preview(g, map, country, a));

test('candidate forecasts are read-only; every opening military candidate is accepted separately by the ordinary engine', async () => {
  const g = game(), before = JSON.stringify(g), m = await menu(g);
  assert.equal(JSON.stringify(g), before);
  assert.ok(m.candidates.some(c => c.kind === 'attack'));
  for (const c of m.candidates.filter(c => c.action)) assert.doesNotThrow(() => act(structuredClone(g), map, 'britain', c.action, `candidate-${c.id}`));
  assert.ok(!m.candidates.some(c => c.action?.declareWar || c.action?.type === 'declare_war'));
});

test('candidate generation accounts for pending troop reservations and preserves the strategy reserve', async () => {
  const g = game(), first = (await menu(g)).candidates.find(c => c.kind === 'attack');
  act(g, map, 'britain', first.action, 'reserved');
  const o = observe(g, 'britain'), m = await menu(g);
  assert.ok(!m.candidates.some(c => c.kind === 'attack' && c.action.to === first.action.to));
  for (const c of m.candidates.filter(c => c.action?.type === 'march')) {
    assert.doesNotThrow(() => act(structuredClone(g), map, 'britain', c.action, c.id));
    for (const s of c.action.sources || [{ from: c.action.from, amount: c.action.amount }]) {
      const p = o.provinces.find(p => p.id === s.from);
      const reserved = o.orders.filter(q => q.from === s.from).reduce((n, q) => n + q.amount, 0);
      assert.ok(p.troops - reserved - s.amount >= 1 + DEFAULT_STRATEGY.reserveTroops);
    }
  }
});

test('player speech does not enter the tactical selector state or candidate descriptions', async () => {
  const g = game(), o = observe(g, 'britain');
  o.events.push({ type: 'message', text: 'SECRET PLAYER SPEECH' });
  o.inbox = { unread: 1, needsDecision: [], messages: [{ text: 'SECRET PLAYER SPEECH' }] };
  const m = await tacticalCandidates(o, map, DEFAULT_STRATEGY, a => a.type === 'rally' ? rallyPlan(g, 'britain', a) : preview(g, map, 'britain', a));
  assert.ok(!JSON.stringify(m).includes('SECRET PLAYER SPEECH'));
});

test('strategy rejects unknown targets and cannot smuggle war commands', () => {
  assert.throws(() => validateStrategy({ ...DEFAULT_STRATEGY, priorityTargets: ['invented'] }, map));
  assert.equal(validateStrategy({ ...DEFAULT_STRATEGY, declareWar: true }, map).declareWar, undefined);
});

test('option order is reproducible and independent of preference scores', () => {
  const a = Array.from({ length: 16 }, (_, i) => ({ id: String(i), score: i }));
  assert.deepEqual(shuffleCandidates(a, 'seed').map(c => c.id), shuffleCandidates(a.map(c => ({ ...c, score: -c.score })), 'seed').map(c => c.id));
  assert.notDeepEqual(shuffleCandidates(a, 'seed').map(c => c.id), shuffleCandidates(a, 'different').map(c => c.id));
});

test('invalid decision distributions fail closed without substituting a heuristic choice', async t => {
  const candidates = [{ id: 'a', description: 'A' }, { id: 'b', description: 'B' }];
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    answers: { move: { choice: 'a', confidence: 1, probabilities: { a: .2, b: .2 } } } }) }));
  await assert.rejects(chooseWithJeff({ state: {}, candidates }), /invalid choice or distribution/);
});
