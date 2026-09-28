import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, atWar as engineAtWar, allied as engineAllied } from '../src/engine.js';
import { relationsOf, atWar, allianceColors, coalitions, formingAlliances, ALLIANCE_PALETTE } from '../public/relations.js';

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

test('a forming alliance is public, has its future roster and keeps its colour when it activates', () => {
  const g = game();
  const q = send(g, 'france', { type: 'propose', country: 'japan', name: 'Pacific Pact' });
  send(g, 'japan', { type: 'accept', proposalId: q.proposalId });
  const before = observe(g, 'usa'), forming = formingAlliances(before);
  assert.equal(forming.length, 1);
  assert.deepEqual(forming[0].members, ['france', 'japan']);
  assert.equal(forming[0].name, 'Pacific Pact'); assert.ok(forming[0].activateAt > g.tick);
  const color = allianceColors(before)[forming[0].id];
  assert.ok(ALLIANCE_PALETTE.includes(color));
  for (let i = 0; i < 60; i++) tick(g);
  const after = observe(g, 'usa');
  assert.equal(formingAlliances(after).length, 0);
  const bloc = coalitions(after).find(c => c.members.join() === 'france,japan');
  assert.equal(allianceColors(after)[bloc.id], color);
});

test('alliance palette stays separated under simulated colour-vision deficiencies', () => {
  // Machado et al. (2009) severity-1 matrices on linear RGB; CIE76 ΔE in Lab.
  const M = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]];
  const lab = (hex, m) => {
    const l = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    const r = m.map(row => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
    const f = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const X = f((r[0] * .4124 + r[1] * .3576 + r[2] * .1805) / .95047), Y = f(r[0] * .2126 + r[1] * .7152 + r[2] * .0722), Z = f((r[0] * .0193 + r[1] * .1192 + r[2] * .9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const dE = (a, b) => Math.min(...M.map(m => { const p = lab(a, m), q = lab(b, m); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
  const avoid = ['#e0372b', '#ff4a33', '#d9b45a', ...map.countries.map(c => c.color)];
  for (const [i, a] of ALLIANCE_PALETTE.entries()) {
    for (const b of ALLIANCE_PALETTE.slice(i + 1)) assert.ok(dE(a, b) > 35, `${a}/${b} ${dE(a, b)}`);
    for (const b of avoid) assert.ok(dE(a, b) > 15, `${a} too close to ${b}: ${dE(a, b)}`);
  }
  assert.ok(ALLIANCE_PALETTE.length >= Math.floor(map.countries.length / 2));
});

test('unknown or missing input is empty, never throws', () => {
  assert.deepEqual(relationsOf(null, 'usa'), { allies: [], enemies: [], neutral: [] });
  assert.deepEqual(relationsOf({ players: [] }, 'usa'), { allies: [], enemies: [], neutral: [] });
  assert.equal(atWar({ players: [{ id: 'a', side: 'x' }], wars: ['a:b'], rules: { warRequired: true } }, 'a', 'b'), false);
});

test('only armies at war with the viewer threaten its provinces', async () => {
  const { threatening } = await import('../public/relations.js');
  const base = { rules: { warRequired: true }, wars: [],
    players: [{ id: 'britain', side: 'solo:britain' }, { id: 'france', side: 'solo:france' }],
    provinces: [{ id: 'brazil', owner: 'britain' }] };
  const army = { id: 'a1', country: 'france', to: 'brazil', returning: false };
  // France raced Britain to neutral Brazil; Britain arrived first. France is not at war with Britain: its army turns back.
  assert.equal(threatening(base, army, 'britain'), false);
  assert.equal(threatening({ ...base, wars: ['britain:france'] }, army, 'britain'), true);
  assert.equal(threatening({ ...base, wars: ['britain:france'] }, { ...army, returning: true }, 'britain'), false);
  // Legacy rooms without formal war: every non-ally is hostile.
  assert.equal(threatening({ ...base, rules: {} }, army, 'britain'), true);
});
