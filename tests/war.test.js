import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,join,start,act,tick,observe,preview} from '../src/engine.js';
import {combatForecast} from '../public/combat.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
let next=0;
function game(ids=['usa','britain','france']){
  const g=createGame({id:`war-${++next}`,name:'War rules',hostId:ids[0]},map);
  for(const id of ids)join(g,map,{profileId:id,name:id,country:id});
  start(g);return g;
}
const send=(g,id,action)=>act(g,map,id,action,`war-test-${++next}`);
const advance=(g,n)=>{for(let i=0;i<n;i++)tick(g);};
const province=(g,id)=>g.provinces.find(p=>p.id===id);

test('occupied attacks need war; neutral land remains open and failed orders reserve nothing',()=>{
  const g=game();province(g,'mexico').owner='britain';province(g,'mexico').troops=2;
  const before=g.players.find(p=>p.id==='usa').orderTicks.length;
  assert.throws(()=>send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:5}),/Declare war/);
  assert.equal(g.orders.length,0);assert.equal(g.players.find(p=>p.id==='usa').orderTicks.length,before);
  const war=send(g,'usa',{type:'declare_war',country:'britain'});
  assert.equal(war.status,'enacted');assert.deepEqual(g.wars,['britain:usa']);
  assert.equal(send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:5}).orderId.startsWith('order-'),true);
  assert.equal(send(g,'usa',{type:'move',from:'west-us',to:'west-canada',amount:2}).orderId.startsWith('order-'),true);
});

test('coalition war and peace need majorities; treaty recalls the offensive and expires on the game clock',()=>{
  const g=game();
  const proposal=send(g,'usa',{type:'propose',country:'france',name:'Accord'});
  send(g,'france',{type:'accept',proposalId:proposal.proposalId});advance(g,30);
  assert.equal(g.players.find(p=>p.id==='france').side,g.players.find(p=>p.id==='usa').side);
  const vote=send(g,'usa',{type:'declare_war',country:'britain'});
  assert.equal(vote.status,'voting');assert.equal(g.wars.length,0);
  const privateView=observe(g,'britain');assert.equal(privateView.diplomacy.length,0);
  send(g,'france',{type:'vote_war',motionId:vote.motionId});assert.deepEqual(g.wars,['britain:france','britain:usa']);
  province(g,'mexico').owner='britain';province(g,'mexico').troops=12;
  const move=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:8});advance(g,2);
  assert.ok(g.armies.some(a=>a.orderId===move.orderId));
  const peace=send(g,'usa',{type:'offer_peace',country:'britain'});
  assert.equal(peace.status,'voting');send(g,'france',{type:'vote_peace',motionId:peace.motionId});
  assert.equal(g.diplomacy.find(m=>m.id===peace.motionId).status,'offered');
  send(g,'britain',{type:'vote_peace',motionId:peace.motionId});
  assert.equal(g.wars.length,0);assert.ok(g.armies.some(a=>a.orderId===move.orderId && a.returning));
  assert.ok(g.events.some(e=>e.type==='peace_accepted' && e.recalled>0));
  const second=send(g,'usa',{type:'declare_war',country:'britain'});advance(g,60);
  assert.equal(g.diplomacy.find(m=>m.id===second.motionId).status,'expired');
  assert.throws(()=>send(g,'france',{type:'vote_war',motionId:second.motionId}),/no longer open/);
});

test('battle begins on arrival and resolves over dice rounds; a small capture keeps industry',()=>{
  const g=game(['usa','britain']);
  const target=province(g,'mexico');target.owner='britain';target.troops=4;target.development=2;target.nextRecruit=1000;
  province(g,'west-us').troops=24;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const move=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:9});
  advance(g,move.arrivesAt);
  assert.equal(target.owner,'britain');assert.equal(target.troops,4);
  assert.equal(g.battles.length,1);
  tick(g);assert.ok(target.troops<4 || g.armies.some(a=>a.engaged && a.amount<9));
  advance(g,30);
  assert.equal(g.battles.length,0);
  assert.ok(g.events.some(e=>e.type==='battle' && e.province==='mexico' && e.duration>=1));
  if(target.owner==='usa')assert.equal(target.development,2);
});

test('allied transit preserves troop ownership and blocks alliance departure while crossing',()=>{
  const g=game(['usa','france','britain']);
  const proposal=send(g,'usa',{type:'propose',country:'france',name:'Accord'});
  send(g,'france',{type:'accept',proposalId:proposal.proposalId});advance(g,30);
  province(g,'central-us').owner='france';province(g,'central-us').troops=3;province(g,'central-us').nextRecruit=1000;
  province(g,'west-us').troops=20;
  const amount=6;
  const transit=send(g,'usa',{type:'transit',from:'west-us',path:['central-us','east-us'],amount});
  tick(g);
  assert.equal(province(g,'west-us').troops,14);
  assert.throws(()=>send(g,'france',{type:'leave'}),/inside an ally/);
  advance(g,transit.arrivesAt-g.tick);
  assert.equal(province(g,'central-us').owner,'france');
  assert.equal(province(g,'central-us').troops,3);
  assert.equal(province(g,'east-us').owner,'usa');
  assert.ok(province(g,'east-us').troops>=amount);
  assert.equal(g.armies.some(a=>a.transit),false);
});

