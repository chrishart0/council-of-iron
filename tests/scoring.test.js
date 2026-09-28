import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, tick, score } from '../src/engine.js';

const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
function game(ids = ['usa', 'britain', 'france', 'germany']) {
  const g = createGame({ id: 'scoring', name: 'Scoring', hostId: ids[0] }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id });
  start(g);
  return g;
}
function industries(g, amounts) {
  g.provinces = Object.entries(amounts).map(([owner, development]) => ({ id: `score-${owner}`, owner,
    development, troops: 1, nextRecruit: 2000, developing: null }));
}
function coalition(g, ids, side = 'coalition-score') {
  for (const p of g.players) if (ids.includes(p.id)) p.side = side;
  g.coalitions.push({ id: side, name: 'Scoring Coalition', createdAt: 0 });
  return side;
}
const results = g => Object.fromEntries(g.outcome.scores.map(s => [s.country, s.result]));

test('every member of the winning side wins, whatever its share; score is own industry', () => {
  const g = game(), side = coalition(g, ['usa', 'britain']);
  industries(g, { usa: 5, britain: 95, france: 70, germany: 60 });
  const outcome = Object.fromEntries(score(g, side, false).map(s => [s.country, s]));
  assert.deepEqual([outcome.usa.result, outcome.britain.result, outcome.france.result], ['win', 'win', 'loss']);
  assert.deepEqual([outcome.usa.industry, outcome.britain.industry], [5, 95]);
});

test('at the deadline the side with the most industry wins; a tie for first is a draw', () => {
  const g = game(); coalition(g, ['france', 'germany']);
  industries(g, { usa: 50, britain: 40, france: 30, germany: 25 });
  g.tick = 1799; tick(g);
  assert.equal(g.outcome.reason, 'deadline');
  assert.deepEqual(results(g), { usa: 'loss', britain: 'loss', france: 'win', germany: 'win' });
  const tied = game(); industries(tied, { usa: 40, britain: 40, france: 10, germany: 10 });
  tied.tick = 1799; tick(tied);
  assert.equal(tied.outcome.draw, true); assert.ok(Object.values(results(tied)).every(r => r === 'draw'));
});

test('holding 60% of the industry for 90 s wins before the deadline', () => {
  const g = game(); industries(g, { usa: 70, britain: 10, france: 10, germany: 10 });
  tick(g); assert.equal(g.dominance[g.players.find(p => p.id === 'usa').side], 1);
  for (let i = 0; i < 90; i++) tick(g);
  assert.equal(g.outcome.reason, 'domination'); assert.equal(results(g).usa, 'win');
  assert.deepEqual(Object.keys(g.outcome.scores[0]).sort(), ['country', 'industry', 'result']);
});
