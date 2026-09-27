import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, atWar as engineAtWar, allied as engineAllied } from '../src/engine.js';
import { relationsOf, atWar, allianceColors, coalitions, ALLIANCE_PALETTE } from '../public/relations.js';

const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let n = 0;
function game(legacy = false) {
  const g = createGame({ id: `rel-${++n}`, name: 'Relations', hostId: 'usa' }, map);
  for (const c of map.countries) join(g, map, { profileId: c.id, name: c.id, country: c.id });
  start(g); if (legacy) g.rules.warRequired = false;
  return g;
}
const send = (g, id, action) => act(g, map, id, action, `rel-${++n}`);
function agreesWithEngine(g) {
  const view = observe(g, null);
  for (const a of map.countries.map(c => c.id)) {
    const r = relationsOf(view, a);
    assert.equal(r.allies.length + r.enemies.length + r.neutral.length, map.countries.length - 1);
    for (const b of map.countries.map(c => c.id)) {
      if (a === b) continue;
      assert.equal(atWar(view, a, b), engineAtWar(g, a, b), `${a}/${b}`);
      assert.equal(r.enemies.includes(b), engineAtWar(g, a, b));
      assert.equal(r.allies.includes(b), engineAllied(g, a, b));
    }
  }
}

test('relationsOf matches the engine: wars, coalitions and neutrality', () => {
  const g = game();
  agreesWithEngine(g);
  assert.deepEqual(relationsOf(observe(g, null), 'germany').enemies, []);
  send(g, 'germany', { type: 'declare_war', country: 'france' });
  const proposal = send(g, 'usa', { type: 'propose', country: 'britain', name: 'Accord' });
  send(g, 'britain', { type: 'accept', proposalId: proposal.proposalId });
  for (let i = 0; i < 40; i++) tick(g);
  agreesWithEngine(g);
  const view = observe(g, null);
  assert.deepEqual(relationsOf(view, 'germany').enemies, ['france']);
  assert.deepEqual(relationsOf(view, 'france').enemies, ['germany']);
  assert.deepEqual(relationsOf(view, 'usa').allies, ['britain']);
  assert.ok(relationsOf(view, 'usa').neutral.includes('japan'));
});

test('legacy rooms without formal war treat every non-ally as hostile, like the engine', () => {
  const g = game(true);
  agreesWithEngine(g);
  assert.equal(relationsOf(observe(g, null), 'japan').enemies.length, map.countries.length - 1);
});

test('alliance colours are stable, distinct and cover exactly the active coalitions', () => {
  const g = game();
  const accord = send(g, 'usa', { type: 'propose', country: 'britain', name: '<img src=x onerror=alert(1)>' });
  send(g, 'britain', { type: 'accept', proposalId: accord.proposalId });
  const compact = send(g, 'germany', { type: 'propose', country: 'russia', name: 'Compact' });
  send(g, 'russia', { type: 'accept', proposalId: compact.proposalId });
  for (let i = 0; i < 40; i++) tick(g);
  const view = observe(g, null), colors = allianceColors(view), blocs = coalitions(view);
  assert.equal(blocs.length, 2);
  assert.deepEqual(Object.keys(colors).sort(), blocs.map(b => b.id).sort());
  assert.equal(new Set(Object.values(colors)).size, 2);
  assert.ok(Object.values(colors).every(c => ALLIANCE_PALETTE.includes(c)));
  assert.deepEqual(allianceColors(JSON.parse(JSON.stringify(view))), colors);
  assert.ok(blocs.some(b => b.name === '<img src=x onerror=alert(1)>' && b.members.join() === 'britain,usa'));
  const countryColors = new Set(map.countries.map(c => c.color.toLowerCase()));
  assert.ok(ALLIANCE_PALETTE.every(c => !countryColors.has(c)));
});

test('unknown or missing input is empty, never throws', () => {
  assert.deepEqual(relationsOf(null, 'usa'), { allies: [], enemies: [], neutral: [] });
  assert.deepEqual(relationsOf({ players: [] }, 'usa'), { allies: [], enemies: [], neutral: [] });
  assert.equal(atWar({ players: [{ id: 'a', side: 'x' }], wars: ['a:b'], rules: { warRequired: true } }, 'a', 'b'), false);
});
