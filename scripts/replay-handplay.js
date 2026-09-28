/** Replay the recorded single-controller decisions (tests/fixtures/handplay-20260927.json.gz)
 * under the CURRENT rules and map. This does NOT generate new strategy: every submitted order is a
 * recorded one. The recording predates formal war, rally points and the current timings, so a small,
 * explicit adapter bridges it (see adapt()):
 *   - before a recorded march into a non-allied country the mover declares war (a coalition's other
 *     members approve the motion), exactly the orders a player would have to add today;
 *   - recorded alliance-offer IDs are mapped to the offers the replay actually created, in order;
 *   - every seat locks a fixed leader name and introduction in the opening council;
 *   - recorded orders that the current rules reject (too few troops, lost source, stale recall) are
 *     skipped and counted, never forced.
 * Default: deterministic engine replay. --http: the same adapted orders through eight authenticated
 * HTTP seats with a locally stepped clock and no public advance-time endpoint.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, join, start, act, tick, sides, beginOpening, lockOpening, RuleError } from '../src/engine.js';

export const fixture = JSON.parse(gunzipSync(readFileSync(new URL('../tests/fixtures/handplay-20260927.json.gz', import.meta.url))));
export const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
export const projection = g => ({ tick:g.tick, status:g.status, provinces:g.provinces, armies:g.armies, sides:sides(g), outcome:g.outcome });
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const troopTotal = g => g.provinces.reduce((n,p)=>n+p.troops,0)+g.armies.reduce((n,a)=>n+a.amount,0);
const counts = (items,key) => items.reduce((result,item)=>{const k=key(item);result[k]=(result[k]||0)+1;return result;},{});
export const introduction = id => ({ leaderName:`Recorded ${id}`, openingMessage:`${id} replays its recorded decisions.` });
/** Recorded accept IDs, in creation order; the n-th recorded propose created the n-th of them. */
const recordedOffers=[...new Set(fixture.actions.filter(a=>a.action.type==='accept').map(a=>a.action.proposalId))]
  .sort((a,b)=>Number(a.split('-')[1])-Number(b.split('-')[1]));
