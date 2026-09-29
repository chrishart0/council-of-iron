import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, allied, score } from '../src/engine.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
const player=(g,id)=>g.players.find(p=>p.id===id);
const province=(g,id)=>g.provinces.find(p=>p.id===id);
function game(ids=map.countries.map(c=>c.id)){
  const g=createGame({id:'rules',name:'Rules',hostId:ids[0]},map);
  for(const id of ids)join(g,map,{profileId:id,name:id,country:id});start(g);return g;
}
let serial=0;const command=(g,id,action,opId=`rules-${++serial}`)=>act(g,map,id,action,opId);
const advance=(g,n)=>{for(let i=0;i<n;i++)tick(g);};
test('lobby closes at start and all clients share retry and reservation rules',()=>{
  const g=game();assert.throws(()=>join(g,map,{profileId:'late',name:'late',country:'usa'}),/closed/);
  const order={type:'march',from:'west-us',to:'mexico',amount:6};
  const first=command(g,'usa',order,'retry');assert.deepEqual(command(g,'usa',order,'retry'),first);
  assert.equal(g.orders.length,1);assert.equal(province(g,'west-us').troops,12);
  assert.throws(()=>command(g,'usa',{...order,amount:5},'retry'),/different action/);
  tick(g);assert.equal(province(g,'west-us').troops,6);
});
test('an invisible anti-spam limit allows ten orders per ten ticks; invalid actions do not count',()=>{
  const g=game();assert.throws(()=>command(g,'usa',{type:'march',from:'west-us',to:'congo',amount:1}));
  for(let i=0;i<10;i++)command(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:1});
  assert.throws(()=>command(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:1}),e=>e.status===429);
  advance(g,10);command(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:1});
  assert.equal('commandBudget' in observe(g,'usa'),false);
});
test('alliance needs consent and 30 s notice, with private messages limited to recipients',()=>{
  const g=game();command(g,'usa',{type:'chat',channel:'dm',to:'britain',text:'private code'});
  assert.ok(JSON.stringify(observe(g,'britain')).includes('private code'));
  assert.ok(!JSON.stringify(observe(g,'france')).includes('private code'));
  const {proposalId}=command(g,'britain',{type:'propose',country:'france'});
  command(g,'france',{type:'accept',proposalId});advance(g,29);
  assert.equal(allied(g,'britain','france'),false);tick(g);
  assert.equal(allied(g,'britain','france'),true);
  assert.equal(player(g,'britain').joinedAt,30);
});
test('an alliance holds at most three countries and never more than half the match',()=>{
  const three=game(['usa','britain','france']);
  assert.equal(observe(three,'usa').maxAlliance,1);
  assert.throws(()=>command(three,'usa',{type:'propose',country:'britain'}),/at least four countries/);
  const four=game(['usa','britain','france','germany']);assert.equal(observe(four,'usa').maxAlliance,2);
  const six=game(['usa','britain','france','germany','russia','ottoman']);assert.equal(observe(six,'usa').maxAlliance,3);
  const g=game();assert.equal(observe(g,'usa').maxAlliance,3);
  const found=command(g,'usa',{type:'propose',country:'britain'});command(g,'britain',{type:'accept',proposalId:found.proposalId});advance(g,30);
  for(const id of ['france']){const q=command(g,'usa',{type:'propose',country:id});
    for(const member of g.proposals.find(x=>x.id===q.proposalId).roster)command(g,member,{type:'accept',proposalId:q.proposalId});advance(g,30);}
  assert.equal(g.players.filter(p=>p.side===player(g,'usa').side).length,3);
  assert.throws(()=>command(g,'usa',{type:'propose',country:'germany'}),/at most 3 countries/);
});
test('an eliminated ally loses even when its side wins',()=>{
  const g=game(['usa','britain','france','germany']);const {proposalId}=command(g,'usa',{type:'propose',country:'britain'});
  command(g,'britain',{type:'accept',proposalId});advance(g,30);
  for(const p of g.provinces.filter(p=>p.owner==='usa'))p.owner=null;
  tick(g);assert.equal(player(g,'usa').eliminatedAt,31);
  const results=Object.fromEntries(score(g,player(g,'britain').side,false).map(s=>[s.country,s]));
  assert.deepEqual([results.usa.result,results.britain.result,results.france.result],['loss','win','loss']);
  assert.equal(results.usa.industry,0);assert.ok(results.britain.industry>0);
  assert.equal(score(g,null,true).find(s=>s.country==='usa').result,'loss');
  assert.ok(score(g,null,true).filter(s=>s.country!=='usa').every(s=>s.result==='draw'));
});
