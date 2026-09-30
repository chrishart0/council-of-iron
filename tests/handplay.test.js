import test from 'node:test';
import assert from 'node:assert/strict';
import { act, observe } from '../src/engine.js';
import { map, fixture, replay, replayHttp } from '../scripts/replay-handplay.js';

// Recorded player decisions replayed under the current rules (explicit adapter in scripts/replay-handplay.js).
// The golden hashes are the current rules' result; they change whenever a rule changes, and are re-baselined then.
const { game, report } = replay();
test('recorded decisions conserve manpower, end exactly once and reproduce the golden log',()=>{
  // 247 since march amounts became upper bounds: recorded marches that asked for more than was free now send it.
  assert.equal(report.acceptedActions,247);
  assert.equal(report.simulatedTicks,1800);
  assert.equal(report.eventLogSha256,'a62db9afed890304b9f99245936b9b823afbdbbdf6e653a524fbe93bd11b5f1b');
  assert.equal(report.finalStateSha256,'ac12e030fb9f1801365fb3c54927a6a57969197f695341dcff59c21ed48ad2e6');
  assert.deepEqual(report.ledger,{initial:509,recruited:8039,invested:24,casualties:1282,interned:0,remaining:7242,tickChecks:1801});
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
