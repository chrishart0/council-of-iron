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
test('industrial map is connected and country starts do not overlap',()=>{
  assert.equal(map.id,'imperial-1910-v4');assert.equal(map.provinces.length,80); // v3 (79) + Hawaii
  const starts=map.countries.flatMap(c=>c.start);
  assert.equal(starts.length,new Set(starts).size);
  const byId=new Map(map.provinces.map(p=>[p.id,p]));let seen=new Set([map.provinces[0].id]);
  for(let i=0;i<map.provinces.length;i++)seen=new Set([...seen,...[...seen].flatMap(id=>byId.get(id).neighbors)]);
  assert.equal(seen.size,map.provinces.length);
});
test('lobby closes at start and all clients share retry and reservation rules',()=>{
  const g=game();assert.throws(()=>join(g,map,{profileId:'late',name:'late',country:'usa'}),/closed/);
  const order={type:'move',from:'west-us',to:'mexico',amount:6};
  const first=command(g,'usa',order,'retry');assert.deepEqual(command(g,'usa',order,'retry'),first);
  assert.equal(g.orders.length,1);assert.equal(province(g,'west-us').troops,12);
  assert.throws(()=>command(g,'usa',{...order,amount:5},'retry'),/different action/);
  tick(g);assert.equal(province(g,'west-us').troops,6);
});
test('three commands per ten ticks and invalid actions do not spend the allowance',()=>{
  const g=game();assert.throws(()=>command(g,'usa',{type:'move',from:'west-us',to:'congo',amount:1}));
  for(let i=0;i<3;i++)command(g,'usa',{type:'route',from:'west-us',to:null});
  assert.throws(()=>command(g,'usa',{type:'route',from:'west-us',to:null}),e=>e.status===429);
  advance(g,10);command(g,'usa',{type:'route',from:'west-us',to:null});
  assert.equal(observe(g,'usa').commandBudget.remaining,2);
});
test('coalition needs consent and notice, with private messages limited to recipients',()=>{
  const g=game();command(g,'usa',{type:'chat',channel:'dm',to:'britain',text:'private code'});
  assert.ok(JSON.stringify(observe(g,'britain')).includes('private code'));
  assert.ok(!JSON.stringify(observe(g,'france')).includes('private code'));
  const {proposalId}=command(g,'britain',{type:'propose',country:'france'});
  command(g,'france',{type:'accept',proposalId});advance(g,29);
  assert.equal(allied(g,'britain','france'),false);tick(g);
  assert.equal(allied(g,'britain','france'),true);
  assert.equal(player(g,'britain').joinedAt,30);
});
test('all occupied countries joining one coalition draws without a prize',()=>{
  const g=game(['usa','britain']);const {proposalId}=command(g,'usa',{type:'propose',country:'britain'});
  command(g,'britain',{type:'accept',proposalId});advance(g,30);
  assert.equal(g.outcome.reason,'negotiated_draw');
  assert.ok(g.outcome.scores.every(s=>s.prestige===0));
});
test('an eliminated ally keeps its roster and earned maturity',()=>{
  const g=game(['usa','britain','france']);const {proposalId}=command(g,'usa',{type:'propose',country:'britain'});
  command(g,'britain',{type:'accept',proposalId});advance(g,30);
  for(const p of g.provinces.filter(p=>p.owner==='usa'))p.owner=null;
  tick(g);assert.equal(player(g,'usa').eliminatedAt,31);
  const s=score(g,player(g,'britain').side).find(s=>s.country==='usa');
  assert.equal(s.maximumShare,0);assert.equal(s.maturity,1/31);
});
