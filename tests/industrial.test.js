import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, marchPlan, preview, gameRules, reservedTroops, economyThreshold } from '../src/engine.js';
import { journeyPoint, distanceKm } from '../public/movement.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
const country = (g,id) => g.players.find(p=>p.id===id);
const province = (g,id) => g.provinces.find(p=>p.id===id);
function game(){const g=createGame({id:'industrial',name:'Industrial',hostId:'usa'},map);
  for(const c of map.countries)join(g,map,{profileId:c.id,name:c.id,country:c.id});
  start(g);return g;}
let id=0;const action=(g,p,a,opId=`n-${++id}`)=>act(g,map,p,a,opId);
const advance=(g,n)=>{for(let i=0;i<n;i++)tick(g);};
const total=g=>g.provinces.reduce((n,p)=>n+p.troops,0)+g.armies.reduce((n,a)=>n+a.amount,0);
test('industrial map has more European provinces, colonial footholds and explicit asymmetric industry',()=>{
  assert.ok(map.provinces.length>=50&&map.provinces.length<=64);const g=game();assert.equal(province(g,'namibia').owner,'germany');
  assert.equal(province(g,'india').owner,'britain');assert.equal(province(g,'indochina').owner,'france');
  assert.ok(province(g,'ruhr').development>province(g,'namibia').development);
  assert.equal(gameRules(g).economyShare,.6);
  assert.equal(economyThreshold(g),Math.ceil(g.provinces.filter(p=>p.owner).reduce((n,p)=>n+p.development,0)*.6));
  const byId=new Map(map.provinces.map(p=>[p.id,p]));let seen=new Set(['england']);
  for(let i=0;i<map.provinces.length;i++)seen=new Set([...seen,...[...seen].flatMap(id=>byId.get(id).neighbors)]);
  assert.equal(seen.size,map.provinces.length);
  for(const p of map.provinces)for(const n of p.neighbors){assert.ok(byId.get(n).neighbors.includes(p.id));assert.equal(g.travelTimes[p.id][n],g.travelTimes[n][p.id]);}
});
test('completed development alone can reach 60% of active industry and start a continuous hold',()=>{
  const g=createGame({id:'growth',name:'Growth',hostId:'usa'},map);
  for(const id of ['usa','britain'])join(g,map,{profileId:id,name:id,country:id});
  for(const p of g.provinces){p.owner=null;p.development=1;}
  for(const id of ['west-us','central-us'])province(g,id).owner='usa';
  for(const id of ['england','ireland'])province(g,id).owner='britain';
  province(g,'west-us').troops=40;start(g);
  assert.equal(economyThreshold(g),3);
  action(g,'usa',{type:'develop',from:'west-us'});
  advance(g,120);assert.equal(g.dominance[country(g,'usa').side],undefined);
  tick(g);assert.equal(province(g,'west-us').development,2);
  assert.equal(economyThreshold(g),3);assert.equal(g.dominance[country(g,'usa').side],121);
  advance(g,89);assert.equal(g.status,'running');tick(g);
  assert.equal(g.outcome.winningSide,country(g,'usa').side);
});
test('opponent growth can break an economic hold without changing any province owner',()=>{
  const g=game();for(const p of g.provinces){p.owner=null;p.development=1;}
  for(const id of ['west-us','central-us'])province(g,id).owner='usa';
  province(g,'west-us').development=2;
  for(const id of ['england','ireland'])province(g,id).owner='britain';
  tick(g);assert.equal(g.dominance[country(g,'usa').side],1);
  province(g,'england').development=2;tick(g);
  assert.equal(g.dominance[country(g,'usa').side],undefined);
});
test('deadline ranks economic output, even when the winner owns fewer provinces',()=>{
  const g=game();for(const p of g.provinces){p.owner=null;p.development=1;}
  for(const id of ['west-us','central-us'])province(g,id).owner='usa';
  province(g,'england').owner='britain';province(g,'england').development=3;
  g.tick=1799;tick(g);
  assert.equal(g.outcome.reason,'deadline');assert.equal(g.outcome.winningSide,country(g,'britain').side);
});
test('distance movement takes longer overseas and crosses the antimeridian by the short direction',()=>{
  const g=game();assert.ok(g.travelTimes.england.egypt>g.travelTimes.england['north-france']);
  const west=map.provinces.find(p=>p.id==='west-us'),mexico=map.provinces.find(p=>p.id==='mexico');
  const base=15+Math.ceil(distanceKm(west,mexico)/35),current=g.travelTimes['west-us'].mexico;
  assert.equal(current,Math.ceil(base*100/120),'every link is 1.2× faster than the distance table');
  assert.ok(distanceKm({lon:179,lat:0},{lon:-179,lat:0})<230);
  const r=action(g,'usa',{type:'march',from:'west-us',to:'mexico',percent:50});
  const available=province(g,'west-us').troops-1;assert.equal(r.orders[0].amount,Math.floor(available/2));
  tick(g);assert.equal(g.armies[0].arrivesAt,1+g.travelTimes['west-us'].mexico);
});
test('one group order sends every available troop from multiple owned provinces across controlled land',()=>{
  const g=game(),target=province(g,'east-us');
  for(const id of ['west-us','central-us','east-us'])province(g,id).nextRecruit=1000;
  const source=[{from:'west-us',percent:100},{from:'central-us',percent:100}];
  const plan=marchPlan(g,map,'usa',{to:'east-us',sources:source});
  assert.deepEqual(plan.sources[0].path,['central-us','east-us']);
  assert.equal(plan.sources[0].amount,11);assert.equal(plan.sources[1].amount,11);
  assert.equal(preview(g,map,'usa',{from:'west-us',to:'east-us',amount:11}).sources[0].travel,plan.sources[0].travel);
  const receipt=action(g,'usa',{type:'march',to:'east-us',sources:source},'transfer-group');
  assert.deepEqual(action(g,'usa',{type:'march',to:'east-us',sources:source},'transfer-group'),receipt);
  assert.equal(reservedTroops(g,'usa','west-us'),11);
  assert.equal(reservedTroops(g,'usa','central-us'),11);
  advance(g,receipt.arrivesAt);
  assert.equal(province(g,'west-us').troops,1);
  assert.equal(province(g,'central-us').troops,1);
  assert.equal(target.troops,36);
  assert.equal(g.armies.length,0);
});
test('long marches pass through allied land but not through foreign land',()=>{
  const g=game();province(g,'central-us').owner='britain';
  assert.throws(()=>action(g,'usa',{type:'march',from:'west-us',to:'east-us',amount:5}),/No route/);
  assert.equal(g.orders.length,0);
});
test('distant sources can join a single attack through owned intermediate land',()=>{
  const g=game();
  const sources=[{from:'east-us',percent:100},{from:'central-us',percent:100}];
  const plan=marchPlan(g,map,'usa',{to:'mexico',sources});
  assert.ok(plan.sources.find(s=>s.from==='east-us').path.includes('central-us'));
  const receipt=action(g,'usa',{type:'march',to:'mexico',sources});
  assert.equal(receipt.orders.length,2);
  assert.ok(receipt.orders.find(o=>o.from==='east-us').path.length>1);
  advance(g,receipt.arrivesAt);
  assert.ok(g.events.some(e=>e.type==='army_transited' && e.country==='usa'));
  assert.equal(g.armies.filter(a=>a.to==='mexico' && a.engaged).length,2);
});
test('multi-source plan validates atomically, reserves exact amounts, dispatches later sources, arrives together',()=>{
  const g=game(),to='mexico';const sources=['west-us','central-us'];
  assert.ok(sources.every(from=>map.provinces.find(p=>p.id===from).neighbors.includes(to)));
  const before=JSON.stringify(g);
  assert.throws(()=>action(g,'usa',{type:'march',to,sources:[{from:sources[0],amount:5},{from:'england',amount:5}]}),/not own/);
  assert.equal(JSON.stringify(g),before);
  const plan=marchPlan(g,map,'usa',{to,sources:sources.map(from=>({from,amount:5}))});
  assert.notEqual(plan.sources[0].executeAt,plan.sources[1].executeAt);
  const receipt=action(g,'usa',{type:'march',to,sources:sources.map(from=>({from,amount:5}))});
  assert.equal(reservedTroops(g,'usa','central-us'),5);
  advance(g,receipt.arrivesAt-1);assert.equal(g.armies.filter(a=>a.groupId===receipt.groupId).length,2);
  tick(g);const battle=g.battles.find(b=>b.province===to);
  assert.equal(battle.arrivals.length,2);assert.equal(battle.engaged,10);
});
test('duplicate sources, mixed units and impossible percentages are rejected',()=>{
  const g=game(),s={from:'west-us',amount:5};
  for(const sources of [[s,s],[{...s,percent:50}],[{from:'west-us',percent:0}],[{from:'west-us',percent:101}],[{from:'west-us',percent:.001}]])
    assert.throws(()=>action(g,'usa',{type:'march',to:'mexico',sources}));
});
test('recalling an outbound army reverses at its actual position and returns no troops instantly',()=>{
  const g=game();const r=action(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:8});advance(g,11);
  const army=g.armies[0],expectedPoint=journeyPoint(army,g.positions,12),before=province(g,'west-us').troops;
  action(g,'usa',{type:'recall',id:army.id});assert.equal(province(g,'west-us').troops,before);tick(g);
  assert.equal(army.returning,true);assert.deepEqual(army.startPoint,expectedPoint);assert.equal(army.arrivesAt,23);
  advance(g,10);assert.equal(g.armies.length,1);tick(g);assert.equal(g.armies.length,0);assert.equal(province(g,'mexico').owner,null);
  assert.equal(province(g,'west-us').troops,12+2);assert.equal(r.groupId,army.groupId);
});
test('a coordinated recall cancels waiting components and reverses already-dispatched armies',()=>{
  const g=game();const r=action(g,'usa',{type:'march',to:'mexico',sources:[{from:'west-us',amount:5},{from:'central-us',amount:5}]});
  tick(g);assert.equal(g.armies.length,1);assert.equal(g.orders.length,1);
  action(g,'usa',{type:'recall',id:r.groupId});tick(g);
  assert.equal(g.orders.filter(o=>o.groupId===r.groupId).length,0);assert.equal(g.armies.length,1);assert.equal(g.armies[0].returning,true);
  tick(g);assert.equal(g.armies.length,0);
});
test('recall can cancel before departure, cannot control opponents, and is retry safe',()=>{
  const g=game();const r=action(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:5});
  assert.throws(()=>action(g,'britain',{type:'recall',id:r.groupId}),e=>e.status===403);
  const recall={type:'recall',id:r.groupId};const a=action(g,'usa',recall,'stable');assert.deepEqual(action(g,'usa',recall,'stable'),a);
  tick(g);assert.equal(g.armies.length,0);assert.equal(province(g,'west-us').troops,12);
});
test('returning army must fight if its home was captured; it never teleports to another province',()=>{
  const g=game();action(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:8});advance(g,5);
  const army=g.armies[0];province(g,'west-us').owner='japan';province(g,'west-us').troops=3;
  action(g,'usa',{type:'declare_war',country:'japan'});
  action(g,'usa',{type:'recall',id:army.id});tick(g);advance(g,5);
  assert.ok(g.battles.some(b=>b.province==='west-us'),'the returning army fights for its home');
  assert.ok(!g.armies.some(a=>a.id===army.id && a.to!=='west-us'),'it never heads anywhere else');
  advance(g,20);assert.ok(!g.battles.some(b=>b.province==='west-us'));
  assert.ok(g.events.some(e=>e.type==='battle'&&e.province==='west-us'));
});
test('development spends reserved manpower, builds over time, increases production and caps at three',()=>{
  const g=game(),p=province(g,'namibia');p.troops=180;
  const r=action(g,'germany',{type:'develop',from:p.id});assert.equal(p.troops,180);assert.equal(reservedTroops(g,'germany',p.id),24);
  assert.throws(()=>action(g,'germany',{type:'develop',from:p.id}),/underway/);
  tick(g);assert.equal(p.troops,156);assert.equal(p.development,1);assert.equal(p.developing.completesAt,r.completesAt);
  advance(g,120);assert.equal(p.development,2);assert.equal(p.developing,null);const before=p.troops;
  advance(g,19);assert.equal(p.troops,before+2);
  action(g,'germany',{type:'develop',from:p.id});advance(g,181);assert.equal(p.development,3);
  assert.throws(()=>action(g,'germany',{type:'develop',from:p.id}),/fully developed/);
});
test('capture preserves completed factories but destroys an unfinished investment without a refund',()=>{
  const g=game(),p=province(g,'namibia');p.troops=25;
  action(g,'usa',{type:'declare_war',country:'germany'});
  action(g,'germany',{type:'develop',from:p.id});tick(g);assert.equal(g.economy.invested,24);
  g.armies.push({id:'invader',country:'usa',from:'west-us',to:p.id,amount:10,departedAt:0,arrivesAt:2});advance(g,6);
  assert.equal(p.owner,'usa');assert.equal(p.developing,null);assert.equal(p.development,1);
  const ruhr=province(g,'ruhr');ruhr.troops=0;g.armies.push({id:'second',country:'usa',from:'west-us',to:ruhr.id,amount:10,departedAt:0,arrivesAt:g.tick+1});advance(g,3);
  assert.equal(ruhr.development,3);assert.equal(ruhr.owner,'usa');
});
test('delayed dispatch revalidates a lost source without creating troops',()=>{
  const g=game();const r=action(g,'usa',{type:'march',to:'mexico',sources:[{from:'west-us',amount:5},{from:'east-us',amount:5}]});
  const waiting=r.orders.find(o=>o.executeAt>1);province(g,waiting.from).owner='britain';advance(g,waiting.executeAt);
  assert.equal(g.armies.length,1);assert.ok(g.events.some(e=>e.type==='order_failed'&&e.orderId===waiting.id));
});
test('save/reload during scheduled attacks, recall and construction produces the same state',()=>{
  const g=game();province(g,'namibia').troops=30;
  action(g,'germany',{type:'develop',from:'namibia'});
  const r=action(g,'usa',{type:'march',to:'mexico',sources:[{from:'west-us',amount:5},{from:'central-us',amount:5}]});advance(g,6);
  action(g,'usa',{type:'recall',id:r.groupId});const loaded=JSON.parse(JSON.stringify(g));
  advance(g,100);advance(loaded,100);assert.deepEqual(loaded,g);
});

