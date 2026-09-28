import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame,join,start,act,observe } from '../src/engine.js';
import { createBot,decideBot,recordDecision } from '../agents/bots/controller.js';
import { position,forecast } from '../agents/bots/position.js';
import { military } from '../agents/bots/military.js';
import { foreignPolicy } from '../agents/bots/foreign-policy.js';
import { allianceValue } from '../agents/bots/diplomacy.js';
import { odds } from '../agents/bots/risk-forecast.js';
import { combatForecast } from '../public/combat.js';
import { DIFFICULTIES,PERSONALITIES } from '../public/bot-profiles.js';

function fixture() {
  const edges=[['a1','a2'],['a1','b1'],['a2','b1'],['b1','b2'],['b2','c1'],['c1','c2']];
  const map={id:'current-ai',rulesVersion:3,rules:{},countries:[
    {id:'alpha',name:'Alpha',start:['a1','a2']},{id:'beta',name:'Beta',start:['b1','b2']},{id:'gamma',name:'Gamma',start:['c1','c2']}],
    provinces:['a1','a2','b1','b2','c1','c2'].map((id,i)=>({id,name:id,x:100+i*10,y:100,neighbors:edges.filter(e=>e.includes(id)).map(e=>e.find(x=>x!==id))})),edges:edges.map(([from,to])=>({from,to}))};
  const g=createGame({id:'current-test',name:'Current rules',hostId:'alpha'},map);
  for(const c of map.countries)join(g,map,{profileId:c.id,name:c.name,country:c.id,kind:'agent'});
  start(g);g.tick=300;for(const p of g.provinces)p.nextRecruit=320;
  for(const p of map.provinces)for(const q of p.neighbors)g.travelTimes[p.id][q]=10;
  const brain=createBot('alpha',{difficulty:'standard',personality:'marshal'},19);brain.nextThinkAt=0;brain.nextDiplomacyAt=9999;
  const p=id=>g.provinces.find(p=>p.id===id),player=id=>g.players.find(p=>p.id===id),view=()=>observe(g,'alpha',brain.cursor,10000);
  const pos=()=>position(view(),map,'alpha');
  const plan=()=>military(pos(),forecast(pos()),DIFFICULTIES.standard,PERSONALITIES.marshal,brain);
  const war=()=>{g.wars=['alpha:beta','alpha:gamma'];};
  const ally=()=>{player('alpha').side='test-alliance';player('beta').side='test-alliance';};
  return {g,map,brain,p,player,view,pos,plan,war,ally};
}