/** The orders to submit for one recorded action, in order: [{country, action, opId}]. */
export function adapt(g, a, offers) {
  const action=structuredClone(a.action),out=[];
  if(action.type==='accept')action.proposalId=offers.map.get(action.proposalId) ?? action.proposalId;
  if(['move','attack'].includes(action.type)) {
    const owner=g.provinces.find(p=>p.id===action.to)?.owner,me=g.players.find(p=>p.id===a.country),them=g.players.find(p=>p.id===owner);
    if(them && them.side!==me.side && !(g.wars||[]).includes([me.id,them.id].sort().join(':'))) {
      const roster=g.players.filter(p=>p.side===me.side && p.eliminatedAt===null);
      if(roster.length===1)action.declareWar=true;
      else out.push({country:me.id,action:{type:'declare_war',country:them.id},opId:`${a.opId}-war`,votes:roster.filter(p=>p.id!==me.id).map(p=>p.id)});
    }
  }
  out.push({country:a.country,action,opId:a.opId,recorded:a.action.type});
  return out;
}
function validator(g) {
  const initial=troopTotal(g);let checks=0;
  return () => {
    for(const p of g.provinces)assert.ok(Number.isInteger(p.troops)&&p.troops>=0);
    for(const a of g.armies)assert.ok(Number.isInteger(a.amount)&&a.amount>0);
    const interned=g.events.filter(e=>e.type==='army_interned').reduce((n,e)=>n+e.amount,0),casualties=g.economy.casualties||0;
    assert.equal(troopTotal(g),initial+g.economy.recruited-g.economy.invested-casualties-interned,`Troop ledger at ${g.tick}`);
    return {initial,recruited:g.economy.recruited,invested:g.economy.invested,casualties,interned,remaining:troopTotal(g),tickChecks:++checks};
  };
}
function summary(g,ledger,transport,skipped) {
  return {baseCommit:fixture.baseCommit,method:fixture.method,transport,status:'passed',
    simulatedTicks:g.tick,decisionTicks:fixture.decisionTicks,acceptedActions:g.actionLog.length,skipped,
    byAction:counts(g.actionLog,a=>a.action.type),byCountry:counts(g.actionLog,a=>a.country),
    events:counts(g.events,e=>e.type),ledger,
    finalStateSha256:digest(projection(g)),eventLogSha256:digest(g.events),outcome:g.outcome,
    countryTerritories:counts(g.provinces,p=>p.owner),
    note:'Recorded decisions replayed under the current rules through an explicit adapter; not an independent match or a balance sample.'};
}
/** Submit one recorded action through `submit(country, action, opId)` (returns the result or throws RuleError). */
function play(g,a,offers,submit,skipped) {
  for(const step of adapt(g,a,offers)) {
    try {
      const result=submit(step.country,step.action,step.opId);
      if(step.votes && result.status!=='enacted')for(const id of step.votes)
        try{submit(id,{type:'vote_war',motionId:result.motionId},`${step.opId}-vote-${id}`);}catch(e){if(!(e instanceof RuleError))throw e;}
      if(step.recorded==='propose')offers.map.set(recordedOffers[offers.next++],result.proposalId);
    } catch(e) {
      if(!(e instanceof RuleError))throw e;
      const key=`${step.action.type}: ${e.message}`;skipped[key]=(skipped[key]||0)+1;
      if(step.votes)return; // no war, no march
    }
  }
}
/** `onTick(g)` (optional) sees the board at the start of every tick, before that tick's orders. */
/** Seat the eight recorded countries and run the opening council with fixed introductions. */
export function seatRecorded(g, profiles = null) {
  for(const c of map.countries)join(g,map,{profileId:profiles?.[c.id]?.id ?? c.id,name:profiles?.[c.id]?.name ?? `Single-controller ${c.id}`,country:c.id,kind:'agent'});
  beginOpening(g);for(const c of map.countries)lockOpening(g,c.id,introduction(c.id));start(g);
}
/** Step a started game through the recorded decisions: `to(tick)` plays every recorded order before `tick`. */
export function stepper(g, { onTick } = {}) {
  const offers={map:new Map(),next:0},skipped={};let index=0;
  return { skipped, get index(){return index;}, to(until=Infinity) {
    while(g.status==='running' && g.tick<until) {
      onTick?.(g);
      while(fixture.actions[index]?.tick===g.tick)play(g,fixture.actions[index++],offers,(country,action,opId)=>act(g,map,country,action,opId),skipped);
      tick(g);
    }
  } };
}
/** `onTick(g)` (optional) sees the board at the start of every tick, before that tick's orders. */
export function replay({ onTick } = {}) {
  const g=createGame({id:'handplay',name:'Handplay replay',hostId:'britain'},map);
  seatRecorded(g);
  const validate=validator(g),run=stepper(g,{onTick:g=>{onTick?.(g);if(g.tick)ledger=validate();}});let ledger=validate();
  run.to();ledger=validate();
  assert.equal(run.index,fixture.actions.filter(a=>a.tick<g.tick).length,'Every command before the finish must be offered to the engine.');
  return {game:g,report:summary(g,ledger,'deterministic-engine-replay',run.skipped)};
}
export async function replayHttp() {
  const {makeServer}=await import('../src/server.js');
  const app=makeServer({dbPath:':memory:',automatic:false,league:false,gameIdFactory:()=>'handplay'});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${app.server.address().port}`,profiles={},tokens={};
  async function request(path,method='GET',data,token) {
    const response=await fetch(origin+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
    return {status:response.status,data:await response.json()};
  }
  try {
    for(const c of map.countries)profiles[c.id]=(await request('/api/players','POST',{name:`Single-controller ${c.id}`})).data;
    const room=(await request('/api/games','POST',{name:'Handplay replay',preset:'standard'},profiles.britain.token)).data.id;
    for(const c of map.countries)tokens[c.id]=(await request(`/api/games/${room}/join`,'POST',{country:c.id,kind:'agent'},profiles[c.id].token)).data.token;
    assert.equal((await request(`/api/games/${room}/start`,'POST',{},tokens.britain)).status,200);
    for(const c of map.countries)assert.equal((await request(`/api/games/${room}/opening`,'POST',introduction(c.id),tokens[c.id])).status,200);
    const g=app.games.get(room);assert.equal(g.status,'running');
    // The HTTP room announces alliance-chat publication; the engine replay room does not. Same rules otherwise.
    delete g.rules.revealAllianceChatAfterMatch;g.name='Handplay replay';
    const validate=validator(g),offers={map:new Map(),next:0},skipped={};let ledger=validate(),index=0;
    // Transport: a 4xx is a RuleError the engine raised (and did not apply); anything else fails the replay.
    while(g.status==='running') {
      while(fixture.actions[index]?.tick===g.tick) {
        const a=fixture.actions[index++];
        for(const step of adapt(g,a,offers)) {
          const r=await request(`/api/games/${room}/actions`,'POST',{action:step.action,opId:step.opId},tokens[step.country]);
          if(r.status>=500)throw new Error(JSON.stringify(r.data));
          if(r.status!==200){const key=`${step.action.type}: ${r.data.error}`;skipped[key]=(skipped[key]||0)+1;if(step.votes)break;continue;}
          if(step.votes && r.data.status!=='enacted')for(const id of step.votes)
            await request(`/api/games/${room}/actions`,'POST',{action:{type:'vote_war',motionId:r.data.motionId},opId:`${step.opId}-vote-${id}`},tokens[id]);
          if(step.recorded==='propose')offers.map.set(recordedOffers[offers.next++],r.data.proposalId);
        }
      }
      app.step(g,1);ledger=validate();
    }
    assert.equal(index,fixture.actions.filter(a=>a.tick<g.tick).length);
    for(const id of Object.keys(tokens)) {
      const view=(await request(`/api/games/${room}`,'GET',undefined,tokens[id])).data;
      assert.deepEqual(view.outcome,g.outcome);assert.equal(view.you,id);
      const history=(await request('/api/me','GET',undefined,profiles[id].token)).data.history;
      assert.equal(history.length,1);assert.equal(history[0].eligible,0);
    }
    return summary(g,ledger,'eight-authenticated-HTTP-seats; test-stepped clock',skipped);
  } finally {await app.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=process.argv.includes('--http')?await replayHttp():replay().report;
  const i=process.argv.indexOf('--out');if(i>=0){assert.ok(process.argv[i+1],'--out requires a path');writeFileSync(process.argv[i+1],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
}
