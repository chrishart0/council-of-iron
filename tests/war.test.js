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
  assert.throws(()=>send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:5}),/Declare war/);
  assert.equal(g.orders.length,0);assert.equal(g.players.find(p=>p.id==='usa').orderTicks.length,before);
  const war=send(g,'usa',{type:'declare_war',country:'britain'});
  assert.deepEqual(war.toRoster,['britain']);assert.deepEqual(g.wars,['britain:usa']);
  assert.equal(send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:5}).orderId.startsWith('order-'),true);
  assert.equal(send(g,'usa',{type:'march',from:'west-us',to:'canada',amount:2}).orderId.startsWith('order-'),true);
});

test('any member speaks for its alliance: war is instant for both sides; anyone on the other side accepts peace',()=>{
  const g=game(['usa','britain','france','germany']);
  const proposal=send(g,'usa',{type:'propose',country:'france',name:'Accord'});
  send(g,'france',{type:'accept',proposalId:proposal.proposalId});advance(g,30);
  assert.equal(g.players.find(p=>p.id==='france').side,g.players.find(p=>p.id==='usa').side);
  const war=send(g,'france',{type:'declare_war',country:'britain'});
  assert.deepEqual(war.fromRoster.sort(),['france','usa']);assert.deepEqual(g.wars,['britain:france','britain:usa']);
  assert.ok(g.events.some(e=>e.type==='war_declared' && e.country==='france' && !e.recipients));
  assert.throws(()=>send(g,'usa',{type:'declare_war',country:'britain'}),/already at war/);
  province(g,'mexico').owner='britain';province(g,'mexico').troops=12;
  const move=send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:8});advance(g,2);
  assert.ok(g.armies.some(a=>a.orderId===move.orderId));
  const offer=send(g,'usa',{type:'offer_peace',country:'britain'});
  assert.throws(()=>send(g,'france',{type:'offer_peace',country:'britain'}),/already open/);
  assert.deepEqual(observe(g,'britain').peaceOffers.map(o=>o.id),[offer.offerId]);
  assert.deepEqual(observe(g,'france').peaceOffers.map(o=>o.id),[offer.offerId],'the offering side sees its own offer');
  assert.deepEqual(observe(g,'germany').peaceOffers,[]);
  assert.throws(()=>send(g,'france',{type:'accept_peace',offerId:offer.offerId}),/receiving/);
  send(g,'britain',{type:'accept_peace',offerId:offer.offerId});
  assert.equal(g.wars.length,0);assert.ok(g.armies.some(a=>a.orderId===move.orderId && a.returning));
  assert.ok(g.events.some(e=>e.type==='peace_accepted' && e.recalled>0 && e.country==='britain'));
  advance(g,g.rules.truce);
  send(g,'usa',{type:'declare_war',country:'britain'});
  const late=send(g,'usa',{type:'offer_peace',country:'britain'});advance(g,60);
  assert.ok(g.events.some(e=>e.type==='peace_expired' && e.offerId===late.offerId));
  assert.throws(()=>send(g,'britain',{type:'accept_peace',offerId:late.offerId}),/no longer open/);
});

test('battle begins on arrival and resolves over dice rounds; a small capture keeps industry',()=>{
  const g=game(['usa','britain']);
  const target=province(g,'mexico');target.owner='britain';target.troops=4;target.development=2;target.nextRecruit=1000;
  province(g,'west-us').troops=24;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const move=send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:9});
  advance(g,move.arrivesAt);
  assert.equal(target.owner,'britain');assert.equal(target.troops,4);
  assert.equal(g.battles.length,1);
  advance(g,2);assert.ok(target.troops<4 || g.armies.some(a=>a.engaged && a.amount<9),'the first round lands within two ticks (4 rounds per 5 ticks)');
  advance(g,30);
  assert.equal(g.battles.length,0);
  assert.ok(g.events.some(e=>e.type==='battle' && e.province==='mexico' && e.duration>=1));
  if(target.owner==='usa')assert.equal(target.development,2);
});

