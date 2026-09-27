import test from 'node:test';
import assert from 'node:assert/strict';
import { act, observe } from '../src/engine.js';
import { fixture, map, replay, replayHttp } from '../scripts/replay-handplay.js';

// Historical player decisions are replayed until the new economic win condition ends the match.
const { game, report } = replay();
test('recorded decisions before economic victory conserve manpower and end exactly once',()=>{
  assert.equal(report.acceptedActions,295);
  assert.equal(report.simulatedTicks,530);
  assert.equal(report.eventLogSha256,'7b3bf2d48575269488059d6cd3ed6b4f1d0ff9727d24129880b20b6eb8dc918d');
  assert.equal(report.militaryStateSha256,'a3c30e7797817ee51c575864d151e0195764e1787ffe61c22352c1cb2f37ad5d');
  assert.deepEqual(report.ledger,{initial:659,recruited:3287,invested:192,casualties:1230,remaining:2524,tickChecks:531});
  assert.equal(game.events.filter(e=>e.type==='finished').length,1);
  assert.equal(game.events.filter(e=>e.type==='development_completed').length,14);
  assert.equal(game.outcome.winningSide,'coalition-76');
});
test('recorded private messages remain visible only to their recipients',()=>{
  const messages=game.events.filter(e=>e.type==='message');
  assert.equal(messages.length,65);
  assert.ok(messages.every(e=>e.channel==='dm'&&e.recipients.length>0));
  assert.equal(observe(game,null,0,10000).events.filter(e=>e.type==='message').length,0);
  for(const p of game.players)assert.deepEqual(observe(game,p.id,0,10000).events.filter(e=>e.type==='message').map(e=>e.id),
    messages.filter(e=>e.recipients.includes(p.id)).map(e=>e.id));
});
test('recorded recalls preserve identity and retries remain idempotent after finish',()=>{
  const recalled=game.events.filter(e=>e.type==='army_recalled');
  assert.equal(recalled.length,7);
  assert.equal(new Set(recalled.map(e=>e.armyId)).size,7);
  const before=JSON.stringify(game),first=fixture.actions[0];
  assert.equal(act(game,map,first.country,first.action,first.opId).ok,true);
  assert.equal(JSON.stringify(game),before);
});
test('recorded decisions also reproduce through authenticated HTTP seats',async()=>{
  const http=await replayHttp();
  assert.equal(http.finalStateSha256,report.finalStateSha256);
  assert.equal(http.eventLogSha256,report.eventLogSha256);
  assert.deepEqual(http.ledger,report.ledger);
});
