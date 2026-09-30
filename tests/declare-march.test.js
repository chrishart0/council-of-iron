import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,join,start,act,tick,observe} from '../src/engine.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
let next=0;
function game(ids=['usa','britain','france','germany']){
  const g=createGame({id:`march-${++next}`,name:'Declare and march',hostId:ids[0]},map);
  for(const id of ids)join(g,map,{profileId:id,name:id,country:id});
  start(g);
  // Britain holds Mexico, next to the USA's west-us.
  const mexico=g.provinces.find(p=>p.id==='mexico');mexico.owner='britain';mexico.troops=3;
  return g;
}
const send=(g,id,action,opId=`march-op-${++next}`)=>act(g,map,id,action,opId);
const advance=(g,n)=>{for(let i=0;i<n;i++)tick(g);};
const strike={type:'march',from:'west-us',to:'mexico',amount:5,declareWar:true};

test('declare-and-march: one action declares the war and reserves the march under one receipt',()=>{
  const g=game(),before=g.events.length;
  const result=send(g,'usa',strike,'strike-1');
  assert.equal(result.ok,true);assert.equal(result.warDeclared,true);
  assert.deepEqual(result.war.toRoster,['britain']);
  assert.ok(result.orderId.startsWith('order-'));assert.ok(result.arrivesAt>g.tick);
  assert.deepEqual(g.wars,['britain:usa']);assert.equal(g.orders.length,1);
  const added=g.events.slice(before).map(e=>e.type);
  assert.deepEqual(added,['war_declared','order_accepted'],'same events as declare_war followed by march');
  assert.ok(g.headlines[g.events.find(e=>e.type==='war_declared').id],'public war headline as for a normal declaration');
  assert.equal(g.actionLog.length,1);assert.equal(Object.keys(g.receipts).length,1);
  advance(g,1);assert.equal(g.armies.filter(a=>a.country==='usa').length,1);
});

test('declare-and-march: an invalid march leaves no war, no events and no receipt',()=>{
  const g=game();
  const snapshot=JSON.stringify(g);
  for(const bad of [{...strike,amount:0},{...strike,from:'england'},{...strike,percent:50},{...strike,declareWar:'yes'},
    {type:'march',to:'mexico',sources:[{from:'west-us',amount:1.5}],declareWar:true}])
    assert.throws(()=>send(g,'usa',bad));
  assert.equal(JSON.stringify(g),snapshot,'no half state: wars, events, serials, orders and receipts are untouched');
  // An exhausted anti-spam limit also rejects the declaration.
  for(let i=0;i<10;i++)send(g,'usa',{type:'march',from:'central-us',to:'east-us',amount:1});
  const events=g.events.length;
  assert.throws(()=>send(g,'usa',strike),e=>e.status===429);
  assert.deepEqual(g.wars,[]);assert.equal(g.events.length,events);
});

test('declare-and-march: an identical retry returns the receipt and a changed payload is refused',()=>{
  const g=game(),first=send(g,'usa',strike,'strike-retry');
  const events=g.events.length;
  assert.deepEqual(send(g,'usa',strike,'strike-retry'),first);
  assert.equal(g.events.length,events);assert.equal(g.orders.length,1);
  assert.equal(g.events.filter(e=>e.type==='war_declared').length,1);
  assert.throws(()=>send(g,'usa',{...strike,amount:4},'strike-retry'),/different action/);
  assert.throws(()=>send(g,'usa',{...strike,declareWar:false},'strike-retry'),/different action/);
});

test('declare-and-march: an alliance member declares for the whole alliance',()=>{
  const g=game();
  const {proposalId}=send(g,'usa',{type:'propose',country:'france',name:'Accord'});
  send(g,'france',{type:'accept',proposalId});advance(g,30);
  const result=send(g,'usa',strike);
  assert.equal(result.warDeclared,true);assert.deepEqual(g.wars,['britain:france','britain:usa']);assert.equal(g.orders.length,1);
});

test('declare-and-march: harmless when already at war, neutral or allied',()=>{
  const g=game();
  send(g,'usa',{type:'declare_war',country:'britain'});
  const warEvents=()=>g.events.filter(e=>e.type==='war_declared').length;
  const atWar=send(g,'usa',strike);assert.equal(atWar.warDeclared,false);assert.equal(warEvents(),1);
  const mexico=g.provinces.find(p=>p.id==='mexico');mexico.owner=null;
  assert.equal(send(g,'usa',{...strike,amount:2}).warDeclared,false);
  // Allied destination: an ordinary reinforcement, even for a coalition member.
  const allies=game();const {proposalId}=send(allies,'usa',{type:'propose',country:'britain',name:'Pact'});
  send(allies,'britain',{type:'accept',proposalId});advance(allies,30);
  const reinforce=send(allies,'usa',strike);
  assert.equal(reinforce.warDeclared,false);assert.deepEqual(allies.wars,[]);assert.equal(allies.orders.length,1);
  // Without the flag, an occupied non-enemy target is still refused as before.
  const plain=game();assert.throws(()=>send(plain,'usa',{type:'march',from:'west-us',to:'mexico',amount:5}),/Declare war/);
});

test('declare-and-march: several sources accept the same flag',()=>{
  const g=game();
  const result=send(g,'usa',{type:'march',to:'mexico',sources:[{from:'west-us',percent:50}],declareWar:true});
  assert.equal(result.warDeclared,true);assert.ok(result.groupId.startsWith('march-'));
  assert.deepEqual(g.wars,['britain:usa']);
});
