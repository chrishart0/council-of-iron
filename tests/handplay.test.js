import test from 'node:test';
import assert from 'node:assert/strict';
import { act, observe } from '../src/engine.js';
import { map, fixture, replay, replayHttp } from '../scripts/replay-handplay.js';

// Recorded player decisions replayed under the current rules (explicit adapter in scripts/replay-handplay.js).
// The golden hashes are the current rules' result; they change whenever a rule changes, and are re-baselined then.
const { game, report } = replay();
test('recorded decisions conserve manpower, end exactly once and reproduce the golden log',()=>{
  assert.equal(report.acceptedActions,204);
  assert.equal(report.simulatedTicks,1800);
  assert.equal(report.eventLogSha256,'7593ccf35acc98137055fd02346da6a2bcb6a0dde73c72eb3ad61e8e886ca91b');
  assert.equal(report.finalStateSha256,'200e1bb93752974bc9be97030ec5ac91e341dfe0891296789ff2e88e7df83a8a');
  assert.deepEqual(report.ledger,{initial:509,recruited:7964,invested:24,casualties:994,interned:0,remaining:7455,tickChecks:1801});
  assert.equal(game.events.filter(e=>e.type==='finished').length,1);
  assert.equal(game.outcome.reason,'deadline');
  assert.equal(game.outcome.winningSide,'coalition-72');
});
test('the replay is deterministic: same recording, same log',()=>{
  const again=replay().report;
  assert.equal(again.eventLogSha256,report.eventLogSha256);
  assert.equal(again.finalStateSha256,report.finalStateSha256);
});
test('recorded private messages remain visible only to their recipients',()=>{
  const messages=game.events.filter(e=>e.type==='message'&&e.recipients);
  assert.equal(messages.length,fixture.actions.filter(a=>a.action.type==='chat' && a.tick<game.tick).length);
  assert.ok(messages.every(e=>e.channel==='dm'&&e.recipients.length>0));
  assert.equal(observe(game,null,0,10000).events.filter(e=>e.type==='message').length,0);
  for(const p of game.players)assert.deepEqual(observe(game,p.id,0,10000).events.filter(e=>e.type==='message'&&e.channel==='dm').map(e=>e.id),
    messages.filter(e=>e.recipients.includes(p.id)).map(e=>e.id));
});
test('retries remain idempotent after finish',()=>{
  const before=JSON.stringify(game),first=game.actionLog[0];
  assert.ok(act(game,map,first.country,first.action,first.opId));
  assert.equal(JSON.stringify(game),before);
});
test('recorded decisions also reproduce through authenticated HTTP seats',async()=>{
  const http=await replayHttp();
  assert.equal(http.finalStateSha256,report.finalStateSha256);
  assert.equal(http.eventLogSha256,report.eventLogSha256);
  assert.deepEqual(http.ledger,report.ledger);
});