test('cached public dice odds equal preview probabilities including tiny armies and industrial defense',()=>{
  for(const level of [1,2,3,4])for(const [a,d] of [[0,10],[10,0],[1,1],[2,2],[3,2],[7,9],[30,20],[90,60],[251,140]])
    assert.ok(Math.abs(odds(a,d,level).attackerWinChance-combatForecast(a,d,level).attackerWinChance)<1e-12);
});
test('current forecast treats a fortress as a probabilistic battle, not one-for-one subtraction',()=>{
  const f=fixture();f.war();f.p('b1').development=4;
  const result=forecast(f.pos()).combat('b1',311,[{country:'alpha',amount:12}]);
  assert.ok(result.confidence<.5);assert.ok(result.rounds>1);assert.equal(result.side,f.player('beta').side);
});
test('current forecast includes imminent construction and scheduled recruits without reading future dice',()=>{
  const f=fixture();f.p('b1').developing={level:4,completesAt:310};
  const before=forecast(f.pos()).at('b1',319),after=forecast(f.pos()).at('b1',320);
  assert.equal(before.development,4);assert.equal(before.troops,10);assert.equal(after.troops,14);
  const v=f.view(),b=structuredClone(f.brain);v.id='different-seeded-rolls';v.events=[];v.cursor=0;
  const original=f.view();original.events=[];original.cursor=0;
  assert.deepEqual(decideBot(v,f.map,b,{diplomacyEnabled:false}),decideBot(original,f.map,structuredClone(f.brain),{diplomacyEnabled:false}));
});
test('undeclared enemies get a lawful declaration before a feasible attack',()=>{
  const f=fixture();f.p('a1').troops=100;f.p('a2').troops=80;
  const d=f.plan();assert.equal(d.action.type,'declare_war');assert.equal(d.action.country,'beta');
  act(f.g,f.map,'alpha',d.action,'declare');recordDecision(f.brain,d,f.view());
  const next=f.plan();assert.equal(next.action.type,'attack');assert.equal(next.action.to,'b1');
  assert.doesNotThrow(()=>act(f.g,f.map,'alpha',next.action,'attack'));
});
test('equal numbers do not induce a futile attack on level-IV defenses',()=>{
  const f=fixture();f.war();f.p('b1').development=4;f.p('b1').troops=100;f.p('a1').troops=55;f.p('a2').troops=50;
  assert.notEqual(f.plan()?.action.type,'attack');
});
test('own transit reservations are deducted just like marching armies',()=>{
  const f=fixture();const v=f.view();v.commandBudget.reserved=[{type:'transit',from:'a1',amount:7}];
  const pos=position(v,f.map,'alpha');assert.equal(pos.available(pos.board.get('a1')),2);
});
test('an engaged and outmatched army can retreat before its next battle rounds',()=>{
  const f=fixture();f.war();f.p('b1').development=4;f.p('b1').troops=120;
  f.g.armies.push({id:'engaged',country:'alpha',from:'a1',to:'b1',amount:8,engaged:true,departedAt:270,arrivesAt:280});
  f.g.battles.push({id:'battle',province:'b1',attackerSide:f.player('alpha').side,startedAt:280});
  const d=f.plan();assert.equal(d.action.type,'recall');assert.equal(d.action.id,'engaged');
  assert.doesNotThrow(()=>act(f.g,f.map,'alpha',d.action,'retreat'));
});
test('a defended industrial province gets rescue priority before the incoming attack',()=>{
  const f=fixture();f.war();f.p('a2').troops=160;
  f.g.armies.push({id:'threat',country:'beta',from:'b1',to:'a1',amount:50,departedAt:290,arrivesAt:320});
  const d=f.plan();assert.equal(d.urgent,true);assert.equal(d.action.to,'a1');
  assert.doesNotThrow(()=>act(f.g,f.map,'alpha',d.action,'rescue'));
});
test('an impossible rescue evacuates before impact instead of feeding a lost garrison',()=>{
  const f=fixture();f.war();f.p('a1').troops=25;f.p('a2').troops=10;
  f.g.armies.push({id:'threat',country:'beta',from:'b1',to:'a1',amount:350,departedAt:290,arrivesAt:320});
  const d=f.plan();assert.equal(d.action.type,'move');assert.equal(d.action.from,'a1');assert.equal(d.action.to,'a2');
});
test('war votes support a reachable ally front but never grant the bot extra voting rights',()=>{
  const f=fixture();f.ally();f.p('a1').troops=200;
  act(f.g,f.map,'beta',{type:'declare_war',country:'gamma'},'ally-war');
  const d=foreignPolicy(f.pos(),f.brain);assert.equal(d.action.type,'vote_war');
  assert.doesNotThrow(()=>act(f.g,f.map,'alpha',d.action,'vote'));
});
test('peace receives breathing room; the bot does not immediately redeclare',()=>{
  const f=fixture();f.war();f.p('b1').troops=200;f.p('b2').troops=150;
  act(f.g,f.map,'beta',{type:'offer_peace',country:'alpha'},'peace');
  const d=foreignPolicy(f.pos(),f.brain);assert.equal(d.action.type,'vote_peace');
  act(f.g,f.map,'alpha',d.action,'vote-peace');f.brain.nextThinkAt=0;
  decideBot(f.view(),f.map,f.brain,{diplomacyEnabled:false});
  assert.ok(f.brain.warCooldown[f.player('beta').side]>f.g.tick);
  assert.notEqual(f.plan()?.action.type,'declare_war');
});
test('industry-weighted coalition utility rewards actual contribution rather than equal fixed slices',()=>{
  const f=fixture(),weak=allianceValue(f.pos(),f.brain,['alpha','beta']);
  for(const id of ['a1','a2'])f.p(id).development=4;
  const strong=allianceValue(f.pos(),f.brain,['alpha','beta']);assert.ok(strong>weak);
  assert.equal(allianceValue(f.pos(),f.brain,['alpha','beta','gamma']),-Infinity);
});
test('transiting allies are not mistaken for friendly garrison gifts at intermediate stops',()=>{
  const f=fixture();f.ally();f.g.armies.push({id:'passage',country:'alpha',from:'a1',to:'b1',amount:50,transit:true,
    path:['b1','a2'],pathIndex:0,origin:'a1',originDepartedAt:300,departedAt:300,arrivesAt:310});
  const future=forecast(f.pos());assert.equal(future.at('b1',311).troops,10);assert.ok(future.at('a2',321).troops>=60);
});
test('allied transit routes move old reserves back to an owned frontline without gifting',()=>{
  const f=fixture();f.ally();f.p('a1').troops=80;f.p('a2').troops=1;
  // a1 -> b1 -> a2 -> neutral b2. All other adjacent land belongs to allies.
  f.map.provinces.find(p=>p.id==='a1').neighbors=['b1'];
  f.map.provinces.find(p=>p.id==='a2').neighbors=['b1','b2'];f.g.travelTimes.a2.b2=10;
  f.p('b2').owner=null;f.p('b2').troops=100;
  const d=f.plan();assert.equal(d.action.type,'transit');assert.deepEqual(d.action.path,['b1','a2']);
  assert.doesNotThrow(()=>act(f.g,f.map,'alpha',d.action,'transit'));
});
test('leaving an alliance cannot bypass the foreign-transit lock',()=>{
  const f=fixture();f.ally();f.brain.nextDiplomacyAt=0;f.player('alpha').joinedAt=0;
  f.g.armies.push({id:'passage',country:'alpha',from:'b1',to:'a2',amount:20,transit:true,path:['b1','a2'],pathIndex:1,origin:'a1',originDepartedAt:290,departedAt:300,arrivesAt:310});
  const d=decideBot(f.view(),f.map,f.brain);assert.notEqual(d?.action.type,'leave');
});
test('a private opposing war vote is not read; a conflict response backs off rather than spamming',()=>{
  const f=fixture();f.p('a1').troops=150;f.p('a2').troops=120;
  f.player('beta').side='rivals';f.player('gamma').side='rivals';
  act(f.g,f.map,'beta',{type:'declare_war',country:'alpha'},'secret-vote');
  assert.equal(f.view().diplomacy.length,0);
  const d=f.plan();assert.equal(d.action.type,'declare_war');
  assert.throws(()=>act(f.g,f.map,'alpha',d.action,'conflict'),/already open/);
  recordDecision(f.brain,d,f.view(),false);
  assert.notEqual(f.plan()?.action.type,'declare_war');
  assert.equal(f.brain.warCooldown.rivals,f.g.tick+90);
});

test('current rules do not need the removed distanceMovement flag for coordinated attacks and industry',()=>{
  const f=fixture();assert.equal(f.g.rules.distanceMovement,undefined);f.war();f.p('a1').troops=100;f.p('a2').troops=100;
  const d=f.plan();assert.equal(d.action.type,'attack');assert.ok(d.action.sources.length);
});
test('a future ally is not treated as a legal reinforcement destination before activation',()=>{
  const f=fixture();f.p('a1').troops=120;f.p('a2').troops=100;f.g.wars=['beta:gamma'];
  f.g.proposals.push({id:'pending',status:'pending',coalition:'tomorrow',roster:['alpha','beta'],activateAt:310});
  f.g.armies.push({id:'attack-ally',country:'gamma',from:'c1',to:'b1',amount:80,departedAt:280,arrivesAt:330});
  const d=f.plan();
  assert.ok(!d || d.action.type!=='attack' || d.action.to!=='b1');
  if(d)assert.doesNotThrow(()=>act(f.g,f.map,'alpha',d.action,'lawful'));
});
