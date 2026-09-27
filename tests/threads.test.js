import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,join,start,act,tick,observe} from '../src/engine.js';
import {commsItems,threadOf,countryThread,allianceThread,decisionsFor,attentionFor} from '../public/feed-model.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
let op=0;
/** Britain and France allied; Germany offers Britain a pact and DMs it; Russia DMs it earlier. */
function room(){
  const g=createGame({id:'threads',name:'Threads',hostId:'britain'},map);
  for(const id of ['britain','france','germany','russia'])join(g,map,{profileId:id,name:id,country:id});
  start(g);
  const send=(id,action)=>act(g,map,id,action,`threads-${++op}`);
  const q=send('britain',{type:'propose',country:'france',name:'Entente'});send('france',{type:'accept',proposalId:q.proposalId});
  for(let i=0;i<31;i++)tick(g);
  send('russia',{type:'chat',channel:'dm',to:'britain',text:'older note'});tick(g);
  send('germany',{type:'chat',channel:'dm',to:'britain',text:'newer note'});
  send('france',{type:'chat',channel:'alliance',text:'hold the line'});
  const offer=send('germany',{type:'propose',country:'russia',name:'Iron Pact'});
  tick(g);
  return {g,send,offer};
}
const items=(g,you)=>{const o=observe(g,you);return {o,items:commsItems(o.events,o.dominanceBreaks||[],{you})};};

test('diplomatic rows and messages land in the card that answers them', () => {
  const {g}=room(),{items:mine}=items(g,'britain');
  const dm=mine.filter(i=>i.channel==='dm');
  assert.deepEqual(dm.map(i=>threadOf(i)),[{kind:'country',id:'russia'},{kind:'country',id:'germany'}]);
  const chat=mine.find(i=>i.channel==='alliance');
  assert.equal(threadOf(chat).kind,'alliance');
  assert.deepEqual(allianceThread(mine,chat.side).map(i=>i.text),['hold the line']);
  // The offer Britain made to France sits in France's card (and the alliance thread once allied).
  const offer=mine.find(i=>i.system==='offer');
  assert.ok(countryThread(mine,'france').includes(offer));
  assert.equal(countryThread(mine,'germany').filter(i=>i.type==='message').length,1);
  // Public headlines belong to no card.
  assert.ok(mine.filter(i=>i.headline).every(i=>threadOf(i)===null));
  // Germany's offer to Russia is private to them: Britain never receives it.
  assert.ok(!mine.some(i=>i.name==='Iron Pact'));
});

test('attention: decisions first, then unread messages, read per item (not by a cursor)', () => {
  const {g}=room(),{o,items:russia}=items(g,'russia');
  const offer=decisionsFor(o);
  assert.equal(offer.length,1);assert.equal(offer[0].kind,'offer');assert.equal(offer[0].country,'germany');
  const {o:bo,items:brit}=items(g,'britain');
  const list=attentionFor(bo,brit);
  assert.deepEqual(list.map(i=>[i.kind,i.card.kind,i.card.id]),[['message','country','russia'],['message','country','germany'],['message','alliance',undefined]]);
  // Reading the NEWER German DM leaves the older Russian one unread.
  const german=brit.find(i=>i.channel==='dm' && i.from==='germany');
  const after=attentionFor(bo,brit,new Set([german.seq]));
  assert.deepEqual(after.map(i=>i.card.id ?? i.card.kind),['russia','alliance']);
  assert.equal(attentionFor(o,russia)[0].kind,'offer');
  // Spectators have no attention list.
  const spectator=observe(g,null);assert.deepEqual(attentionFor(spectator,commsItems(spectator.events,[],{you:null})),[]);
});
