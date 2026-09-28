import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,join,start,act,tick,observe} from '../src/engine.js';
import {commsItems,decisionsFor} from '../public/feed-model.js';
import {inbox} from '../public/comms-model.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
let op=0;
/** Britain and France allied; Germany offers Russia a pact and DMs Britain; Russia DMs Britain earlier. */
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

test('diplomatic rows and messages land in the conversation that answers them', () => {
  const {g}=room(),{o,items:mine}=items(g,'britain');
  assert.deepEqual(mine.filter(i=>i.channel==='dm').map(i=>i.threads),[['dm','dm:russia'],['dm','dm:germany']]);
  const side=o.players.find(p=>p.id==='britain').side;
  assert.deepEqual(mine.find(i=>i.channel==='alliance').threads,[`alliance:${side}`]);
  // The offer Britain made to France sits in the conversation with France.
  assert.ok(mine.find(i=>i.system==='offer').threads.includes('dm:france'));
  // Public headlines belong to World only; Germany's offer to Russia is private to them.
  assert.ok(mine.filter(i=>i.headline).every(i=>i.threads.join()==='world'));
  assert.ok(!mine.some(i=>i.name==='Iron Pact'));
  const {o:ro}=items(g,'russia'),offer=decisionsFor(ro);
  assert.equal(offer.length,1);assert.equal(offer[0].kind,'offer');assert.equal(offer[0].country,'germany');
  assert.deepEqual(decisionsFor(observe(g,null)),[],'spectators decide nothing');
});

test('a peace offer is a decision for everyone on the other side, and closes once accepted', () => {
  const {g,send}=room();
  send('germany',{type:'declare_war',country:'britain'});tick(g);
  const offer=send('germany',{type:'offer_peace',country:'france'});tick(g);
  for(const id of ['britain','france']){
    const o=observe(g,id),[d]=decisionsFor(o);
    assert.deepEqual([d.kind,d.id,d.country],['peace_offer',offer.offerId,'germany']);
    const row=inbox(o,{history:o.events}).rows.find(r=>r.item.system==='peace_offer');
    assert.equal(row.tier,'action');assert.equal(row.pending,true);assert.equal(row.thread,'alliance');
  }
  const germany=observe(g,'germany'),own=inbox(germany,{history:germany.events}).rows.find(r=>r.item.system==='peace_offer');
  assert.equal(own.mine,true);assert.equal(own.pending,false);assert.equal(own.status,'waiting');assert.equal(own.thread,'dm:britain');
  assert.deepEqual(decisionsFor(germany),[],'the side that offered does not decide');
  send('france',{type:'accept_peace',offerId:offer.offerId});
  const after=observe(g,'britain'),row=inbox(after,{history:after.events}).rows.find(r=>r.item.system==='peace_offer');
  assert.equal(row.status,'accepted');assert.equal(row.pending,false);assert.deepEqual(decisionsFor(after),[]);
  assert.deepEqual(after.wars,[]);
});
