import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createGame, join, start, act, tick, observe, preview } from '../src/engine.js';
import { CouncilClient } from '../agents/client.js';
const map=JSON.parse(readFileSync(new URL('../public/map.json',import.meta.url)));
function game() { const g=createGame({id:'regression',name:'Regression',hostId:'usa'},map);
  for(const c of map.countries)join(g,map,{profileId:c.id,name:c.id,country:c.id});start(g);return g; }
const advance=(g,n)=>{for(let i=0;i<n;i++)tick(g);};
let serial=0;
const action=(g,id,a)=>act(g,map,id,a,`reg-${++serial}`);

test('a new CLI room never inherits the previous room’s scoped credential',async t=>{
  const dir=mkdtempSync(pathJoin(tmpdir(),'council-session-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const client=new CouncilClient({sessionPath:pathJoin(dir,'test.session.json'),token:'',match:''});
  client.session={profileToken:'profile-secret',seatToken:'old-seat-secret',country:'usa',match:'old'};client.match='old';
  client.request=async()=>({id:'new'});await client.create('Next round');
  const restored=new CouncilClient({sessionPath:client.sessionPath,token:'',match:''});
  assert.equal(restored.match,'new');assert.equal(restored.token,'profile-secret');assert.equal(restored.session.country,undefined);
});
test('changing CLI identity clears the old match and country',async t=>{
  const dir=mkdtempSync(pathJoin(tmpdir(),'council-identity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const client=new CouncilClient({sessionPath:pathJoin(dir,'test.session.json'),token:'',match:'old'});
  client.request=async()=>({name:'New',token:'new-profile'});await client.register('New');
  assert.equal(client.match,'');assert.equal(client.session.seatToken,undefined);
});
test('a fulfilled admission cannot get stuck after its only missing voter is eliminated',()=>{
  const g=game();let offer=action(g,'britain',{type:'propose',country:'france',name:'Accord'});
  action(g,'france',{type:'accept',proposalId:offer.proposalId});advance(g,30);
  offer=action(g,'britain',{type:'propose',country:'usa'});
  action(g,'usa',{type:'accept',proposalId:offer.proposalId});
  assert.equal(g.proposals.find(q=>q.id===offer.proposalId).status,'open');
  for(const p of g.provinces)if(p.owner==='france')p.owner='germany';
  advance(g,2);
  const q=g.proposals.find(q=>q.id===offer.proposalId);
  assert.equal(q.status,'pending');assert.equal(q.activateAt,g.tick+30);
  advance(g,30);assert.equal(g.players.find(p=>p.id==='usa').side,g.players.find(p=>p.id==='britain').side);
});
test('declining an offer is private and does not change allegiance or create a notice',()=>{
  const g=game(),offer=action(g,'britain',{type:'propose',country:'usa'});
  assert.throws(()=>action(g,'germany',{type:'decline',proposalId:offer.proposalId}),e=>e.status===403);
  action(g,'usa',{type:'decline',proposalId:offer.proposalId});
  assert.equal(g.proposals.find(q=>q.id===offer.proposalId).status,'cancelled');
  assert.ok(g.players.find(p=>p.id==='usa').side.startsWith('solo:'));
  assert.ok(!observe(g).events.some(e=>e.proposalId===offer.proposalId));
});
test('an owner’s preview accounts for reservations without exposing them to spectators',()=>{
  const g=game();action(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:6});
  assert.throws(()=>preview(g,map,'west-us','mexico',4,'usa'),/uncommitted/);
  const own=preview(g,map,'west-us','mexico',3,'usa');assert.equal(own.remaining,1);assert.equal(own.reserved,6);
  const spectator=preview(g,map,'west-us','mexico',4);assert.equal(spectator.remaining,6);assert.equal(spectator.reserved,0);
});
test('command recovery time is authoritative and only visible to its owner',()=>{
  const g=game();for(let i=0;i<3;i++)action(g,'usa',{type:'route',from:'west-us',to:null});
  assert.equal(observe(g,'usa').commandBudget.nextRecoveryAt,10);assert.equal(observe(g).commandBudget,null);
  advance(g,10);assert.equal(observe(g,'usa').commandBudget.nextRecoveryAt,null);
});
test('cursor pagination crosses hidden events without losing a later public or private event',()=>{
  const g=game();for(let i=0;i<80;i++) { action(g,'usa',{type:'chat',channel:i%2?'world':'dm',to:'britain',text:`msg-${i}`});advance(g,10); }
  const all=observe(g,'britain',0,10000).events;const paged=[];let after=0;
  do { const part=observe(g,'britain',after,3);paged.push(...part.events);after=part.cursor;if(!part.hasMore)break; }while(true);
  assert.deepEqual(paged,all);assert.equal(after,g.sequence);assert.equal(observe(g,'britain',after).events.length,0);
});

test('British province counters stay near their namesake land, not Greenland',()=>{
  for(const id of ['england','ireland','scotland']) {
    const p=map.provinces.find(p=>p.id===id);assert.ok(p.x>600 && p.x<650 && p.y>100 && p.y<180);
  }
});
