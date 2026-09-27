import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,join,start,act,tick,observe,worldFeed} from '../src/engine.js';
import {buildReview} from '../src/review.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
const HTML='<img src=x onerror="alert(1)"> & <b>plan</b>';
let next=0;
/** A finished three-country match with coalition chat at send-time boundaries.
 * `reveal` simulates a room created through HTTP after the notice was introduced. */
function finishedMatch(reveal) {
  const g=createGame({id:`chat-${reveal}`,name:'Chat reveal',hostId:'usa'},map);
  if(reveal)g.rules.revealAllianceChatAfterMatch=true;
  g.rules.hold=1800; // no early domination; the deadline ends the match
  for(const id of ['usa','britain','france'])join(g,map,{profileId:id,name:id,country:id});
  start(g);
  const send=(id,action)=>act(g,map,id,action,`chat-op-${++next}`);
  const advance=n=>{for(let i=0;i<n;i++)tick(g);};
  const first=send('usa',{type:'propose',country:'france',name:'Accord'});
  send('france',{type:'accept',proposalId:first.proposalId});advance(30);
  send('usa',{type:'chat',channel:'alliance',text:HTML});
  send('france',{type:'chat',channel:'dm',to:'usa',text:'direct secret'});
  advance(10);
  send('usa',{type:'chat',channel:'world',text:'world hello'});
  send('france',{type:'leave'});advance(29);
  // Sent on the last tick of membership; the departure activates inside the next tick().
  send('france',{type:'chat',channel:'alliance',text:'farewell, Accord'});
  const live={spectator:observe(g,null),britain:observe(g,'britain'),usa:observe(g,'usa'),feed:worldFeed(g)};
  advance(1);
  assert.ok(g.players.find(p=>p.id==='france').side.startsWith('solo:'));
  advance(10);
  const second=send('france',{type:'propose',country:'britain',name:'Channel Pact'});
  send('britain',{type:'accept',proposalId:second.proposalId});advance(30);
  send('britain',{type:'chat',channel:'alliance',text:'second pact line'});
  while(g.status==='running')tick(g);
  return {g,live};
}
const flagged=finishedMatch(true),legacy=finishedMatch(false);

test('live observations never include coalition messages for spectators or non-members',()=>{
  const {live}=flagged;
  for(const view of [live.spectator,live.britain,live.feed]){
    const json=JSON.stringify(view);
    assert.ok(!json.includes('farewell, Accord'));assert.ok(!json.includes('onerror'));assert.ok(!json.includes('direct secret'));
  }
  assert.ok(JSON.stringify(live.usa).includes('farewell, Accord'),'members still receive their coalition chat');
  assert.equal(live.spectator.rules.revealAllianceChatAfterMatch,true,'agents can read the room flag from observe().rules');
});

test('finished flagged match reveals coalition chat with the side at send time and no DMs',()=>{
  const {g}=flagged;assert.equal(g.status,'finished');
  const {report,replay}=buildReview(g,map);
  assert.equal(report.allianceChatRevealed,true);
  const accord=g.coalitions.find(c=>c.name==='Accord').id,pact=g.coalitions.find(c=>c.name==='Channel Pact').id;
  assert.deepEqual(report.allianceChat.map(({tick,...m})=>m),[
    {from:'usa',side:accord,sideName:'Accord',text:HTML,untrusted:true},
    {from:'france',side:accord,sideName:'Accord',text:'farewell, Accord',untrusted:true},
    {from:'britain',side:pact,sideName:'Channel Pact',text:'second pact line',untrusted:true}]);
  assert.deepEqual(report.allianceChat.map(m=>m.tick),g.events.filter(e=>e.type==='message' && e.channel==='alliance').map(e=>e.tick));
  for(const m of report.allianceChat)assert.deepEqual(Object.keys(m).sort(),['from','side','sideName','text','tick','untrusted']);
  const json=JSON.stringify({report,replay});
  assert.ok(!json.includes('direct secret'));
  for(const forbidden of ['"recipients"','"receipts"','"actionLog"','"opId"','"proposals"','"profileId"'])assert.ok(!json.includes(forbidden),forbidden);
  assert.equal(report.events.some(e=>e.type==='message'),false,'chat is not merged into the military timeline');
});

test('player text is stored and revealed as the exact plain string',()=>{
  const {g}=flagged;
  assert.equal(g.events.find(e=>e.type==='message' && e.channel==='alliance').text,HTML);
  assert.equal(buildReview(g,map).report.allianceChat[0].text,HTML);
});

test('rooms without the flag (legacy and fixtures) keep coalition chat private after the match',()=>{
  const {g}=legacy;assert.equal(g.status,'finished');
  assert.equal(g.rules.revealAllianceChatAfterMatch,undefined);
  const review=buildReview(g,map),json=JSON.stringify(review);
  assert.equal(review.report.allianceChatRevealed,false);assert.deepEqual(review.report.allianceChat,[]);
  for(const text of ['farewell, Accord','second pact line','onerror','direct secret'])assert.ok(!json.includes(text),text);
});
