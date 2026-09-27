import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { buildReview, publicBoard } from '../src/review.js';
import { replayReader } from '../public/replay-model.js';
import { coalitionForecast, developmentForecast, operationalInsights } from '../public/insights.js';
import { createGame, join, start, tick, act, observe } from '../src/engine.js';
import { replay, map, fixture } from '../scripts/replay-handplay.js';
import { makeServer, LEGACY_MAP } from '../src/server.js';

const recorded = replay().game, original = JSON.stringify(recorded);
const review = buildReview(recorded, map), read = replayReader(review.replay);
const total = xs => xs.reduce((n,x) => n+x,0);
function fresh(board=map) {
  const g = createGame({id:'test', name:'Review test', hostId:'usa'}, board);
  for(const c of board.countries) join(g,board,{country:c.id,name:c.id,profileId:c.id,kind:'human'});
  return g;
}
function advance(g,n) { for(let i=0;i<n;i++) tick(g); }

test('report scores are the original scores and alliance scores sum the retained final roster',()=>{
  assert.equal(review.report.players.length,8);
  assert.deepEqual(review.report.outcome,fixture.expected.outcome);
  assert.equal(review.report.alliances.length,3);
  for(const a of review.report.alliances) assert.equal(a.prestige,total(review.report.players.filter(p=>a.members.includes(p.country)).map(p=>p.prestige)));
  const winner=review.report.alliances.find(a=>a.won);
  assert.equal(winner.provinces,50);assert.deepEqual(winner.members,['britain','france','usa']);
  assert.ok(Math.abs(review.report.unawardedPrize-4.444444444444343)<1e-9);
  assert.equal(JSON.stringify(recorded),original,'Building a report must not mutate its source match.');
});
test('every historical tick matches the real simulation, including movements, recalls, industry and alliances',()=>{
  const g=fresh();start(g);let index=0;
  for(let t=0;t<=recorded.tick;t++) {
    const expected=publicBoard(g),actual=read(t);
    for(const field of Object.keys(expected))assert.deepEqual(actual[field],expected[field],`${field} at ${t}`);
    while(fixture.actions[index]?.tick===g.tick){const a=fixture.actions[index++];act(g,map,a.country,a.action,a.opId);}
    tick(g);
  }
  assert.equal(read(0).players.filter(p=>!p.side.startsWith('solo:')).length,0);
  assert.notEqual(read(334).players.find(p=>p.id==='usa').side,read(335).players.find(p=>p.id==='usa').side);
  assert.equal(read(535).provinces.find(p=>p.id==='north-india').troops,6);
  assert.equal(read(539).provinces.find(p=>p.id==='low-countries').troops,16);
});
test('review excludes all private conversations, offers, waiting orders, credentials and receipts',()=>{
  const json=JSON.stringify(review);
  for(const e of recorded.events.filter(e=>e.type==='message'))assert.ok(!json.includes(e.text));
  for(const forbidden of ['"profileId"','"receipts"','"actionLog"','"recipients"','"opId"','"orders"','"proposals"','"reviewOrigin"'])assert.ok(!json.includes(forbidden),forbidden);
  assert.equal(review.report.events.some(e=>e.type==='alliance_offer'),false);
  assert.equal(review.report.events.some(e=>e.type==='message'),false);
});
test('military and economic report reconciles neutral forces, shared battles and investments',()=>{
  assert.deepEqual(review.report.totals,{battles:108,casualties:2102,recruited:3959,invested:192,upgrades:14,initialTroops:659,remainingTroops:2324});
  assert.equal(total(review.report.metrics.map(p=>p.recruited)),3959);
  assert.equal(total(review.report.metrics.map(p=>p.invested)),192);
  assert.equal(total(review.report.metrics.map(p=>p.upgrades)),14);
  assert.equal(review.report.series.at(-1).tick,630);
  assert.equal(review.report.battles.find(b=>b.province==='north-india' && b.tick===535).casualties,128);
});
test('timeline records both broken victory holds and uses the historical membership at each time',()=>{
  assert.deepEqual(review.report.events.filter(e=>e.type==='dominance_broken').map(e=>e.tick),[505,535]);
  assert.deepEqual(review.report.events.filter(e=>e.type==='dominance').map(e=>e.tick),[473,518,540]);
  assert.deepEqual(review.report.tenures.filter(t=>t.country==='usa').map(t=>[t.start,t.end]),[[0,335],[335,630]]);
  assert.equal(read(534).dominance[recorded.outcome.winningSide],518);
  assert.equal(read(535).dominance[recorded.outcome.winningSide],undefined);
});
test('scrubbing backward, to the first tick and the final tick does not mutate frames',()=>{
  const before=JSON.stringify(review.replay);
  for(const at of [630,0,539,30,335,0,630])assert.equal(read(at).tick,at);
  assert.equal(JSON.stringify(review.replay),before);
  for(const bad of [-1,1.5,631,NaN,'0',Infinity])assert.throws(()=>read(bad),/integer/);
  assert.throws(()=>replayReader({version:99,frames:[]}),/Unsupported/);
});
test('legacy matches without an initial checkpoint reconstruct only when the terminal state verifies',()=>{
  const old=structuredClone(recorded);delete old.reviewOrigin;
  assert.deepEqual(buildReview(old,map).report,review.report);
  old.provinces[0].troops++;
  assert.throws(()=>buildReview(old,map),/cannot be reproduced exactly/);
});
test('classic games, draws, two occupied seats and retained eliminated members have correct review semantics',()=>{
  const g=createGame({id:'draw',name:'Draw',hostId:'usa'},LEGACY_MAP);
  for(const id of ['usa','britain'])join(g,LEGACY_MAP,{profileId:id,name:id,country:id});
  start(g);
  const {proposalId}=act(g,LEGACY_MAP,'usa',{type:'propose',country:'britain'},'p');
  act(g,LEGACY_MAP,'britain',{type:'accept',proposalId},'a');advance(g,30);
  const r=buildReview(JSON.parse(JSON.stringify(g)),LEGACY_MAP);
  assert.ok(r.report.players.every(p=>p.prestige===0));assert.equal(r.report.alliances[0].prestige,0);assert.equal(r.report.duration,30);
  assert.equal(r.replay.map.provinces.length,64);
  const e=fresh();
  for(const p of e.provinces)p.owner='usa';
  start(e);advance(e,100);
  const ev=buildReview(e,map);assert.ok(ev.report.players.filter(p=>p.country!=='usa').every(p=>p.eliminatedAt===1));
});
test('initial checkpoint preserves a nonstandard test opening and a tampered final state is withheld',()=>{
  const g=fresh();g.rules={...g.rules,duration:40};g.provinces[0].troops=234;start(g);advance(g,40);
  assert.equal(buildReview(g,map).replay.frames[0].provinces[0].troops,234);
  g.outcome.scores[0].prestige=1234;assert.throws(()=>buildReview(g,map),/cannot be reproduced/);
});
test('live review and gameplay mutation from a replay are disallowed',()=>{
  const g=fresh();start(g);assert.throws(()=>buildReview(g,map),e=>e.status===409);
  const state=read(300);
  assert.equal(state.status,'replay');assert.equal(state.commandBudget,undefined);
  assert.throws(()=>act(state,map,'usa',{type:'develop',from:'west-us'},'no'),/./);
});
test('development payback aligns with actual recruitment ticks and includes the deadline tick',()=>{
  const g=fresh(),p=g.provinces.find(p=>p.id==='west-us');p.development=1;p.troops=100;start(g);
  const base=structuredClone(g),f=developmentForecast(observe(g,'usa'),p.id);
  assert.equal(f.completesAt,61);assert.equal(f.firstExtraAt,80);assert.equal(f.paybackAt,300);
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
  assert.equal(queued.queued,true);assert.equal(queued.completesAt,61);tick(g);
  const built=developmentForecast(observe(g,'usa'),p.id);assert.equal(built.alreadyInvested,true);assert.equal(built.completesAt,61);
});
test('admission forecasts expose combined territory and each full share without resetting incumbents',()=>{
  const at=read(305),russia=at.players.find(p=>p.id==='russia');
  const f=coalitionForecast(at,['britain','france','usa'],at.players.find(p=>p.id==='britain').side);
  assert.equal(f.land,at.provinces.filter(p=>['britain','france','usa'].includes(p.owner)).length);
  assert.equal(f.members.find(p=>p.country==='usa').maturityAtActivation,0);
  assert.equal(f.members.find(p=>p.country==='britain').keepsMaturity,true);
  assert.equal(f.members[0].maximumShare,800/3);
  const draw=coalitionForecast(at,at.players.map(p=>p.id),russia.side);assert.equal(draw.wouldDraw,true);assert.ok(draw.members.every(p=>p.fullMaturityPrestige===0));
});
test('reserve insights never pretend to forward arrivals and do not expose another player’s reservations',()=>{
  const g=fresh();start(g);const p=g.provinces.find(p=>p.id==='central-us');p.route='west-us';
  act(g,map,'usa',{type:'move',from:p.id,to:'west-us',amount:5},'send');
  const insights=operationalInsights(observe(g,'usa'));
  assert.equal(insights.routeReserves[0].available,p.troops-6);assert.match(insights.routeReserves[0].rule,/arriving reinforcements do not/);
  assert.deepEqual(operationalInsights(observe(g)),{developments:[],routeReserves:[],admissions:[]});
});
test('HTTP review is read-only, private-state safe, bounded and durable across restart',async t=>{
  const dir=mkdtempSync(pathJoin(tmpdir(),'review-test-')),dbPath=pathJoin(dir,'review.db');let app;
  async function launch(){app=makeServer({dbPath,automatic:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));}
  await launch();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  async function call(path,token){const r=await fetch(`http://127.0.0.1:${app.server.address().port}${path}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});return {status:r.status,data:await r.json()};}
  const g=structuredClone(recorded);g.id='recorded';
  const profile=app.store.register('Spectator'),token=app.store.credential(profile.id,'other-match');
  app.games.set(g.id,g);app.store.save(g);
  assert.equal((await call('/api/games/recorded/review',token)).status,403);
  const response=await call('/api/games/recorded/review');assert.equal(response.status,200);assert.equal(response.data.historyAvailable,true);
  assert.equal((await call('/api/games/recorded/replay?tick=535')).data.provinces.find(p=>p.id==='north-india').troops,6);
  for(const invalid of ['-1','631','1.1','','NaN','1e2'])assert.equal((await call(`/api/games/recorded/replay?tick=${invalid}`)).status,400);
  const publicJson=JSON.stringify((await call('/api/games/recorded/replay')).data);
  assert.ok(!publicJson.includes(profile.token));assert.ok(!publicJson.includes('profileId'));
  // A persisted materialized replay is usable without rerunning the old action log.
  delete g.actionLog;app.store.save(g);await app.close();await launch();
  assert.deepEqual((await call('/api/games/recorded/review')).data,response.data);
  assert.equal((await call('/api/games/recorded/replay?tick=630')).data.tick,630);
  const bad=structuredClone(recorded);bad.id='incompatible';delete bad.reviewOrigin;bad.provinces[0].troops+=17;
  app.games.set(bad.id,bad);
  const fallback=await call('/api/games/incompatible/review');assert.equal(fallback.status,200);assert.equal(fallback.data.historyAvailable,false);assert.deepEqual(fallback.data.outcome,recorded.outcome);
  assert.equal((await call('/api/games/incompatible/replay')).status,409);
  const live=fresh();live.id='live';app.games.set(live.id,live);assert.equal((await call('/api/games/live/review')).status,409);
});
