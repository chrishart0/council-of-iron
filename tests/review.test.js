import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { buildReview, publicBoard } from '../src/review.js';
import { replayReader } from '../public/replay-model.js';
import { allianceForecast, developmentForecast, operationalInsights } from '../public/insights.js';
import { createGame, join, start, tick, act, observe } from '../src/engine.js';
import { replay, map } from '../scripts/replay-handplay.js';
import { makeServer } from '../src/server.js';

const recorded = replay().game, original = JSON.stringify(recorded);
const review = buildReview(recorded, map), read = replayReader(review.replay);
const total = xs => xs.reduce((n,x) => n+x,0);
function fresh(board=map) {
  const g = createGame({id:'test', name:'Review test', hostId:'usa'}, board);
  for(const c of board.countries) join(g,board,{country:c.id,name:c.id,profileId:c.id,kind:'human'});
  return g;
}
function advance(g,n) { for(let i=0;i<n;i++) tick(g); }

test('report results are the original saved results',()=>{
  assert.equal(review.report.players.length,8);
  assert.deepEqual(review.report.outcome,recorded.outcome);
  assert.equal(review.report.alliances.length,3);
  const winner=review.report.alliances.find(a=>a.won);
  assert.equal(winner.economy,40);assert.deepEqual(winner.members,['britain','france','usa']);
  for(const p of review.report.players)assert.equal(p.result,winner.members.includes(p.country)?'win':'loss');
  for(const p of review.report.players)assert.equal(p.industry,p.economy);
  assert.equal(JSON.stringify(recorded),original,'Building a report must not mutate its source match.');
});
test('every historical tick matches the real simulation, including movements, recalls, industry and alliances',()=>{
  const boards=[];replay({onTick:g=>boards.push(publicBoard(g))});
  assert.equal(boards.length,recorded.tick);
  for(let t=0;t<recorded.tick;t++) {
    const expected=boards[t],actual=read(t);
    for(const field of Object.keys(expected))assert.deepEqual(actual[field],expected[field],`${field} at ${t}`);
  }
  assert.equal(read(0).players.filter(p=>!p.side.startsWith('solo:')).length,0);
  assert.notEqual(read(334).players.find(p=>p.id==='usa').side,read(335).players.find(p=>p.id==='usa').side);
  assert.equal(read(1800).status,'replay');
});
test('review excludes all private conversations, offers, waiting orders, credentials and receipts',()=>{
  const json=JSON.stringify(review);
  for(const e of recorded.events.filter(e=>e.type==='message'))assert.ok(!json.includes(e.text));
  for(const forbidden of ['"profileId"','"receipts"','"actionLog"','"recipients"','"opId"','"orders"','"proposals"','"reviewOrigin"'])assert.ok(!json.includes(forbidden),forbidden);
  assert.equal(review.report.events.some(e=>e.type==='alliance_offer'),false);
  assert.equal(review.report.events.some(e=>e.type==='message'),false);
});
test('military and economic report reconciles neutral forces, shared battles and investments',()=>{
  assert.deepEqual(review.report.totals,{battles:49,casualties:969,interned:0,recruited:8054,invested:24,upgrades:1,initialTroops:509,remainingTroops:7570});
  assert.equal(total(review.report.metrics.map(p=>p.recruited)),8054);
  assert.equal(review.report.series.at(-1).tick,1800);
  // Investment and upgrades, in a short match of its own.
  const g=fresh(),p=g.provinces.find(p=>p.id==='alaska');Object.assign(p,{owner:'usa',troops:60,development:1});g.rules.duration=130;start(g);
  act(g,map,'usa',{type:'develop',from:'alaska'},'build');advance(g,130);
  const built=buildReview(g,map).report;
  assert.equal(built.totals.invested,24);assert.equal(built.totals.upgrades,1);
  assert.equal(built.metrics.find(m=>m.country==='usa').invested,24);
});
test('timeline records broken economic holds and alliance changes',()=>{
  // On the v6 board the recorded match goes to the deadline without a 60% hold.
  assert.deepEqual(review.report.events.filter(e=>e.type==='dominance').map(e=>e.tick),[]);
  assert.ok(review.report.events.some(e=>e.type==='alliance_activated' && e.tick===335 && e.roster.includes('usa')));
  // A hold broken by an opponent's growth, in a short match of its own.
  const g=createGame({id:'broken',name:'Broken hold',hostId:'usa'},map);
  for(const id of ['usa','britain'])join(g,map,{profileId:id,name:id,country:id});
  for(const p of g.provinces){p.owner=null;p.development=1;}
  for(const id of ['west-us','central-us'])g.provinces.find(p=>p.id===id).owner='usa';
  g.provinces.find(p=>p.id==='west-us').development=2;
  for(const id of ['england','ireland'])g.provinces.find(p=>p.id===id).owner='britain';
  g.provinces.find(p=>p.id==='england').troops=40;g.rules.duration=200;g.rules.hold=1800;start(g);
  act(g,map,'britain',{type:'develop',from:'england'},'grow');advance(g,200);
  const events=buildReview(g,map).report.events;
  assert.deepEqual(events.filter(e=>e.type==='dominance').map(e=>e.tick),[1]);
  assert.deepEqual(events.filter(e=>e.type==='dominance_broken').map(e=>e.tick),[121]);
});
test('scrubbing backward, to the first tick and the final tick does not mutate frames',()=>{
  const before=JSON.stringify(review.replay);
  for(const at of [1800,0,462,30,335,0,1800])assert.equal(read(at).tick,at);
  assert.equal(JSON.stringify(review.replay),before);
  for(const bad of [-1,1.5,1801,NaN,'0',Infinity])assert.throws(()=>read(bad),/integer/);
  assert.throws(()=>replayReader({version:99,frames:[]}),/Unsupported/);
});
test('a match without its recorded opening, or with a tampered final state, is withheld',()=>{
  const old=structuredClone(recorded);delete old.reviewOrigin;
  assert.throws(()=>buildReview(old,map),/no recorded opening/);
  const tampered=structuredClone(recorded);tampered.provinces[0].troops++;
  assert.throws(()=>buildReview(tampered,map),/cannot be reproduced exactly/);
});
test('draws, two occupied seats and retained eliminated members have correct review semantics',()=>{
  const g=createGame({id:'draw',name:'Draw',hostId:'usa'},map);
  for(const id of ['usa','britain'])join(g,map,{profileId:id,name:id,country:id});
  for(const p of g.provinces)if(p.owner){p.development=1;p.owner=p.owner==='usa'?'usa':'britain';}
  g.rules={...g.rules,duration:30};start(g);
  const usa=g.provinces.filter(p=>p.owner==='usa').length,britain=g.provinces.filter(p=>p.owner==='britain').length;
  for(const p of g.provinces.filter(p=>p.owner==='usa').slice(Math.min(usa,britain)))p.owner=null;
  for(const p of g.provinces.filter(p=>p.owner==='britain').slice(Math.min(usa,britain)))p.owner=null;
  g.reviewOrigin=structuredClone({...g,reviewOrigin:undefined});advance(g,30);
  const r=buildReview(JSON.parse(JSON.stringify(g)),map);
  assert.equal(r.report.outcome.draw,true);assert.ok(r.report.players.every(p=>p.result==='draw'));
  assert.equal(r.report.alliances.some(a=>a.won),false);assert.equal(r.report.duration,30);
  assert.equal(r.replay.map.provinces.length,map.provinces.length);
  const e=fresh();
  for(const p of e.provinces)p.owner='usa';
  start(e);advance(e,100);
  const ev=buildReview(e,map);assert.ok(ev.report.players.filter(p=>p.country!=='usa').every(p=>p.eliminatedAt===1));
  assert.ok(ev.report.players.filter(p=>p.country!=='usa').every(p=>p.result==='loss'));
});
test('initial checkpoint preserves a nonstandard test opening and a tampered final state is withheld',()=>{
  const g=fresh();g.rules={...g.rules,duration:40};g.provinces[0].troops=234;start(g);advance(g,40);
  assert.equal(buildReview(g,map).replay.frames[0].provinces[0].troops,234);
  g.outcome.scores[0].result='win';g.outcome.scores[0].industry+=5;assert.throws(()=>buildReview(g,map),/cannot be reproduced/);
});
test('live review and gameplay mutation from a replay are disallowed',()=>{
  const g=fresh();start(g);assert.throws(()=>buildReview(g,map),e=>e.status===409);
  const state=read(300);
  assert.equal(state.status,'replay');assert.equal(state.orders,undefined);
  assert.throws(()=>act(state,map,'usa',{type:'develop',from:'west-us'},'no'),/./);
});
test('development payback aligns with actual recruitment ticks and includes the deadline tick',()=>{
  const g=fresh(),p=g.provinces.find(p=>p.id==='west-us');p.development=1;p.troops=100;start(g);
  const base=structuredClone(g),f=developmentForecast(observe(g,'usa'),p.id);
  assert.equal(f.completesAt,121);assert.equal(f.firstExtraAt,140);assert.equal(f.paybackAt,600);
  act(g,map,'usa',{type:'develop',from:p.id},'build');
  advance(g,f.paybackAt-1);advance(base,f.paybackAt-1);
  assert.equal(g.provinces.find(v=>v.id===p.id).troops-base.provinces.find(v=>v.id===p.id).troops,-1);
  tick(g);tick(base);assert.equal(g.provinces.find(v=>v.id===p.id).troops-base.provinces.find(v=>v.id===p.id).troops,0);
  const late=observe(g,'usa');late.tick=1750;
  const last=developmentForecast(late,p.id);assert.equal(last.additionalRecruits,0);assert.equal(last.paysBackBeforeDeadline,false);
});
test('development forecast honors a queued or already-started upgrade without charging twice',()=>{
  const g=fresh(),p=g.provinces.find(p=>p.id==='alaska');p.owner='usa';p.troops=60;p.development=1;start(g);
  act(g,map,'usa',{type:'develop',from:p.id},'build');const queued=developmentForecast(observe(g,'usa'),p.id);
  assert.equal(queued.queued,true);assert.equal(queued.completesAt,121);tick(g);
  const built=developmentForecast(observe(g,'usa'),p.id);assert.equal(built.alreadyInvested,true);assert.equal(built.completesAt,121);
});
test('admission forecasts show the combined industry against the victory line; insights stay private',()=>{
  const at=read(305);
  const f=allianceForecast(at,['britain','france','usa']);
  assert.equal(f.economy,at.provinces.filter(p=>['britain','france','usa'].includes(p.owner)).reduce((n,p)=>n+p.development,0));
  assert.equal(f.threshold,Math.ceil(f.totalEconomy*.6));assert.equal(f.remaining,Math.max(0,f.threshold-f.economy));
  const g=fresh();start(g);
  assert.deepEqual(operationalInsights(observe(g)),{developments:[],admissions:[]});
});
test('HTTP review is read-only, private-state safe, bounded and durable across restart',async t=>{
  const dir=mkdtempSync(pathJoin(tmpdir(),'review-test-')),dbPath=pathJoin(dir,'review.db');let app;
  async function launch(){app=makeServer({dbPath,automatic:false,map});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));}
  await launch();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  async function call(path,token){const r=await fetch(`http://127.0.0.1:${app.server.address().port}${path}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});return {status:r.status,data:await r.json()};}
  const g=structuredClone(recorded);g.id='recorded';
  const profile=app.store.register('Spectator'),token=app.store.credential(profile.id,'other-match');
  app.games.set(g.id,g);app.store.save(g);
  assert.equal((await call('/api/games/recorded/review',token)).status,403);
  const response=await call('/api/games/recorded/review');assert.equal(response.status,200);assert.equal(response.data.historyAvailable,true);
  assert.equal((await call('/api/games/recorded/replay?tick=1800')).data.tick,1800);
  for(const invalid of ['-1','1801','1.1','','NaN','1e2'])assert.equal((await call(`/api/games/recorded/replay?tick=${invalid}`)).status,400);
  const publicJson=JSON.stringify((await call('/api/games/recorded/replay')).data);
  assert.ok(!publicJson.includes(profile.token));assert.ok(!publicJson.includes('profileId'));
  // A persisted materialized replay is usable without rerunning the old action log.
  const persisted=app.store.loadGame(g.id);assert.ok(persisted.afterAction);assert.deepEqual(persisted.actionLog,[]);
  await app.close();await launch();
  assert.deepEqual(app.games.get(g.id).events,[],'startup keeps only the finished-room shell resident');
  assert.equal(app.games.get(g.id).historyEvicted,true);
  assert.ok((await call('/api/games/recorded?after=0')).data.events.length>0,'late observers still load the recorded cursor history');
  assert.deepEqual((await call('/api/games/recorded/review')).data,response.data);
  assert.equal((await call('/api/games/recorded/replay?tick=1800')).data.tick,1800);
  const bad=structuredClone(recorded);bad.id='incompatible';delete bad.reviewOrigin;bad.provinces[0].troops+=17;
  app.games.set(bad.id,bad);
  const fallback=await call('/api/games/incompatible/review');assert.equal(fallback.status,200);assert.equal(fallback.data.historyAvailable,false);assert.deepEqual(fallback.data.outcome,recorded.outcome);
  assert.equal((await call('/api/games/incompatible/replay')).status,409);
  const live=fresh();live.id='live';app.games.set(live.id,live);assert.equal((await call('/api/games/live/review')).status,409);
});

test('completed review discloses only opted-in AI conversations under the send-time roster',()=>{
  const g=createGame({id:'public-wire',name:'Public wire',hostId:'usa'},map);
  g.rules.duration=85;g.rules.hold=1800;
  const seats=[['usa','agent','public'],['britain','agent','public'],['france','agent','private'],['germany','agent','public'],['ottoman','human','private'],['japan','agent','private']];
  for(const [country,kind,visibility] of seats)join(g,map,{profileId:country,name:country,country,kind,visibility});
  start(g);let op=0;const send=(country,action)=>act(g,map,country,action,`wire-${++op}`);
  send('usa',{type:'chat',channel:'world',text:'Public world dispatch'});
  send('france',{type:'chat',channel:'world',text:'Private world dispatch'});
  send('britain',{type:'chat',channel:'dm',to:'usa',text:'Public direct dispatch'});
  send('germany',{type:'chat',channel:'dm',to:'france',text:'Private direct dispatch'});
  send('ottoman',{type:'chat',channel:'world',text:'Human world dispatch'});
  const first=send('usa',{type:'propose',country:'britain',name:'Open Accord'});
  send('britain',{type:'accept',proposalId:first.proposalId});advance(g,30);
  send('usa',{type:'chat',channel:'alliance',text:'Public alliance dispatch'});
  const second=send('usa',{type:'propose',country:'france',name:'Mixed Accord'});
  send('britain',{type:'accept',proposalId:second.proposalId});send('france',{type:'accept',proposalId:second.proposalId});advance(g,30);
  send('usa',{type:'chat',channel:'alliance',text:'Private alliance dispatch'});
  advance(g,25);assert.equal(g.status,'finished');
  const archive=buildReview(g,map),texts=archive.report.messages.map(message=>message.text);
  assert.deepEqual(texts,['Public world dispatch','Public direct dispatch','Public alliance dispatch']);
  assert.equal(archive.report.messages.find(message=>message.channel==='dm').to,'usa');
  assert.equal(archive.report.players.find(player=>player.country==='france').visibility,'private');
  assert.ok(!JSON.stringify(archive).includes('Private alliance dispatch'));
  assert.ok(!JSON.stringify(archive.replay).includes('Public direct dispatch'));
  assert.equal(observe(g,null).events.some(event=>event.text==='Public direct dispatch'),false);
});
