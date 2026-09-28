import test from 'node:test';
import assert from 'node:assert/strict';
import { act, observe } from '../src/engine.js';
import { map, replay, replayHttp } from '../scripts/replay-handplay.js';

// Recorded player decisions replayed under the current rules (explicit adapter in scripts/replay-handplay.js).
// The golden hashes are the current rules' result; they change whenever a rule changes, and are re-baselined then.
const { game, report } = replay();
test('recorded decisions conserve manpower, end exactly once and reproduce the golden log',()=>{
  assert.equal(report.acceptedActions,281);
  assert.equal(report.simulatedTicks,622);
  assert.equal(report.eventLogSha256,'14a44f399ce25ad6f187193fa639c9fe9cdc1c98783a76208ead6167e08f4259');
  assert.equal(report.finalStateSha256,'71d3a109978824fad690adf5774e461b36a9097b2ae5e65738922c8854f278c3');
  assert.deepEqual(report.ledger,{initial:661,recruited:3663,invested:0,casualties:1404,interned:0,remaining:2920,tickChecks:623});
  assert.equal(game.events.filter(e=>e.type==='finished').length,1);
  assert.equal(game.outcome.reason,'domination');
  assert.equal(game.outcome.winningSide,'coalition-83');
});
test('the replay is deterministic: same recording, same log',()=>{
  const again=replay().report;
  assert.equal(again.eventLogSha256,report.eventLogSha256);
  assert.equal(again.finalStateSha256,report.finalStateSha256);
});
test('recorded private messages remain visible only to their recipients',()=>{
  const messages=game.events.filter(e=>e.type==='message'&&e.recipients);
  assert.equal(messages.length,75);
  assert.ok(messages.every(e=>e.channel==='dm'&&e.recipients.length>0));
  const opening=game.events.filter(e=>e.type==='message'&&!e.recipients);
  assert.equal(opening.length,8);assert.ok(opening.every(e=>e.channel==='world'));
  assert.equal(observe(game,null,0,10000).events.filter(e=>e.type==='message').length,8);
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
