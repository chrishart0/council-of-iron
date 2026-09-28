/** Replay the recorded single-controller game; this does NOT generate new decisions.
 * Default: deterministic engine replay. --http: replay through eight authenticated
 * HTTP clients with a locally stepped clock and no public advance-time endpoint.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, join, start, act, tick, sides } from '../src/engine.js';

export const fixture = JSON.parse(gunzipSync(readFileSync(new URL('../tests/fixtures/handplay-20260927.json.gz', import.meta.url))));
// The recorded handplay match was played on imperial-1910-v3; replay it on that frozen map.
export const map = JSON.parse(readFileSync(new URL('../public/maps/imperial-1910-v3.json', import.meta.url)));
export const projection = g => ({ tick:g.tick, status:g.status, provinces:g.provinces, armies:g.armies, sides:sides(g), outcome:g.outcome });
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const troopTotal = g => g.provinces.reduce((n,p)=>n+p.troops,0)+g.armies.reduce((n,a)=>n+a.amount,0);
const counts = (items,key) => items.reduce((result,item)=>{const k=key(item);result[k]=(result[k]||0)+1;return result;},{});
function validator(g) {
  const initial=troopTotal(g);let casualties=0,eventIndex=0,checks=0;
  return () => {
    for(const e of g.events.slice(eventIndex))if(e.type==='battle')casualties+=e.before+e.arrivals.reduce((n,a)=>n+a.amount,0)-e.troops;
    eventIndex=g.events.length;
    for(const p of g.provinces)assert.ok(Number.isInteger(p.troops)&&p.troops>=0);
    for(const a of g.armies)assert.ok(Number.isInteger(a.amount)&&a.amount>0);
    assert.equal(troopTotal(g),initial+g.economy.recruited-g.economy.invested-casualties,`Troop ledger at ${g.tick}`);
    return {initial,recruited:g.economy.recruited,invested:g.economy.invested,casualties,remaining:troopTotal(g),tickChecks:++checks};
  };
}
function summary(g,ledger,transport) {
  assert.equal(digest(projection(g)),'a3e9d4386a42d193ac48bb0a586ef55ea716903a65b25fc73ba333953ba17db9');
  return {baseCommit:fixture.baseCommit,method:fixture.method,transport,status:'passed',
    simulatedTicks:g.tick,decisionTicks:fixture.decisionTicks,acceptedActions:g.actionLog.length,
    byAction:counts(g.actionLog,a=>a.action.type),byCountry:counts(g.actionLog,a=>a.country),
    rejectedInputs:fixture.rejectedActions.filter(a=>a.tick<g.tick).length,events:counts(g.events,e=>e.type),ledger,
    finalStateSha256:digest(projection(g)),eventLogSha256:digest(g.events),outcome:g.outcome,
    countryTerritories:counts(g.provinces,p=>p.owner),
    note:'Replaying one recorded game is not another independent match or a balance sample.'};
}
export function replay() {
  const g=createGame({id:'handplay',name:'Handplay replay',hostId:'britain'},map);
  // This immutable pre-war recording retains its original room rules.
  g.rules.warRequired=false;
  for(const c of map.countries)join(g,map,{profileId:c.id,name:`Single-controller ${c.id}`,country:c.id,kind:'agent'});
  start(g);const validate=validator(g);let ledger=validate(),index=0;
  while(g.status==='running') {
    while(fixture.actions[index]?.tick===g.tick){const a=fixture.actions[index++];act(g,map,a.country,a.action,a.opId);}
    tick(g);ledger=validate();
  }
  assert.equal(index,fixture.actions.filter(a=>a.tick<g.tick).length,'Every command before the new finish must be replayed.');
  return {game:g,report:summary(g,ledger,'deterministic-engine-replay')};
}
export async function replayHttp() {
  const {makeServer}=await import('../src/server.js');
  const {MAPS}=await import('../src/maps.js');
  const app=makeServer({dbPath:':memory:',automatic:false,league:false,newRoomMap:MAPS.get(map.id)});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${app.server.address().port}`,profiles={},tokens={};
  async function request(path,method='GET',data,token) {
    const response=await fetch(origin+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
    return {status:response.status,data:await response.json()};
  }
  try {
    for(const c of map.countries)profiles[c.id]=(await request('/api/players','POST',{name:`Single-controller ${c.id}`})).data;
    const room=(await request('/api/games','POST',{name:'Recorded all-seat HTTP replay',preset:'standard',ruleset:'classic'},profiles.britain.token)).data.id;
    for(const c of map.countries)tokens[c.id]=(await request(`/api/games/${room}/join`,'POST',{country:c.id,kind:'agent'},profiles[c.id].token)).data.token;
    assert.equal((await request(`/api/games/${room}/start`,'POST',{},tokens.britain)).status,200);
    const g=app.games.get(room);g.rules.warRequired=false;
    g.reviewOrigin.rules.warRequired=false;
    const validate=validator(g);let ledger=validate(),index=0;
    while(g.status==='running') {
      for(const a of fixture.rejectedActions.filter(a=>a.tick===g.tick)) {
        const before=JSON.stringify(g),r=await request(`/api/games/${room}/actions`,'POST',{action:a.action,opId:a.opId},tokens[a.country]);
        assert.equal(r.status,a.status);assert.equal(r.data.error,a.error);assert.equal(JSON.stringify(g),before,'Rejected input must not mutate the match.');
      }
      while(fixture.actions[index]?.tick===g.tick) {
        const a=fixture.actions[index++],r=await request(`/api/games/${room}/actions`,'POST',{action:a.action,opId:a.opId},tokens[a.country]);
        assert.equal(r.status,200,JSON.stringify({tick:g.tick,action:a,error:r.data}));
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
    return summary(g,ledger,'eight-authenticated-HTTP-seats; test-stepped clock');
  } finally {await app.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=process.argv.includes('--http')?await replayHttp():replay().report;
  const i=process.argv.indexOf('--out');if(i>=0){assert.ok(process.argv[i+1],'--out requires a path');writeFileSync(process.argv[i+1],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
}