test('recall received before the arrival tick wins that boundary; after arrival it is rejected',()=>{
  const g=game();const sent=action(g,'usa',{type:'march',from:'west-us',to:'mexico',amount:5});
  advance(g,sent.arrivesAt-1);action(g,'usa',{type:'recall',id:sent.orderId});tick(g);
  assert.equal(province(g,'mexico').owner,null);assert.equal(g.armies[0].returning,true);
  const other=game();const next=action(other,'usa',{type:'march',from:'west-us',to:'mexico',amount:5});
  advance(other,next.arrivesAt);assert.ok(other.battles.some(b=>b.province==='mexico'));
  advance(other,30);assert.equal(other.battles.length,0,'the battle is over');
  assert.throws(()=>action(other,'usa',{type:'recall',id:next.orderId}),e=>e.status===409);
});
test('lost waiting garrisons can invalidate part of a group, without invalidating other components or duplicating troops',()=>{
  const g=game();const r=action(g,'usa',{type:'march',to:'mexico',sources:[{from:'west-us',amount:5},{from:'central-us',amount:5}]});
  const delayed=r.orders.find(o=>o.executeAt>1);province(g,delayed.from).troops=2;
  advance(g,r.arrivesAt);assert.equal(g.battles.find(b=>b.province==='mexico').engaged,5);
  assert.ok(g.events.some(e=>e.type==='order_failed'&&e.orderId===delayed.id));
});
test('a complete industrial match replays exactly, including construction, grouped dispatch and recalls',async()=>{
  const {controller,STYLES}=await import('./simulation.js');
  const g=game(),bots=new Map(g.players.map((p,i)=>[p.id,controller(map,77123+i,STYLES[i%STYLES.length])]));
  while(g.status==='running'){
    if(g.tick%10===0)for(const p of g.players){const a=bots.get(p.id)(observe(g,p.id,g.sequence));if(a)action(g,p.id,a);}
    tick(g);
  }
  assert.ok(g.actionLog.some(a=>a.action.type==='develop'));
  assert.ok(g.actionLog.some(a=>a.action.type==='march'&&a.action.sources?.length>1));
  assert.ok(g.actionLog.some(a=>a.action.type==='rally'));
  assert.ok(g.actionLog.some(a=>a.action.type==='recall'));
  const replay=game();let index=0;
  while(replay.status==='running'){
    while(g.actionLog[index]?.tick===replay.tick){const a=g.actionLog[index++];act(replay,map,a.country,a.action,a.opId);}
    tick(replay);
  }
  assert.deepEqual(replay,g);
});
