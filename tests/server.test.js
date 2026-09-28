import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { makeServer, MAP } from '../src/server.js';
import { join as joinEngine } from '../src/engine.js';

async function fixture(t,{disk=false,...options}={}) {
  const dir=mkdtempSync(pathJoin(tmpdir(),'council-test-'));
  let app=makeServer({dbPath:disk?pathJoin(dir,'state.db'):':memory:',automatic:false,...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  let url=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  async function call(path,method='GET',data,token,extra={}) {
    const response=await fetch(url+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...extra},body:data!==undefined?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  }
  async function register(name){return (await call('/api/players','POST',{name})).data;}
  async function room(host,name='Test chamber'){return (await call('/api/games','POST',{name},host.token)).data.id;}
  async function seat(id,profile,country,kind='human'){return (await call(`/api/games/${id}/join`,'POST',{country,kind},profile.token)).data;}
  async function boot(){const a=await register('Human'),b=await register('Agent');const id=await room(a);const sa=await seat(id,a,'usa'),sb=await seat(id,b,'britain','agent');return {a,b,id,sa,sb};}
  async function launch(id,token){const response=await call(`/api/games/${id}/start`,'POST',{},token);assert.equal(response.status,200);assert.equal(response.data.status,'running');}
  return {dir,call,register,room,seat,boot,launch,get app(){return app;},get url(){return url;},async restart(){
    await app.close();app=makeServer({dbPath:pathJoin(dir,'state.db'),automatic:false,...options});
    await new Promise(r=>app.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${app.server.address().port}`;
  }};
}
function subprocess(file,args,env,input='') {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[file,...args],{cwd:new URL('../',import.meta.url),env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('Child timeout'));},15000);
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(input);
  });
}
test('HTTP lobby: human and agent identities, occupied countries, host controls, closed seats',async t=>{
  const f=await fixture(t),{a,b,id,sa,sb}=await f.boot();
  assert.equal((await f.call(`/api/games/${id}`)).data.players.length,2);
  const third=await f.register('Third player');
  const taken=await f.call(`/api/games/${id}/join`,'POST',{country:'usa'},third.token);
  assert.equal(taken.status,409);
  assert.match(taken.data.error,/Choose a different unoccupied country/);
  assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'usa'},b.token)).status,409);
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{},sb.token)).status,403);
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{},sa.token)).status,200);
  const late=await f.register('Late');assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'france'},late.token)).status,409);
  const rejoined=await f.call(`/api/games/${id}/join`,'POST',{country:'usa'},a.token);
  assert.equal(rejoined.status,200);assert.equal((await f.call(`/api/games/${id}`,'GET',undefined,rejoined.data.token)).data.you,'usa');
});
test('private server ID factory supports paired combat trials without a public seed parameter',async t=>{
  const f=await fixture(t,{gameIdFactory:()=> 'paired-01'}),host=await f.register('Benchmark host');
  const first=await f.room(host);
  assert.equal(first,'paired-01');
  const duplicate=await f.call('/api/games','POST',{name:'Second room'},host.token);
  assert.equal(duplicate.status,400);
  assert.equal((await f.call('/api/games')).data.games.length,1);
});
test('start begins the match at once; world speech of public agents enters the report, human speech does not',async t=>{
  const f=await fixture(t),host=await f.register('Host'),agent=await f.register('Public Agent'),id=await f.room(host);
  const humanSeat=await f.seat(id,host,'usa');
  const aiSeat=(await f.call(`/api/games/${id}/join`,'POST',{country:'britain',kind:'agent',model:'test-model',visibility:'public'},agent.token)).data;
  assert.equal((await f.call(`/api/games/${id}/actions`,'POST',{opId:'early',action:{type:'develop',from:'england'}},aiSeat.token)).status,409);
  const started=await f.call(`/api/games/${id}/start`,'POST',{},humanSeat.token);
  assert.equal(started.data.status,'running');assert.equal((await f.call(`/api/games/${id}/opening`,'POST',{},humanSeat.token)).status,404);
  await f.call(`/api/games/${id}/actions`,'POST',{opId:'hello-ai',action:{type:'chat',channel:'world',text:'A public entrance.'}},aiSeat.token);
  await f.call(`/api/games/${id}/actions`,'POST',{opId:'hello-human',action:{type:'chat',channel:'world',text:'A private seat speaks publicly.'}},humanSeat.token);
  f.app.step(f.app.games.get(id),1800);
  const report=(await f.call(`/api/games/${id}/review`)).data;
  assert.equal(report.historyAvailable,true);
  assert.ok(report.messages.some(m=>m.text==='A public entrance.'));
  assert.ok(!report.messages.some(m=>m.text==='A private seat speaks publicly.'));
});
test('public lobby keeps active rooms visible ahead of recent finished games',async t=>{
  const f=await fixture(t),host=await f.register('Host'),active=await f.room(host,'Live council');
  for(let i=0;i<50;i++){
    const id=await f.room(host,`Finished ${i}`);
    f.app.games.get(id).status='finished';
  }
  const listed=(await f.call('/api/games')).data.games;
  assert.equal(listed.length,50);
  assert.equal(listed[0].id,active);
  assert.equal(listed[0].status,'lobby');
});
test('AI disclosure choice is explicit at joining, private by default, and fixed on reconnect',async t=>{
  const f=await fixture(t),{id,sa,sb,b}=await f.boot();
  const room=(await f.call(`/api/games/${id}`)).data;
  assert.equal(room.players.find(p=>p.id==='britain').visibility,'private');
  const extra=await f.register('Open envoy');
  assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'france',kind:'human',visibility:'public'},extra.token)).status,400);
  assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'france',kind:'agent',visibility:'public'},extra.token)).status,200);
  assert.equal((await f.call(`/api/games/${id}`)).data.players.find(p=>p.id==='france').visibility,'public');
  assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'britain',kind:'agent',visibility:'public'},b.token)).status,200);
  assert.equal((await f.call(`/api/games/${id}`)).data.players.find(p=>p.id==='britain').visibility,'private');
});
test('HTTP authentication, match scopes, origin/host protection, JSON validation and no time travel endpoint',async t=>{
  const f=await fixture(t),{a,id,sa}=await f.boot(),other=await f.room(a,'Other');
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{})).status,401);
  assert.equal((await f.call(`/api/games/${id}`,'GET',undefined,'bogus')).status,401);
  assert.equal((await f.call(`/api/games/${other}`,'GET',undefined,sa.token)).status,403);
  assert.equal((await f.call('/api/games','POST',{name:'Bad'},sa.token)).status,403);
  assert.equal((await f.call('/api/players','POST',{name:'Bad'},undefined,{Origin:'https://evil.example'})).status,403);
  const badHost=await new Promise((resolve,reject)=>{const req=httpRequest(f.url+'/api/health',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(badHost,403);
  const malformed=await fetch(f.url+'/api/players',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
  const wrongtype=await fetch(f.url+'/api/players',{method:'POST',body:'hello'});assert.equal(wrongtype.status,415);
  const array=await f.call('/api/players','POST',[]);assert.equal(array.status,400);
  const giant=await f.call('/api/players','POST',{name:'x'.repeat(17000)});assert.equal(giant.status,413);
  assert.equal((await f.call(`/api/games/${id}/advance`,'POST',{seconds:1800},a.token)).status,404);
  const html=await fetch(f.url+'/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(f.url+'/src/store.js')).status,404);
});
test('HTTP action replay, reservations, privacy, forecasts and live transfers',async t=>{
  const f=await fixture(t),{id,sa,sb}=await f.boot();await f.launch(id,sa.token);
  const post=(token,opId,action)=>f.call(`/api/games/${id}/actions`,'POST',{opId,action},token);
  const order={type:'march',from:'west-us',to:'mexico',amount:5};
  const first=await post(sa.token,'army',order);assert.equal(first.status,200);
  assert.deepEqual(await post(sa.token,'army',order),first);
  assert.equal((await post(sa.token,'army',{...order,amount:6})).status,409);
  assert.equal((await post(sb.token,'theft',order)).status,403);
  assert.equal((await post(sa.token,'dm',{type:'chat',channel:'dm',to:'britain',text:'Secret ☀ <img onerror=alert(1)>'})).status,200);
  const own=(await f.call(`/api/games/${id}`,'GET',undefined,sa.token)).data;
  const agent=(await f.call(`/api/games/${id}`,'GET',undefined,sb.token)).data;
  const publicState=(await f.call(`/api/games/${id}`)).data;
  assert.equal(own.events.filter(e=>e.type==='message' && e.channel==='dm').length,1);assert.equal(agent.events.filter(e=>e.type==='message' && e.channel==='dm').length,1);
  assert.equal(publicState.events.filter(e=>e.type==='message' && e.channel==='dm').length,0);assert.equal(agent.orders.length,0);assert.equal(own.orders.length,1);
  assert.equal(own.economyThreshold,Math.ceil(own.sides.reduce((n,s)=>n+s.economy,0)*.6));
  assert.equal(own.sides.find(s=>s.members.includes('usa')).economy,
    own.provinces.filter(p=>p.owner==='usa').reduce((n,p)=>n+p.development,0));
  for(const field of ['hostId','receipts','actionLog'])assert.equal(Object.hasOwn(publicState,field),false);
  assert.equal(JSON.stringify(publicState).includes(sa.token),false);
  const preview=(await f.call(`/api/games/${id}/plan`,'POST',{from:'west-us',to:'mexico',amount:5},sa.token)).data;assert.match(preview.summary,/dice rounds/);
  assert.equal((await f.call(`/api/games/${id}/plan`,'POST',{from:'west-us',to:'mexico',amount:5})).status,401,'forecasts are for seated players');
  f.app.step(f.app.games.get(id),first.data.arrivesAt+12);const done=(await f.call(`/api/games/${id}`)).data;
  assert.ok(done.events.some(e=>e.type==='battle' && e.province==='mexico'));
  assert.equal(done.battles.length,0);
});
test('SQLite restart preserves credentials, committed armies, inboxes, idempotency and exactly-once results',async t=>{
  const f=await fixture(t,{disk:true}),{a,id,sa}=await f.boot();await f.launch(id,sa.token);
  const payload={opId:'persist-move',action:{type:'march',from:'west-us',to:'mexico',amount:5}};
  const accepted=await f.call(`/api/games/${id}/actions`,'POST',payload,sa.token);f.app.step(f.app.games.get(id),1);
  await f.restart();
  const state=(await f.call(`/api/games/${id}`,'GET',undefined,sa.token)).data;assert.equal(state.tick,1);assert.equal(state.armies.length,1);
  assert.deepEqual(await f.call(`/api/games/${id}/actions`,'POST',payload,sa.token),accepted);
  f.app.step(f.app.games.get(id),1799);assert.equal(f.app.games.get(id).status,'finished');
  const result=f.app.games.get(id).outcome.scores.find(s=>s.country==='usa').result;
  await f.restart();f.app.store.save(f.app.games.get(id));
  const mine=(await f.call('/api/standings')).data.standings.find(s=>s.id===a.id);
  assert.equal(mine.matches,1,'a finished match is recorded exactly once');assert.equal(mine[{win:'wins',draw:'draws',loss:'losses'}[result]],1);
  const onDisk=readFileSync(pathJoin(f.dir,'state.db'));assert.equal(onDisk.includes(Buffer.from(sa.token)),false);
});
test('built-in practice bots use the common game engine to completion and never enter the standings',async t=>{
  const f=await fixture(t),{id,sa}=await f.boot();
  assert.equal((await f.call(`/api/games/${id}/bots`,'POST',{},sa.token)).data.players,8);
  await f.launch(id,sa.token);const g=f.app.games.get(id);f.app.step(g,1800);
  assert.equal(g.status,'finished');assert.equal(g.outcome.scores.length,8);
  assert.deepEqual((await f.call('/api/standings')).data.standings.map(s=>s.matches),[1,1],'only the human and the agent are ranked');
  assert.ok(g.actionLog.some(a=>a.opId.startsWith('bot-')));
  const review=(await f.call(`/api/games/${id}/review`)).data;
  assert.equal(review.historyAvailable,true);
  assert.equal(review.totals.initialTroops+review.totals.recruited-review.totals.invested-review.totals.casualties-review.totals.interned,review.totals.remainingTroops);
});
test('a host can fill practice seats before joining and reclaim a bot in a full lobby',async t=>{
  const f=await fixture(t),host=await f.register('Practice host'),visitor=await f.register('Visitor');
  const id=await f.room(host);
  assert.equal((await f.call(`/api/games/${id}/bots`,'POST',{},host.token)).status,400);
  const filled=await f.call(`/api/games/${id}/bots`,'POST',{country:'japan'},host.token);
  assert.equal(filled.status,200);
  let view=(await f.call(`/api/games/${id}`,'GET',undefined,host.token)).data;
  assert.equal(view.you,'japan');assert.equal(view.players.length,8);
  assert.equal(view.players.filter(p=>p.kind==='bot').length,7);
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{},host.token)).status,200);

  const older=await f.room(host,'Full practice lobby');
  // Filled directly through the engine: every seat is a bot before the host joins.
  const g=f.app.games.get(older);
  for(const c of MAP.countries) joinEngine(g,MAP,{profileId:`old-bot-${c.id}`,name:`${c.name} bot`,country:c.id,kind:'bot'});
  assert.equal((await f.call(`/api/games/${older}/join`,'POST',{country:'usa'},visitor.token)).status,409);
  const claimed=await f.call(`/api/games/${older}/join`,'POST',{country:'usa',kind:'human'},host.token);
  assert.equal(claimed.status,200);
  view=(await f.call(`/api/games/${older}`,'GET',undefined,host.token)).data;
  assert.equal(view.you,'usa');assert.equal(view.players.length,8);
  assert.equal(view.players.find(p=>p.id==='usa').kind,'human');
  assert.equal(view.players.filter(p=>p.kind==='bot').length,7);
  assert.equal(view.events.filter(e=>e.type==='seat_claimed').length,1);
  assert.equal((await f.call(`/api/games/${older}/join`,'POST',{country:'usa'},host.token)).status,200);
  assert.equal((await f.call(`/api/games/${older}/start`,'POST',{},host.token)).status,200);
  f.app.step(g,1800);
  assert.equal((await f.call(`/api/games/${older}/review`)).data.historyAvailable,true);
});
test('real CLI subprocess joins, observes, sends orders, reconnects from a private session file',async t=>{
  const f=await fixture(t),host=await f.register('Host'),id=await f.room(host);const sa=await f.seat(id,host,'usa');
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'cli.session.json'),COUNCIL_TOKEN:'',COUNCIL_MATCH:''};
  const run=(...args)=>subprocess('agents/cli.js',args,env);
  const joined=await run('join',id,'britain','CLI diplomat');assert.equal(joined.code,0,joined.stderr);assert.equal(JSON.parse(joined.stdout).country,'britain');
  assert.equal(statSync(env.COUNCIL_SESSION).mode & 0o777,0o600);
  await f.launch(id,sa.token);
  const moved=await run('march','low-countries','5','england');assert.equal(moved.code,0,moved.stderr);
  const both=await run('preview','north-france','50%','--from','england,ireland');assert.equal(both.code,0,both.stderr);
  assert.equal(JSON.parse(both.stdout).sources.length,2);
  const bordering=await run('preview','north-france','50%','--all-bordering');assert.equal(bordering.code,0,bordering.stderr);
  assert.deepEqual(JSON.parse(bordering.stdout).sources.map(s=>s.from).sort(),['england','ireland']);
  const far=await run('preview','north-france','50%','--from','scotland');assert.equal(far.code,1);assert.match(far.stderr,/scotland does not border north-france.*yours: ireland, england/);assert.ok(JSON.parse(both.stdout).combatAtArrival);
  const state=JSON.parse((await run('state')).stdout);assert.equal(state.you,'britain');assert.equal(state.orders.length,1);
  const compact=JSON.parse((await run('board')).stdout);
  assert.equal(compact.you,'britain');
  assert.equal(compact.provinces.length,state.provinces.length);
  assert.ok(compact.own.find(p=>p.id==='england').neighbors.some(p=>p.id==='low-countries'));
  const agentMap=JSON.parse((await run('map')).stdout);
  assert.equal(agentMap.provinces.length,state.provinces.length);
  assert.ok(agentMap.provinces.every(p=>!Object.hasOwn(p,'path')));
  const invalid=await run('march','mexico','5','west-us');assert.equal(invalid.code,1);assert.match(invalid.stderr,/not own/);
  const chat=await run('chat','dm','usa','Private diplomacy');assert.equal(chat.code,0,chat.stderr);
  assert.equal((await f.call(`/api/games/${id}`,'GET',undefined,sa.token)).data.events.filter(e=>e.type==='message').at(-1).text,'Private diplomacy');
});
test('stdio MCP negotiates, validates schemas, joins an agent, calls real HTTP, and emits only JSON-RPC',async t=>{
  const f=await fixture(t),host=await f.register('Host'),id=await f.room(host);await f.seat(id,host,'usa');
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'mcp.session.json'),COUNCIL_TOKEN:'',COUNCIL_MATCH:''};
  const input=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'join_match',arguments:{match:id,country:'britain',name:'MCP envoy',model:'test-harness',persona:'diplomat'}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'observe',arguments:{after:0}}},
    {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'march',arguments:{from:'england',to:'north-france',amount:-1}}},
    {jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'unknown',arguments:{}}},
    {jsonrpc:'2.0',id:7,method:'ping'},
    {jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'board',arguments:{}}},
    {jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'view_map',arguments:{}}},
    {jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'news',arguments:{}}},
    {jsonrpc:'2.0',id:11,method:'tools/call',params:{name:'march',arguments:{from:'england',to:'low-countries',amount:5}}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const result=await subprocess('agents/mcp.js',[],env,input);assert.equal(result.code,0,result.stderr);
  const output=result.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(output.length,11);
  assert.equal(output[0].result.protocolVersion,'2025-06-18');assert.equal(output[1].result.tools.length,27);
  assert.ok(['board','decision_view','news','preview','march','rally','turn_around','declare_war','offer_peace','accept_peace'].every(name=>output[1].result.tools.some(t=>t.name===name)));
  assert.ok(!['move','transit','coordinated_attack','recall','vote_war','lock_opening','situation'].some(name=>output[1].result.tools.some(t=>t.name===name)));
  assert.equal(JSON.parse(output[2].result.content[0].text).country,'britain');
  const observed=JSON.parse(output[3].result.content[0].text);assert.equal(observed.you,'britain');
  assert.equal(output[4].error.code,-32602);assert.equal(output[5].error.code,-32602);assert.deepEqual(output[6].result,{});
  const compact=JSON.parse(output[7].result.content[0].text);
  assert.equal(compact.you,'britain');
  assert.equal(compact.provinces.length,observed.provinces.length);
  assert.equal(Object.hasOwn(compact,'travelTimes'),false);
  assert.ok(compact.own.find(p=>p.id==='england').neighbors.some(p=>p.id==='low-countries'));
  const view=output[8].result.content;
  assert.equal(JSON.parse(view[0].text).you,'britain');
  assert.equal(view[1].mimeType,'image/png');
  assert.equal(Buffer.from(view[1].data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const news=JSON.parse(output[9].result.content[0].text);
  assert.equal(news.you,'britain');
  assert.equal(Object.hasOwn(news,'provinces'),false);
  assert.equal(Object.hasOwn(news,'armies'),false);
  const failedMove=JSON.parse(output[10].result.content[0].text);
  assert.equal(output[10].result.isError,true);
  assert.match(failedMove.error,/match is not running/i);
  assert.equal(failedMove.hint.sources[0].id,'england');
  assert.ok(failedMove.hint.sources[0].available>0);

  const other=await f.register('Other envoy');
  const conflictInput=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'join_match',arguments:{match:id,country:'britain',name:'Other envoy'}}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const conflict=await subprocess('agents/mcp.js',[],{COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'other.session.json'),COUNCIL_TOKEN:other.token,COUNCIL_MATCH:''},conflictInput);
  assert.equal(conflict.code,0,conflict.stderr);
  const response=JSON.parse(conflict.stdout.trim().split('\n').at(-1));
  assert.equal(response.result.isError,true);
  assert.match(JSON.parse(response.result.content[0].text).error,/Choose a different unoccupied country/);
});

test('new rooms use the current rules; rally plans and orders go over HTTP',async t=>{
  const f=await fixture(t,{disk:true}),host=await f.register('Logistics host'),agent=await f.register('Logistics agent');
  const id=(await f.call('/api/games','POST',{name:'Logistics'},host.token)).data.id;
  const usa=await f.seat(id,host,'usa'),germany=await f.seat(id,agent,'germany','agent');
  await f.launch(id,usa.token);
  const view=(await f.call(`/api/games/${id}`,'GET',undefined,usa.token)).data;
  assert.equal(view.rules.moveSpeedPercent,120);assert.equal(view.internalTravelTimes['west-us']['central-us'],24);
  assert.deepEqual(view.rallies,[]);
  const rally={type:'rally',from:['central-us','east-us'],to:'west-us'};
  const plan=await f.call(`/api/games/${id}/plan`,'POST',rally,usa.token);
  assert.equal(plan.status,200,JSON.stringify(plan.data));assert.deepEqual(plan.data.sources.map(s=>s.path),[['west-us'],['central-us','west-us']]);
  assert.equal(plan.data.sources[1].travel,24+25);
  assert.equal((await f.call(`/api/games/${id}/plan`,'POST',{type:'rally',from:'alaska',to:'west-us'},usa.token)).status,409,'no friendly path');
  assert.equal(f.app.games.get(id).orders.length,0,'a plan spends nothing');
  assert.equal((await f.call(`/api/games/${id}/plan`,'POST',rally,germany.token)).status,403);
  const set=await f.call(`/api/games/${id}/actions`,'POST',{opId:'rally-1',action:{type:'rally',from:'central-us',to:'west-us'}},usa.token);
  assert.equal(set.status,200,JSON.stringify(set.data));
  f.app.step(f.app.games.get(id),1);await f.restart();
  const mine=(await f.call(`/api/games/${id}`,'GET',undefined,usa.token)).data.rallies;
  assert.deepEqual(mine.map(x=>[x.from,x.to]),[['central-us','west-us']]);
  assert.deepEqual((await f.call(`/api/games/${id}`,'GET',undefined,germany.token)).data.rallies,[]);
});

test('industrial HTTP plans are private, atomic, synchronized, recallable and persistent',async t=>{
  const f=await fixture(t,{disk:true}),host=await f.register('Industrial human'),agent=await f.register('Industrial agent');
  const id=(await f.call('/api/games','POST',{name:'Industry'},host.token)).data.id;
  const usa=await f.seat(id,host,'usa'),germany=await f.seat(id,agent,'germany','agent');
  await f.launch(id,usa.token);
  const map=(await f.call(`/api/games/${id}/map`)).data;
  assert.equal(map.rulesVersion,3);assert.ok(map.provinces.length>64);
  const request={to:'mexico',sources:[{from:'west-us',percent:50},{from:'central-us',percent:50}]};
  const plan=await f.call(`/api/games/${id}/plan`,'POST',request,usa.token);
  assert.equal(plan.status,200);assert.equal(f.app.games.get(id).orders.length,0);
  assert.equal((await f.call(`/api/games/${id}/plan`,'POST',request,germany.token)).status,403);
  const receipt=(await f.call(`/api/games/${id}/actions`,'POST',{opId:'coordinate',action:{type:'march',...request}},usa.token)).data;
  assert.equal(new Set(receipt.orders.map(o=>o.arrivesAt)).size,1);
  f.app.step(f.app.games.get(id),1);await f.restart();
  const restored=(await f.call(`/api/games/${id}`,'GET',undefined,usa.token)).data;
  assert.equal(restored.scenario,'imperial-1910-v5');assert.ok(restored.armies.some(a=>a.groupId===receipt.groupId));
  const recall={opId:'return',action:{type:'recall',id:receipt.groupId}};
  assert.equal((await f.call(`/api/games/${id}/actions`,'POST',recall,usa.token)).status,200);
  f.app.step(f.app.games.get(id),10);
  assert.ok(!f.app.games.get(id).armies.some(a=>a.groupId===receipt.groupId));
  f.app.step(f.app.games.get(id),140);
  f.app.games.get(id).provinces.find(p=>p.id==='namibia').troops=25;
  const build=await f.call(`/api/games/${id}/actions`,'POST',{opId:'build',action:{type:'develop',from:'namibia'}},germany.token);
  assert.equal(build.status,200,JSON.stringify(build.data));
  f.app.step(f.app.games.get(id),121);assert.equal(f.app.games.get(id).provinces.find(p=>p.id==='namibia').development,2);
});

test('MCP exposes multi-source march forecasts, validates nested schemas and retries one march exactly once',async t=>{
  const f=await fixture(t),host=await f.register('Host'),other=await f.register('Opponent');
  const id=(await f.call('/api/games','POST',{name:'MCP industry'},host.token)).data.id;
  const seat=await f.seat(id,host,'usa');await f.seat(id,other,'britain');await f.launch(id,seat.token);
  const commands=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'preview',arguments:{to:'mexico',sources:[{from:'west-us',percent:50},{from:'central-us',amount:4}]}}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'march',arguments:{to:'mexico',opId:'stable-plan',sources:[{from:'west-us',percent:50},{from:'central-us',amount:4}]}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'march',arguments:{to:'mexico',opId:'stable-plan',sources:[{from:'west-us',percent:50},{from:'central-us',amount:4}]}}},
    {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'preview',arguments:{to:'mexico',sources:[{from:'west-us',percent:101}]}}},
    {jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'preview',arguments:{to:'mexico',sources:[{from:'west-us',amount:4,unexpected:true}]}}},
  ];
  const result=await subprocess('agents/mcp.js',[],{COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'industrial.session.json'),COUNCIL_MATCH:id,COUNCIL_TOKEN:seat.token},commands.map(JSON.stringify).join('\n')+'\n');
  assert.equal(result.code,0,result.stderr);const responses=result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(JSON.parse(responses[1].result.content[0].text).sources.length,2);
  assert.deepEqual(responses[2].result,responses[3].result);assert.equal(f.app.games.get(id).orders.length,2);
  assert.equal(responses[4].error.code,-32602);assert.equal(responses[5].error.code,-32602);
});

test('finished matches enter the win/draw/loss standings',async t=>{
  const f=await fixture(t),{a,id,sa}=await f.boot();await f.launch(id,sa.token);
  const g=f.app.games.get(id);g.provinces.find(p=>p.id==='mexico').owner='usa';g.provinces.find(p=>p.id==='mexico').nextRecruit=20;f.app.step(g,1800);
  const standings=(await f.call('/api/standings')).data.standings;
  assert.equal(standings.length,2);assert.ok(standings.every(s=>s.matches===1 && s.wins+s.draws+s.losses===1));
  assert.equal(standings.find(s=>s.id===a.id)[{win:'wins',draw:'draws',loss:'losses'}[g.outcome.scores.find(s=>s.country==='usa').result]],1);
});


test('room resume hints identify only the authenticated seat and respect match-scoped credentials',async t=>{
  const f=await fixture(t),{a,b,id,sa}=await f.boot();
  const other=await f.room(a,'Second room');await f.seat(other,a,'usa');
  const hints=token=>f.call('/api/games','GET',undefined,token);
  assert.ok((await hints()).data.games.every(g=>g.you===null));
  assert.equal((await hints(a.token)).data.games.find(g=>g.id===id).you,'usa');
  assert.equal((await hints(b.token)).data.games.find(g=>g.id===id).you,'britain');
  assert.equal((await hints(sa.token)).data.games.find(g=>g.id===id).you,'usa');
  assert.equal((await hints(sa.token)).data.games.find(g=>g.id===other).you,null);
});

test('World feed is one public, cursor-based stream for HTTP, CLI and MCP with engine headlines',async t=>{
  const f=await fixture(t),host=await f.register('Host'),other=await f.register('Envoy');
  const id=await f.room(host),usa=await f.seat(id,host,'usa'),britain=await f.seat(id,other,'britain','agent');
  await f.launch(id,usa.token);
  const act=(token,opId,action)=>f.call(`/api/games/${id}/actions`,'POST',{opId,action},token);
  assert.equal((await act(usa.token,'w1',{type:'chat',channel:'world',text:'<img src=x onerror=alert(1)> to all'})).status,200);
  f.app.step(f.app.games.get(id),10);
  assert.equal((await act(britain.token,'d1',{type:'chat',channel:'dm',to:'usa',text:'private terms'})).status,200);
  assert.equal((await act(britain.token,'war',{type:'declare_war',country:'usa'})).status,200);
  const pub=(await f.call(`/api/games/${id}/feed`)).data;
  // Two seats: one side may also have started a public victory hold (a `dominance` headline).
  assert.deepEqual(pub.items.map(i=>i.type).filter(t=>t!=='dominance'),['message','war_declared']);
  assert.deepEqual(pub.items.at(-1).headline,{kind:'war',from:['britain'],to:['usa']});
  assert.equal(pub.items[0].untrusted,true);assert.ok(!JSON.stringify(pub).includes('private terms'));
  const seat=(await f.call(`/api/games/${id}/feed`,'GET',undefined,usa.token)).data;
  assert.deepEqual(seat.items,pub.items,'players and spectators receive the identical feed');
  assert.equal((await f.call(`/api/games/${id}/feed?after=-1`)).status,400);
  assert.equal((await f.call(`/api/games/${id}/feed?limit=0`)).status,400);
  assert.deepEqual((await f.call(`/api/games/${id}/feed?after=${pub.items.at(-2).seq}`)).data.items.map(i=>i.type),['war_declared']);
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'feed.session.json'),COUNCIL_TOKEN:britain.token,COUNCIL_MATCH:id};
  // Agents read the same headlines, plus their own messages, through news (CLI and MCP).
  const cli=await subprocess('agents/cli.js',['news'],env);assert.equal(cli.code,0,cli.stderr);
  const brief=JSON.parse(cli.stdout);
  assert.ok(brief.events.some(e=>e.type==='war_declared' && e.headline?.kind==='war'));
  assert.ok(brief.events.some(e=>e.type==='message' && e.text==='private terms'),'the sender sees its own DM');
  const input=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'news',arguments:{after:0}}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'news',arguments:{}}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const mcp=await subprocess('agents/mcp.js',[],env,input);assert.equal(mcp.code,0,mcp.stderr);
  const out=mcp.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(JSON.parse(out[1].result.content[0].text).events,brief.events);
  assert.deepEqual(JSON.parse(out[2].result.content[0].text).events,[],'the MCP news cursor continues where it left off');
});
test('HTTP join notice: new rooms announce post-match alliance chat; unflagged rooms do not',async t=>{
  const f=await fixture(t),host=await f.register('Host'),guest=await f.register('Guest');
  const id=await f.room(host);
  const flagged=await f.call(`/api/games/${id}/join`,'POST',{country:'usa'},host.token);
  assert.equal(flagged.status,200);
  assert.deepEqual(flagged.data.notices,['Alliance chat becomes public in the replay after the match ends.']);
  assert.equal((await f.call(`/api/games/${id}`)).data.rules.revealAllianceChatAfterMatch,true);
  const old=await f.room(host,'Older room');delete f.app.games.get(old).rules.revealAllianceChatAfterMatch;
  const plain=await f.call(`/api/games/${old}/join`,'POST',{country:'britain'},guest.token);
  assert.equal(plain.status,200);assert.deepEqual(plain.data.notices,[]);
});
test('HTTP declare-and-march shares the engine path and retry receipt',async t=>{
  const f=await fixture(t),{id,sa,sb}=await f.boot();await f.launch(id,sa.token);
  const g=f.app.games.get(id),mexico=g.provinces.find(p=>p.id==='mexico');mexico.owner='britain';mexico.troops=3;
  const action={type:'march',from:'west-us',to:'mexico',amount:5,declareWar:true};
  const refused=await f.call(`/api/games/${id}/actions`,'POST',{opId:'dm-bad',action:{...action,amount:999}},sa.token);
  assert.equal(refused.status,400);assert.deepEqual(g.wars,[]);
  const first=await f.call(`/api/games/${id}/actions`,'POST',{opId:'dm-1',action},sa.token);
  assert.equal(first.status,200);assert.equal(first.data.warDeclared,true);assert.deepEqual(first.data.war.toRoster,['britain']);
  const retry=await f.call(`/api/games/${id}/actions`,'POST',{opId:'dm-1',action},sa.token);
  assert.deepEqual(retry.data,first.data);assert.equal(g.orders.length,1);
  const view=(await f.call(`/api/games/${id}`,'GET',undefined,sa.token)).data;
  assert.deepEqual(view.wars,['britain:usa']);assert.equal(view.orders.length,1);
});

test('turn around over HTTP, CLI and MCP: bring a march home, march a returning army again, survive restart',async t=>{
  const f=await fixture(t,{disk:true}),host=await f.register('Host'),other=await f.register('Other');
  const id=await f.room(host),usa=await f.seat(id,host,'usa');await f.seat(id,other,'britain');
  await f.launch(id,usa.token);
  const post=(opId,action)=>f.call(`/api/games/${id}/actions`,'POST',{opId,action},usa.token);
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'turn.session.json'),COUNCIL_TOKEN:usa.token,COUNCIL_MATCH:id};
  const first=(await post('out-1',{type:'march',from:'west-us',to:'mexico',amount:3})).data;
  const second=(await post('out-2',{type:'march',from:'central-us',to:'mexico',amount:3})).data;
  f.app.step(f.app.games.get(id),10);
  // CLI: a march group ID brings it home.
  const cli=await subprocess('agents/cli.js',['turn-around',first.groupId],env);assert.equal(cli.code,0,cli.stderr);
  f.app.step(f.app.games.get(id),1);
  const army=f.app.games.get(id).armies.find(a=>a.groupId===first.groupId);assert.equal(army.returning,true);
  const plan=await f.call(`/api/games/${id}/plan`,'POST',{type:'turn_around',armyId:army.id},usa.token);
  assert.equal(plan.status,200,JSON.stringify(plan.data));assert.equal(plan.data.mode,'resume');assert.equal(plan.data.to,'mexico');
  // MCP: the same tool sends the returning army back toward Mexico.
  const mcp=await subprocess('agents/mcp.js',[],env,[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'turn_around',arguments:{id:army.id,preview:true}}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'turn_around',arguments:{id:army.id,opId:'mcp-again'}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'turn_around',arguments:{id:second.groupId,opId:'mcp-home'}}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const out=mcp.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(JSON.parse(out[1].result.content[0].text).mode,'resume');
  const again=JSON.parse(out[2].result.content[0].text);assert.equal(again.mode,'resume',JSON.stringify(out[2]));assert.equal(again.arrivesAt,plan.data.arrivesAt);
  assert.equal(JSON.parse(out[3].result.content[0].text).ok,true,JSON.stringify(out[3]));
  f.app.step(f.app.games.get(id),1);await f.restart();
  const restored=(await f.call(`/api/games/${id}`,'GET',undefined,usa.token)).data;
  const resumed=restored.armies.find(a=>a.id===army.id);
  assert.equal(resumed.returning,undefined);assert.equal(resumed.to,'mexico');assert.equal(resumed.turnArounds,1);
  assert.ok(restored.events.some(e=>e.type==='army_turned_around'&&e.armyId===army.id&&e.arrivesAt===plan.data.arrivesAt));
  assert.ok(restored.armies.filter(a=>a.groupId===second.groupId).every(a=>a.returning));
});


test('a long march has the same path and arrival for the browser (HTTP /plan), MCP and CLI',async t=>{
  const f=await fixture(t),host=await f.register('Host'),other=await f.register('Other');
  const id=await f.room(host),usa=await f.seat(id,host,'usa');await f.seat(id,other,'britain');
  await f.launch(id,usa.token);
  const g=f.app.games.get(id);for(const p of ['mexico','west-canada'])Object.assign(g.provinces.find(v=>v.id===p),{owner:'usa',troops:30});
  const action={to:'alaska',from:'mexico',amount:20};
  const http=(await f.call(`/api/games/${id}/plan`,'POST',action,usa.token)).data;
  assert.ok(http.sources[0].path.length>=3,JSON.stringify(http));
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'long.session.json'),COUNCIL_TOKEN:usa.token,COUNCIL_MATCH:id};
  const mcp=await subprocess('agents/mcp.js',[],env,[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'preview',arguments:action}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const out=mcp.stdout.trim().split('\n').map(x=>JSON.parse(x)),viaMcp=JSON.parse(out[1].result.content[0].text);
  assert.deepEqual(viaMcp.sources.map(s=>[s.path,s.travel]),http.sources.map(s=>[s.path,s.travel]));assert.equal(viaMcp.arrivesAt,http.arrivesAt);
  const cli=await subprocess('agents/cli.js',['preview','alaska','20','mexico'],env);assert.equal(cli.code,0,cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).sources[0].path,http.sources[0].path);
  const sent=JSON.parse((await subprocess('agents/cli.js',['march','alaska','20','mexico'],env)).stdout);
  assert.deepEqual(sent.orders[0].path,http.sources[0].path);assert.equal(sent.arrivesAt,http.arrivesAt);
});
test('attack from every bordering province: HTTP, MCP and CLI agree; percent per source; a clear error when none',async t=>{
  const f=await fixture(t),host=await f.register('Host'),other=await f.register('Other');
  const id=await f.room(host),usa=await f.seat(id,host,'usa');await f.seat(id,other,'britain');
  await f.launch(id,usa.token);
  const g=f.app.games.get(id);Object.assign(g.provinces.find(v=>v.id==='central-us'),{troops:21});
  const action={to:'mexico',fromAllBordering:true,percent:50};
  const http=(await f.call(`/api/games/${id}/plan`,'POST',action,usa.token)).data;
  assert.deepEqual(http.sources.map(s=>[s.from,s.amount]),[['central-us',10],['west-us',Math.floor((g.provinces.find(v=>v.id==='west-us').troops-1)/2)]]);
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'bordering.session.json'),COUNCIL_TOKEN:usa.token,COUNCIL_MATCH:id};
  const mcp=await subprocess('agents/mcp.js',[],env,[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'preview',arguments:action}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'march',arguments:{to:'andes',fromAllBordering:true,percent:50}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'march',arguments:{to:'mexico',fromAllBordering:false,percent:50}}},
    {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'march',arguments:{to:'mexico',from:'east-us',amount:3}}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const out=mcp.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(JSON.parse(out[1].result.content[0].text).sources,http.sources);
  assert.equal(out[2].result.isError,true);assert.match(out[2].result.content[0].text,/None of your provinces bordering andes has free troops/);
  assert.equal(out[3].error.code,-32602,'only true is accepted');
  const far=JSON.parse(out[4].result.content[0].text);
  assert.match(far.error,/east-us does not border mexico.*yours: west-us, central-us/);
  assert.deepEqual(far.hint.target.yourBorderingProvinces.map(p=>p.id).sort(),['central-us','west-us']);
  const cli=await subprocess('agents/cli.js',['preview','mexico','50%','--all-bordering'],env);assert.equal(cli.code,0,cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).sources,http.sources);
  const sent=JSON.parse((await subprocess('agents/cli.js',['march','mexico','50%','--all-bordering'],env)).stdout);
  assert.deepEqual(sent.sources.map(s=>[s.from,s.amount]),http.sources.map(s=>[s.from,s.amount]));
  assert.equal(sent.total,http.total);assert.equal(sent.arrivesAt,http.arrivesAt);
  assert.equal(g.orders.filter(o=>o.to==='mexico').length,2);
});