test('accepted peace pulls engaged troops out before the next combat round',()=>{
  const g=game(['usa','britain']);g.rules.hold=1800;
  const target=province(g,'mexico');target.owner='britain';target.troops=30;target.nextRecruit=1000;
  province(g,'west-us').troops=25;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const move=send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:15});
  advance(g,move.arrivesAt);
  assert.equal(g.battles.length,1);
  const peace=send(g,'usa',{type:'offer_peace',country:'britain'});
  send(g,'britain',{type:'accept_peace',offerId:peace.offerId});
  assert.ok(g.armies.some(a=>a.returning && a.country==='usa'));
  const defenders=target.troops;tick(g);
  assert.equal(g.battles.length,0);
  assert.equal(target.troops,defenders);
});
test('industrial defense bonus lowers exact capture odds and matches rolled defense dice',()=>{
  const open=combatForecast(16,16,1),fortified=combatForecast(16,16,3);
  assert.ok(open.attackerWinChance>fortified.attackerWinChance);
  assert.equal(fortified.defenseBonus,1);assert.equal(fortified.exact,true);
  const g=game(['usa','britain']),target=province(g,'mexico');
  target.owner='britain';target.troops=16;target.development=3;target.nextRecruit=1000;
  province(g,'west-us').troops=25;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const move=send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:16});
  advance(g,move.arrivesAt);advance(g,2);
  const round=g.battles[0]?.lastRound || g.events.find(e=>e.type==='battle')?.lastRound;
  assert.ok(round);
  assert.ok(round.defendDice[0]>=2);
  assert.equal(round.attackerLoss+round.defenderLoss,Math.min(round.attackDice.length,round.defendDice.length));
});
test('attack preview counts visible defender reinforcements due before arrival',()=>{
  const g=game(['usa','britain']),target=province(g,'mexico');target.owner='britain';target.troops=6;
  target.nextRecruit=g.tick+20;province(g,'west-us').troops=30;
  g.armies.push({id:'visible-reinforcement',country:'britain',from:'caribbean',to:'mexico',amount:20,departedAt:g.tick,arrivesAt:g.tick+5});
  const forecast=preview(g,map,'usa',{from:'west-us',to:'mexico',amount:20});
  assert.equal(forecast.warRequired,true,'forecast before the declaration');
  assert.equal(forecast.defenseAtArrival.incoming,20);
  assert.ok(forecast.defenseAtArrival.total>=26);
  assert.ok(forecast.combatAtArrival.attackerWinChance<forecast.combat.attackerWinChance);
});
test('allied attackers combine on one side and later arrivals reinforce the active battle',()=>{
  const g=game(['usa','france','britain','germany']);g.rules.hold=1800;
  const offer=send(g,'usa',{type:'propose',country:'france',name:'Accord'});
  send(g,'france',{type:'accept',proposalId:offer.proposalId});advance(g,30);
  send(g,'usa',{type:'declare_war',country:'britain'});
  const target=province(g,'mexico');target.owner='britain';target.troops=100;target.nextRecruit=1000;
  province(g,'central-us').owner='france';province(g,'central-us').troops=90;
  province(g,'west-us').troops=90;
  const first=send(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:60});
  advance(g,first.arrivesAt-g.tick);
  assert.equal(g.battles.length,1);assert.equal(g.armies.filter(a=>a.engaged).reduce((n,a)=>n+a.amount,0),60);
  const second=send(g,'france',{type:'march',from:'central-us',to:'mexico',amount:30});
  advance(g,second.arrivesAt-g.tick);
  assert.equal(g.battles.length,1);
  assert.ok(g.battles[0].arrivals.some(a=>a.country==='usa'));
  assert.ok(g.battles[0].arrivals.some(a=>a.country==='france'));
  assert.ok(g.armies.filter(a=>a.engaged).some(a=>a.country==='france'));
  assert.ok(g.battles[0].rounds.length>0);
});