test('large captures usually damage one industry level while the floor stays at I',()=>{
  let captured=0,damaged=0;
  for(let i=0;i<20;i++){
    const g=game(['usa','britain']);g.id=`large-industry-${i}`;g.rules.hold=1800;
    const target=province(g,'mexico');target.owner='britain';target.troops=40;target.development=3;target.nextRecruit=1000;
    province(g,'west-us').troops=130;
    send(g,'usa',{type:'declare_war',country:'britain'});
    const move=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:110});
    advance(g,move.arrivesAt+120);
    if(target.owner==='usa'){captured++;if(target.development===2)damaged++;}
    assert.ok(target.development>=1);
  }
  assert.equal(captured,20);
  assert.ok(damaged>=15,`expected damage in most large captures; observed ${damaged}`);
});

test('accepted peace pulls engaged troops out before the next combat round',()=>{
  const g=game(['usa','britain']);g.rules.hold=1800;
  const target=province(g,'mexico');target.owner='britain';target.troops=30;target.nextRecruit=1000;
  province(g,'west-us').troops=25;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const move=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:15});
  advance(g,move.arrivesAt);
  assert.equal(g.battles.length,1);
  const peace=send(g,'usa',{type:'offer_peace',country:'britain'});
  send(g,'britain',{type:'vote_peace',motionId:peace.motionId});
  assert.ok(g.armies.some(a=>a.returning && a.country==='usa'));
  const defenders=target.troops;tick(g);
  assert.equal(g.battles.length,0);
  assert.equal(target.troops,defenders);
});
test('industrial defense bonus lowers exact capture odds and matches rolled defense dice',()=>{
  const open=combatForecast(16,16,1),fortified=combatForecast(16,16,4);
  assert.ok(open.attackerWinChance>fortified.attackerWinChance);
  assert.equal(fortified.defenseBonus,2);assert.equal(fortified.exact,true);
  const g=game(['usa','britain']),target=province(g,'mexico');
  target.owner='britain';target.troops=16;target.development=4;target.nextRecruit=1000;
  province(g,'west-us').troops=25;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const move=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:16});
  advance(g,move.arrivesAt);tick(g);
  const round=g.battles[0]?.lastRound || g.events.find(e=>e.type==='battle')?.lastRound;
  assert.ok(round);
  assert.ok(round.defendDice[0]>=3);
  assert.equal(round.attackerLoss+round.defenderLoss,Math.min(round.attackDice.length,round.defendDice.length));
});
test('attack preview counts visible defender reinforcements due before arrival',()=>{
  const g=game(['usa','britain']),target=province(g,'mexico');target.owner='britain';target.troops=6;
  target.nextRecruit=g.tick+20;province(g,'west-us').troops=30;
  g.armies.push({id:'visible-reinforcement',country:'britain',from:'central-america',to:'mexico',amount:20,departedAt:g.tick,arrivesAt:g.tick+5});
  const forecast=preview(g,map,'west-us','mexico',20,'usa');
  assert.equal(forecast.defenseAtArrival.incoming,20);
  assert.ok(forecast.defenseAtArrival.total>=26);
  assert.ok(forecast.combatAtArrival.attackerWinChance<forecast.combat.attackerWinChance);
});
test('allied attackers combine on one side and later arrivals reinforce the active battle',()=>{
  const g=game(['usa','france','britain']);g.rules.hold=1800;
  const offer=send(g,'usa',{type:'propose',country:'france',name:'Accord'});
  send(g,'france',{type:'accept',proposalId:offer.proposalId});advance(g,30);
  const motion=send(g,'usa',{type:'declare_war',country:'britain'});
  send(g,'france',{type:'vote_war',motionId:motion.motionId});
  const target=province(g,'mexico');target.owner='britain';target.troops=100;target.nextRecruit=1000;
  province(g,'central-us').owner='france';province(g,'central-us').troops=90;
  province(g,'west-us').troops=90;
  const first=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:20});
  const second=send(g,'france',{type:'move',from:'central-us',to:'mexico',amount:30,arriveAt:first.arrivesAt+3});
  advance(g,first.arrivesAt-g.tick);
  assert.equal(g.battles.length,1);assert.equal(g.armies.filter(a=>a.engaged).reduce((n,a)=>n+a.amount,0),20);
  advance(g,second.arrivesAt-g.tick);
  assert.equal(g.battles.length,1);
  assert.ok(g.battles[0].arrivals.some(a=>a.country==='usa'));
  assert.ok(g.battles[0].arrivals.some(a=>a.country==='france'));
  assert.ok(g.armies.filter(a=>a.engaged).some(a=>a.country==='france'));
  assert.ok(g.battles[0].rounds.length>0);
});
