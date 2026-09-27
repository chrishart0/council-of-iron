import test from 'node:test';
import assert from 'node:assert/strict';
import { act, observe } from '../src/engine.js';
import { fixture, map, replay, replayHttp } from '../scripts/replay-handplay.js';

// A recorded game, not a new strategic controller or another balance sample.
const { game, report } = replay();

test('recorded all-seat match reproduces 343 accepted decisions and conserves manpower at every tick', () => {
  assert.equal(report.acceptedActions, 343);
  assert.equal(report.simulatedTicks, 630);
  assert.equal(report.eventLogSha256, 'd9c21e3a8e1b49618c4ad5e98a619d467405e799c53ff06dadfec2b808bea730');
  assert.deepEqual(report.ledger, { initial:659, recruited:3959, invested:192, casualties:2102, remaining:2324, tickChecks:631 });
  assert.equal(game.events.filter(e => e.type === 'order_failed').length, 0);
  assert.equal(game.events.filter(e => e.type === 'development_completed').length, 14);
});

test('all 75 recorded diplomatic messages are restricted to their original recipients', () => {
  const messages = game.events.filter(e => e.type === 'message');
  assert.equal(messages.length, 75);
  assert.ok(messages.every(e => e.channel === 'dm' && e.recipients.length > 0));
  assert.equal(observe(game, null, 0, 10000).events.filter(e => e.type === 'message').length, 0);
  for (const p of game.players) {
    assert.deepEqual(observe(game, p.id, 0, 10000).events.filter(e => e.type === 'message').map(e => e.id),
      messages.filter(e => e.recipients.includes(p.id)).map(e => e.id));
  }
});

test('independent allied orders combine on a common arrival tick and a gifted garrison survives a later attack', () => {
  const india = game.events.find(e => e.type === 'battle' && e.province === 'north-india' && e.tick === 535);
  assert.deepEqual(Object.fromEntries(india.arrivals.map(a => [a.country, a.amount])), {russia:54, qing:16});
  assert.equal(india.before, 64);
  assert.equal(india.owner, 'russia');
  assert.equal(india.troops, 6);
  const lowlands = game.events.find(e => e.type === 'battle' && e.province === 'low-countries' && e.tick === 539);
  assert.equal(lowlands.before, 136);
  assert.equal(lowlands.owner, 'britain');
  assert.equal(lowlands.troops, 16);
});

test('five recorded recall commands reverse seven armies without duplicating their 127 troops', () => {
  const recalled = game.events.filter(e => e.type === 'army_recalled');
  const completed = game.events.filter(e => e.type === 'recall_executed');
  assert.equal(completed.length, 5);
  assert.equal(recalled.length, 7);
  assert.equal(new Set(recalled.map(e => e.armyId)).size, 7);
  assert.equal(recalled.reduce((n,e) => n + e.amount, 0), 127);
  assert.equal(completed.reduce((n,e) => n + e.cancelled, 0), 1);
  assert.ok(recalled.every(e => e.arrivesAt > e.tick));
});

test('terminal state preserves in-transit survival, partial membership credit, and idempotent command receipts', () => {
  const japan = game.players.find(p => p.id === 'japan');
  assert.equal(game.provinces.filter(p => p.owner === 'japan').length, 0);
  assert.equal(japan.eliminatedAt, null);
  assert.equal(game.armies.filter(a => a.country === 'japan').reduce((n,a) => n + a.amount, 0), 9);
  const usa = game.outcome.scores.find(s => s.country === 'usa');
  assert.equal(usa.maturity, 295 / 300);
  assert.ok(Math.abs(usa.prestige - 162.22222222222223) < 1e-9);
  assert.ok(Math.abs(game.outcome.scores.reduce((n,s) => n + s.payout, 0) - 795.5555555555557) < 1e-9);
  const before = JSON.stringify(game), first = fixture.actions[0];
  assert.equal(act(game, map, first.country, first.action, first.opId).ok, true);
  assert.equal(JSON.stringify(game), before);
});

test('recorded decisions also reproduce through eight real authenticated HTTP seats and experimental result storage', async () => {
  const http = await replayHttp();
  assert.equal(http.finalStateSha256, report.finalStateSha256);
  assert.equal(http.eventLogSha256, report.eventLogSha256);
  assert.equal(http.rejectedInputs, 3);
  assert.deepEqual(http.ledger, report.ledger);
});
