import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, score, preview, allied, RULES } from '../src/engine.js';
import { choose } from '../agents/policy.js';
const map=JSON.parse(readFileSync(new URL('../public/map.json',import.meta.url)));
const prov=(g,id)=>g.provinces.find(p=>p.id===id);
const person=(g,id)=>g.players.find(p=>p.id===id);
function game(ids=map.countries.map(c=>c.id)){
  const g=createGame({id:'test',name:'Test',hostId:'host'},map);
  for(const id of ids)join(g,map,{profileId:id,name:id,country:id});start(g);return g;
}
function advance(g,n){for(let i=0;i<n;i++)tick(g);}
let serial=0;
const command=(g,p,a,id=`test-${++serial}`)=>act(g,map,p,a,id);
function form(g,a='britain',b='france'){
  const {proposalId}=command(g,a,{type:'propose',country:b,name:'Accord'});
  command(g,b,{type:'accept',proposalId});advance(g,30);return person(g,a).side;
}

test('map is connected, has 64 nonempty provinces, and eight disjoint three-province starts',()=>{
  assert.equal(map.provinces.length,64);assert.equal(map.countries.length,8);
  const starts=map.countries.flatMap(c=>c.start);assert.equal(starts.length,24);assert.equal(new Set(starts).size,24);
  let seen=new Set([map.provinces[0].id]);
  for(let i=0;i<64;i++)seen=new Set([...seen,...map.provinces.filter(p=>seen.has(p.id)).flatMap(p=>p.neighbors)]);
  assert.equal(seen.size,64);
  for(const p of map.provinces){assert.ok(p.path.length>10);for(const id of p.neighbors)assert.ok(map.provinces.find(p=>p.id===id).neighbors.includes(p.id));}
});
test('equal starting budgets, lobby capacity, no mid-match seats',()=>{
  const g=game();for(const p of g.players){const land=g.provinces.filter(v=>v.owner===p.id);assert.equal(land.length,3);assert.equal(land.reduce((n,v)=>n+v.troops,0),30);}
  assert.throws(()=>join(g,map,{profileId:'late',name:'late',country:'usa'}),/closed/);
});
test('movement reserves troops, executes next tick, arrives 45 ticks later, resets recruitment on capture',()=>{
  const g=game();command(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:5});
  assert.equal(prov(g,'west-us').troops,10);tick(g);assert.equal(prov(g,'west-us').troops,5);
  assert.equal(g.armies[0].arrivesAt,46);advance(g,44);assert.equal(prov(g,'mexico').owner,null);
  tick(g);assert.equal(prov(g,'mexico').owner,'usa');assert.equal(prov(g,'mexico').troops,3);assert.equal(prov(g,'mexico').nextRecruit,66);
  advance(g,19);assert.equal(prov(g,'mexico').troops,3);tick(g);assert.equal(prov(g,'mexico').troops,4);
});
test('overcommitting and fractional, negative, zero, nonadjacent and enemy-source commands fail',()=>{
  const g=game();command(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:6});
  for(const amount of [4,-1,0,2.5,Infinity])assert.throws(()=>command(g,'usa',{type:'move',from:'west-us',to:'mexico',amount}));
  assert.throws(()=>command(g,'usa',{type:'move',from:'west-us',to:'congo',amount:1}),/connected/);
  assert.throws(()=>command(g,'usa',{type:'move',from:'england',to:'scotland',amount:1}),/not own/);
  command(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:3});tick(g);assert.equal(prov(g,'west-us').troops,1);
});
test('idempotent retries never duplicate an order and changed payloads conflict',()=>{
  const g=game(),a={type:'move',from:'west-us',to:'mexico',amount:4};
  assert.deepEqual(command(g,'usa',a,'retry'),command(g,'usa',a,'retry'));assert.equal(g.orders.length,1);
  assert.throws(()=>command(g,'usa',{...a,amount:3},'retry'),/different action/);
  assert.equal(g.actionLog.length,1);
});
test('three accepted commands per rolling ten seconds; invalid commands do not consume budget',()=>{
  const g=game();assert.throws(()=>command(g,'usa',{type:'route',from:'west-us',to:'mexico'}));
  for(let i=0;i<3;i++)command(g,'usa',{type:'route',from:'west-us',to:null});
  assert.throws(()=>command(g,'usa',{type:'route',from:'west-us',to:null}),e=>e.status===429);
  advance(g,10);command(g,'usa',{type:'route',from:'west-us',to:null});assert.equal(observe(g,'usa').commandBudget.remaining,2);
});
test('standing routes forward only new recruits and retain the final troop',()=>{
  const g=game();command(g,'usa',{type:'route',from:'west-us',to:'central-us'});advance(g,20);
  assert.equal(prov(g,'west-us').troops,10);assert.equal(g.armies.length,1);assert.equal(g.armies[0].amount,1);
  prov(g,'west-us').troops=0;advance(g,20);assert.equal(prov(g,'west-us').troops,1);
  prov(g,'central-us').owner='russia';tick(g);assert.equal(prov(g,'west-us').route,null);
});
test('equal attackers and defenders annihilate; previous owner retains empty province',()=>{
  const g=game();prov(g,'mexico').troops=7;
  g.armies=[{id:'a',country:'usa',from:'west-us',to:'mexico',amount:7,arrivesAt:1,departedAt:0}];tick(g);
  assert.equal(prov(g,'mexico').owner,null);assert.equal(prov(g,'mexico').troops,0);
});
test('three-sided combat uses largest versus combined opposition, not request order',()=>{
  for(const reverse of [false,true]){
    const g=game();prov(g,'mexico').troops=2;
    g.armies=[{id:'a',country:'usa',from:'west-us',to:'mexico',amount:12,arrivesAt:1},{id:'b',country:'russia',from:'urals',to:'mexico',amount:5,arrivesAt:1}];
    if(reverse)g.armies.reverse();tick(g);assert.equal(prov(g,'mexico').owner,'usa');assert.equal(prov(g,'mexico').troops,5);
  }
});
test('allied simultaneous attackers combine; public rotating priority breaks ownership ties',()=>{
  const g=game();form(g,'usa','russia');prov(g,'mexico').troops=2;
  g.armies=[{id:'a',country:'usa',from:'west-us',to:'mexico',amount:4,arrivesAt:31},{id:'b',country:'russia',from:'urals',to:'mexico',amount:4,arrivesAt:31}];tick(g);
  assert.equal(prov(g,'mexico').troops,6);
  const expected=observe(g).tiePriority.find(id=>['usa','russia'].includes(id));assert.equal(prov(g,'mexico').owner,expected);
});
test('formation needs consent and 30-second notice, and resets both founders',()=>{
  const g=game();advance(g,100);const {proposalId}=command(g,'britain',{type:'propose',country:'france',name:'Accord'});
  assert.equal(allied(g,'britain','france'),false);command(g,'france',{type:'accept',proposalId});advance(g,29);assert.equal(allied(g,'britain','france'),false);
  tick(g);assert.equal(allied(g,'britain','france'),true);assert.equal(person(g,'britain').joinedAt,130);assert.equal(person(g,'france').joinedAt,130);
});
test('admitting a third country needs all incumbent votes and does not reset incumbent clocks',()=>{
  const g=game();form(g);advance(g,50);const {proposalId}=command(g,'britain',{type:'propose',country:'germany'});
  command(g,'germany',{type:'accept',proposalId});advance(g,30);assert.equal(allied(g,'germany','britain'),false);
  command(g,'france',{type:'accept',proposalId});advance(g,30);assert.equal(allied(g,'germany','britain'),true);
  assert.equal(person(g,'britain').joinedAt,30);assert.equal(person(g,'germany').joinedAt,140);
});
test('departure is unilateral and cancels pending admissions instead of locking players inside',()=>{
  const g=game();form(g);const {proposalId}=command(g,'britain',{type:'propose',country:'germany'});
  command(g,'france',{type:'accept',proposalId});command(g,'germany',{type:'accept',proposalId});command(g,'france',{type:'leave'});
  assert.equal(g.proposals.find(q=>q.id===proposalId).status,'cancelled');advance(g,30);
  assert.equal(allied(g,'britain','france'),false);assert.equal(allied(g,'britain','germany'),false);
  assert.equal(person(g,'britain').joinedAt,60);assert.equal(person(g,'france').joinedAt,60);
});
test('arriving friendly troops are gifts; changed allegiance at arrival makes them hostile',()=>{
  const g=game();form(g,'usa','britain');
  g.armies=[{id:'a',country:'usa',from:'east-us',to:'england',amount:5,arrivesAt:31}];const before=prov(g,'england').troops;tick(g);
  assert.equal(prov(g,'england').owner,'britain');assert.equal(prov(g,'england').troops,before+5);
  command(g,'usa',{type:'leave'});g.armies=[{id:'b',country:'usa',from:'east-us',to:'england',amount:100,arrivesAt:61}];advance(g,30);
  assert.equal(prov(g,'england').owner,'usa');
});
test('elimination waits for in-transit troops and retains an eliminated coalition member',()=>{
  const g=game();const side=form(g,'usa','britain');
  for(const p of g.provinces.filter(p=>p.owner==='usa'))p.owner=null;
  g.armies=[{id:'a',country:'usa',from:'west-us',to:'mexico',amount:1,arrivesAt:32}];tick(g);assert.equal(person(g,'usa').eliminatedAt,null);
  tick(g);assert.equal(person(g,'usa').eliminatedAt,32);assert.equal(person(g,'usa').side,side);
  advance(g,300);const s=score(g,side).find(s=>s.country==='usa');assert.equal(s.maximumShare,400);assert.equal(s.maturity,2/300);
  assert.throws(()=>command(g,'usa',{type:'leave'}),/Eliminated/);
});
test('late-join fixed slices are not renormalized and short unchanged solo wins earn full shares',()=>{
  const g=game();g.tick=1800;
  for(const id of ['britain','france','germany','usa']){person(g,id).side='coalition';person(g,id).joinedAt=id==='usa'?1740:0;}
  const scores=score(g,'coalition');assert.equal(scores.find(p=>p.country==='usa').prestige,-60);
  assert.equal(scores.find(p=>p.country==='britain').prestige,100);
  assert.equal(scores.reduce((n,p)=>n+p.payout,0),640);
  const short=game();short.tick=90;assert.equal(score(short,person(short,'usa').side).find(p=>p.country==='usa').prestige,700);
});
test('world, DM and alliance delivery is recipient-scoped at send time; cursors do not lose messages',()=>{
  const g=game();command(g,'usa',{type:'chat',channel:'dm',to:'britain',text:'PRIVATE_UNIQUE'});
  assert.ok(observe(g,'britain').events.some(e=>e.text==='PRIVATE_UNIQUE'));assert.ok(!JSON.stringify(observe(g,'france')).includes('PRIVATE_UNIQUE'));assert.ok(!JSON.stringify(observe(g)).includes('PRIVATE_UNIQUE'));
  const side=form(g,'usa','britain');command(g,'usa',{type:'chat',channel:'alliance',text:'OLD_ALLIANCE_SECRET'});
  person(g,'france').side=side;assert.ok(!JSON.stringify(observe(g,'france')).includes('OLD_ALLIANCE_SECRET'));
  person(g,'britain').side='new-solo';advance(g,10);command(g,'usa',{type:'chat',channel:'alliance',text:'NEW_ALLIANCE_SECRET'});
  assert.ok(!JSON.stringify(observe(g,'britain')).includes('NEW_ALLIANCE_SECRET'));
  let cursor=0,events=[];do{const v=observe(g,'usa',cursor,2);events.push(...v.events);cursor=v.cursor;if(!v.hasMore)break;}while(true);
  assert.equal(new Set(events.map(e=>e.id)).size,events.length);assert.equal(cursor,g.sequence);
  assert.ok(events.some(e=>e.text==='PRIVATE_UNIQUE'));
});
test('chat length, channel and cross-channel cooldown are enforced',()=>{
  const g=game();assert.throws(()=>command(g,'usa',{type:'chat',channel:'world',text:'x'.repeat(501)}));
  command(g,'usa',{type:'chat',channel:'world',text:'Hello'});
  assert.throws(()=>command(g,'usa',{type:'chat',channel:'dm',to:'britain',text:'Hello again'}),e=>e.status===429);
  advance(g,10);command(g,'usa',{type:'chat',channel:'dm',to:'britain',text:'Now permitted'});
});
test('all original seats in one coalition ends in a draw, not free winning points',()=>{
  const g=game(['usa','britain']);form(g,'usa','britain');assert.equal(g.status,'finished');assert.equal(g.outcome.reason,'negotiated_draw');
  assert.ok(g.outcome.scores.every(s=>s.prestige===0));
});
test('domination needs a continuous 90-second hold and computes outcome exactly once',()=>{
  const g=game();for(const p of g.provinces.slice(0,39))p.owner='usa';tick(g);advance(g,88);assert.equal(g.status,'running');
  tick(g);assert.equal(g.status,'running');tick(g);assert.equal(g.status,'finished');assert.equal(g.outcome.reason,'domination');
  const sequence=g.sequence;advance(g,100);assert.equal(g.sequence,sequence);
});
test('falling below threshold resets the domination timer',()=>{
  const g=game();for(const p of g.provinces)p.owner=null;
  for(const p of g.provinces.slice(0,39))p.owner='usa';
  // Keep other players alive with in-flight armies to avoid unrelated elimination bookkeeping.
  tick(g);advance(g,50);g.provinces[0].owner=null;tick(g);assert.equal(g.dominance[person(g,'usa').side],undefined);
  g.provinces[0].owner='usa';tick(g);assert.equal(g.dominance[person(g,'usa').side],53);
});
test('deadline resolves due arrivals before counting land and does not execute future arrivals',()=>{
  const g=game();g.tick=1799;g.armies=[{id:'last',country:'usa',from:'west-us',to:'mexico',amount:5,arrivesAt:1800},
    {id:'late',country:'russia',from:'siberia',to:'mongolia',amount:100,arrivesAt:1801}];tick(g);
  assert.equal(g.outcome.winningSide,person(g,'usa').side);assert.equal(prov(g,'mongolia').owner,null);
});
test('equal territory at the deadline is a draw, without an army-count tie-breaker',()=>{
  const g=game();g.tick=1799;prov(g,'west-us').troops=10000;tick(g);assert.equal(g.outcome.draw,true);
});
test('pending changes after the deadline confer no membership',()=>{
  const g=game();g.tick=1790;const {proposalId}=command(g,'usa',{type:'propose',country:'britain'});command(g,'britain',{type:'accept',proposalId});advance(g,10);
  assert.equal(allied(g,'usa','britain'),false);assert.equal(g.outcome.draw,true);
});
test('observations expose no credentials or profile IDs and preview has the same military facts',()=>{
  const g=game(),v=observe(g,'usa');assert.ok(!JSON.stringify(v).includes('profileId'));assert.ok(!('receipts' in v));assert.ok(!('actionLog' in v));
  const p=preview(g,map,'west-us','mexico',5);assert.equal(p.remaining,5);assert.match(p.summary,/3 surviving/);
});
test('eight practice policies complete a match; invariants hold; accepted action log replays deterministically',()=>{
  const g=game();
  while(g.status==='running'){
    if(g.tick%5===0)for(const p of g.players){const a=choose(observe(g,p.id,g.sequence),map,p.id);if(a)command(g,p.id,a);}
    tick(g);
    for(const p of g.provinces)assert.ok(Number.isInteger(p.troops) && p.troops>=0);
    for(const a of g.armies)assert.ok(Number.isInteger(a.amount) && a.amount>0);
  }
  assert.ok(g.outcome.tick<=RULES.duration);assert.ok(g.events.some(e=>e.type==='battle'));
  const replay=game();let i=0;
  while(replay.status==='running'){
    while(g.actionLog[i]?.tick===replay.tick){const a=g.actionLog[i++];act(replay,map,a.country,a.action,a.opId);}
    tick(replay);
  }
  assert.deepEqual(replay.outcome,g.outcome);assert.deepEqual(replay.provinces,g.provinces);assert.deepEqual(replay.events,g.events);
});
