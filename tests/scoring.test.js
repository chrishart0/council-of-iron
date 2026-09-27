import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, tick, score, leaderboard, observe } from '../src/engine.js';

const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
function game(ids = ['usa', 'britain', 'france', 'germany']) {
  const g = createGame({ id: 'scoring', name: 'Scoring', hostId: ids[0] }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id });
  start(g);
  g.tick = 300;
  return g;
}
function industries(g, amounts) {
  g.provinces = Object.entries(amounts).map(([owner, development]) => ({ id: `score-${owner}`, owner,
    development, troops: 1, nextRecruit: 2000, developing: null, route: null }));
}
function coalition(g, ids, side = 'coalition-score') {
  for (const p of g.players) if (ids.includes(p.id)) p.side = side;
  g.coalitions.push({ id: side, name: 'Scoring Coalition', createdAt: 0 });
  return side;
}

test('coalition victory share combines owned industry with tenure and gives five percent strength about ten percent of points', () => {
  const g = game(), side = coalition(g, ['usa', 'britain']);
  industries(g, { usa: 5, britain: 95, france: 70, germany: 60 });
  const outcome = score(g, side), usa = outcome.find(p => p.country === 'usa');
  const britain = outcome.find(p => p.country === 'britain');
  assert.ok(usa.victoryShare > .09 && usa.victoryShare < .11);
  assert.ok(Math.abs(usa.victoryShare + britain.victoryShare - 1) < 1e-12);
  assert.equal(usa.payout, usa.maximumShare);
  assert.equal(britain.payout, britain.maximumShare);
  assert.ok(Math.abs(usa.payout + britain.payout - 400) < 1e-10);
  g.players.find(p => p.id === 'usa').joinedAt = 150;
  const half = score(g, side).find(p => p.country === 'usa');
  assert.equal(half.maturity, .5);
  assert.equal(half.payout, half.maximumShare / 2);
  assert.equal(score(g, side).find(p => p.country === 'britain').payout, britain.payout);
});

test('deadline awards fifty percent to first and twenty-five percent each to second and third', () => {
  const g = game(), side = coalition(g, ['usa', 'britain']);
  industries(g, { usa: 5, britain: 95, france: 70, germany: 60 });
  const payouts = Object.fromEntries(score(g, side, false, 'deadline').map(p => [p.country, p.payout]));
  assert.ok(Math.abs(payouts.usa + payouts.britain - 200) < 1e-10);
  assert.equal(payouts.france, 100);
  assert.equal(payouts.germany, 100);
  const board = leaderboard(g);
  assert.deepEqual(board.alliances.map(s => [s.rank, s.economy, s.deadlinePrizeIfNow]), [[1, 100, 200], [2, 70, 100], [3, 60, 100]]);
  assert.equal(observe(g, 'usa').leaderboard.players.find(p => p.country === 'usa').victoryShare,
    score(g, side).find(p => p.country === 'usa').victoryShare);
  g.tick = 1799;
  tick(g);
  assert.equal(g.outcome.reason, 'deadline');
  assert.equal(g.outcome.winningSide, side);
  assert.deepEqual(Object.fromEntries(g.outcome.scores.map(p => [p.country, p.payout])), payouts);
});

test('second-place tie splits the second and third prizes; tied first is a draw', () => {
  const g = game();
  industries(g, { usa: 100, britain: 70, france: 70, germany: 10 });
  const board = leaderboard(g);
  assert.deepEqual(board.alliances.map(s => [s.rank, s.deadlinePrizeIfNow]), [[1, 200], [2, 100], [2, 100], [4, 0]]);
  g.tick = 1799; tick(g);
  assert.equal(g.outcome.scores.find(p => p.country === 'britain').payout, 100);
  assert.equal(g.outcome.scores.find(p => p.country === 'france').payout, 100);
  assert.equal(g.outcome.scores.find(p => p.country === 'germany').payout, 0);
  const draw = game();
  industries(draw, { usa: 100, britain: 100, france: 10, germany: 10 });
  assert.equal(leaderboard(draw).deadlineDrawIfNow, true);
  assert.ok(leaderboard(draw).players.every(p => p.projectedDeadlinePayout === 100));
  draw.tick = 1799; tick(draw);
  assert.equal(draw.outcome.draw, true);
  assert.ok(draw.outcome.scores.every(p => p.payout === 100 && p.prestige === 0));
});

test('an empty coalition member receives no strength share and one unfilled deadline place stays unawarded', () => {
  const g = game(['usa', 'britain', 'france']);
  const side = coalition(g, ['usa', 'britain']);
  industries(g, { britain: 10, france: 9 });
  const result = score(g, side);
  assert.equal(result.find(p => p.country === 'usa').maximumShare, 0);
  assert.equal(result.find(p => p.country === 'britain').maximumShare, 300);
  assert.deepEqual(leaderboard(g).alliances.map(s => s.deadlinePrizeIfNow), [150, 75]);
});
