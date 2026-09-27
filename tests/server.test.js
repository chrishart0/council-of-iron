import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { makeServer } from '../src/server.js';

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
  return {dir,call,register,room,seat,boot,get app(){return app;},get url(){return url;},async restart(){
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
  assert.equal((await f.call('/api/games','POST',{name:'Obsolete',scenario:'classic-64'},a.token)).status,400);
  assert.equal((await f.call(`/api/games/${id}`)).data.players.length,2);
  assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'usa'},b.token)).status,409);
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{},sb.token)).status,403);
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{},sa.token)).status,200);
  const late=await f.register('Late');assert.equal((await f.call(`/api/games/${id}/join`,'POST',{country:'france'},late.token)).status,409);
  const rejoined=await f.call(`/api/games/${id}/join`,'POST',{country:'usa'},a.token);
  assert.equal(rejoined.status,200);assert.equal((await f.call(`/api/games/${id}`,'GET',undefined,rejoined.data.token)).data.you,'usa');
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
test('HTTP authentication, match scopes, origin/host protection, JSON validation and no time travel endpoint',async t=>{
  const f=await fixture(t),{a,id,sa}=await f.boot(),other=await f.room(a,'Other');
  assert.equal((await f.call(`/api/games/${id}/start`,'POST',{})).status,401);
  assert.equal((await f.call(`/api/games/${id}`,'GET',undefined,'bogus')).status,401);
  assert.equal((await f.call(`/api/games/${other}`,'GET',undefined,sa.token)).status,403);
  assert.equal((await f.call('/api/me','GET',undefined,sa.token)).status,403);
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
test('HTTP action replay, reservations, privacy, projected score, preview parity and live transfers',async t=>{
  const f=await fixture(t),{id,sa,sb}=await f.boot();await f.call(`/api/games/${id}/start`,'POST',{},sa.token);
  const post=(token,opId,action)=>f.call(`/api/games/${id}/actions`,'POST',{opId,action},token);
  const order={type:'move',from:'west-us',to:'mexico',amount:5};
  const first=await post(sa.token,'army',order);assert.equal(first.status,200);
  assert.deepEqual(await post(sa.token,'army',order),first);
  assert.equal((await post(sa.token,'army',{...order,amount:6})).status,409);
  assert.equal((await post(sb.token,'theft',order)).status,403);
  assert.equal((await post(sa.token,'dm',{type:'chat',channel:'dm',to:'britain',text:'Secret ☀ <img onerror=alert(1)>'})).status,200);
  const own=(await f.call(`/api/games/${id}`,'GET',undefined,sa.token)).data;
  const agent=(await f.call(`/api/games/${id}`,'GET',undefined,sb.token)).data;
  const publicState=(await f.call(`/api/games/${id}`)).data;
  assert.equal(own.events.filter(e=>e.type==='message').length,1);assert.equal(agent.events.filter(e=>e.type==='message').length,1);
  assert.equal(publicState.events.filter(e=>e.type==='message').length,0);assert.equal(agent.commandBudget.reserved.length,0);assert.equal(own.commandBudget.reserved.length,1);
  assert.equal(own.economyThreshold,Math.ceil(own.sides.reduce((n,s)=>n+s.economy,0)*.6));
  assert.equal(own.sides.find(s=>s.members.includes('usa')).economy,
    own.provinces.filter(p=>p.owner==='usa').reduce((n,p)=>n+p.development,0));
  for(const field of ['hostId','receipts','actionLog'])assert.equal(Object.hasOwn(publicState,field),false);
  assert.equal(JSON.stringify(publicState).includes(sa.token),false);
  const preview=(await f.call(`/api/games/${id}/preview?from=west-us&to=mexico&amount=5`)).data;assert.match(preview.summary,/3 surviving troops/);
  f.app.step(f.app.games.get(id),first.data.arrivesAt);const done=(await f.call(`/api/games/${id}`)).data;
  assert.equal(done.provinces.find(p=>p.id==='mexico').owner,'usa');
});
test('SQLite restart preserves credentials, committed armies, inboxes, idempotency and exactly-once results',async t=>{
  const f=await fixture(t,{disk:true}),{a,id,sa}=await f.boot();await f.call(`/api/games/${id}/start`,'POST',{},sa.token);
  const payload={opId:'persist-move',action:{type:'move',from:'west-us',to:'mexico',amount:5}};
  const accepted=await f.call(`/api/games/${id}/actions`,'POST',payload,sa.token);f.app.step(f.app.games.get(id),1);
  await f.restart();
  const state=(await f.call(`/api/games/${id}`,'GET',undefined,sa.token)).data;assert.equal(state.tick,1);assert.equal(state.armies.length,1);
  assert.deepEqual(await f.call(`/api/games/${id}/actions`,'POST',payload,sa.token),accepted);
  f.app.step(f.app.games.get(id),1799);assert.equal(f.app.games.get(id).status,'finished');
  let history=(await f.call('/api/me','GET',undefined,a.token)).data.history;assert.equal(history.length,1);assert.equal(history[0].prestige,f.app.games.get(id).outcome.scores.find(s=>s.country==='usa').prestige);
  await f.restart();history=(await f.call('/api/me','GET',undefined,a.token)).data.history;assert.equal(history.length,1);
  const standings=(await f.call('/api/standings')).data.standings;assert.equal(standings.find(s=>s.id===a.id).matches,1);
  assert.equal((await f.call('/api/standings?eligible=true')).data.standings.length,0);
  const onDisk=readFileSync(pathJoin(f.dir,'state.db'));assert.equal(onDisk.includes(Buffer.from(sa.token)),false);
});
test('built-in practice bots invalidate league eligibility and use the common game engine to completion',async t=>{
  const f=await fixture(t,{league:true}),{id,sa}=await f.boot();
  assert.equal(f.app.games.get(id).eligible,true);
  assert.equal((await f.call(`/api/games/${id}/bots`,'POST',{},sa.token)).data.players,8);
  await f.call(`/api/games/${id}/start`,'POST',{},sa.token);const g=f.app.games.get(id);f.app.step(g,1800);
  assert.equal(g.status,'finished');assert.equal(g.eligible,false);assert.equal(g.outcome.scores.length,8);
  assert.ok(g.actionLog.some(a=>a.opId.startsWith('bot-')));
});
test('real CLI subprocess joins, observes, sends orders, reconnects from a private session file',async t=>{
  const f=await fixture(t),host=await f.register('Host'),id=await f.room(host);const sa=await f.seat(id,host,'usa');
  const env={COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'cli.session.json'),COUNCIL_TOKEN:'',COUNCIL_MATCH:''};
  const run=(...args)=>subprocess('agents/cli.js',args,env);
  const joined=await run('join',id,'britain','CLI diplomat');assert.equal(joined.code,0,joined.stderr);assert.equal(JSON.parse(joined.stdout).country,'britain');
  assert.equal(statSync(env.COUNCIL_SESSION).mode & 0o777,0o600);
  await f.call(`/api/games/${id}/start`,'POST',{},sa.token);
  const moved=await run('move','england','north-france','5');assert.equal(moved.code,0,moved.stderr);
  const state=JSON.parse((await run('state')).stdout);assert.equal(state.you,'britain');assert.equal(state.commandBudget.reserved.length,1);
  const invalid=await run('move','west-us','mexico','5');assert.equal(invalid.code,1);assert.match(invalid.stderr,/not own/);
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
    {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'move',arguments:{from:'england',to:'north-france',amount:-1}}},
    {jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'unknown',arguments:{}}},
    {jsonrpc:'2.0',id:7,method:'ping'},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const result=await subprocess('agents/mcp.js',[],env,input);assert.equal(result.code,0,result.stderr);
  const output=result.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(output.length,7);
  assert.equal(output[0].result.protocolVersion,'2025-06-18');assert.equal(output[1].result.tools.length,22);
  assert.equal(JSON.parse(output[2].result.content[0].text).country,'britain');
  assert.equal(JSON.parse(output[3].result.content[0].text).you,'britain');
  assert.equal(output[4].error.code,-32602);assert.equal(output[5].error.code,-32602);assert.deepEqual(output[6].result,{});
});

test('industrial HTTP plans are private, atomic, synchronized, recallable and persistent',async t=>{
  const f=await fixture(t,{disk:true}),host=await f.register('Industrial human'),agent=await f.register('Industrial agent');
  const id=(await f.call('/api/games','POST',{name:'Industry'},host.token)).data.id;
  const usa=await f.seat(id,host,'usa'),germany=await f.seat(id,agent,'germany','agent');
  await f.call(`/api/games/${id}/start`,'POST',{},usa.token);
  const map=(await f.call(`/api/games/${id}/map`)).data;
  assert.equal(map.rulesVersion,3);assert.ok(map.provinces.length>64);
  const request={to:'mexico',sources:[{from:'west-us',percent:50},{from:'central-us',percent:50}]};
  const plan=await f.call(`/api/games/${id}/plan`,'POST',request,usa.token);
  assert.equal(plan.status,200);assert.equal(f.app.games.get(id).orders.length,0);
  assert.equal((await f.call(`/api/games/${id}/plan`,'POST',request,germany.token)).status,403);
  const receipt=(await f.call(`/api/games/${id}/actions`,'POST',{opId:'coordinate',action:{type:'attack',...request}},usa.token)).data;
  assert.equal(new Set(receipt.orders.map(o=>o.arrivesAt)).size,1);
  f.app.step(f.app.games.get(id),1);await f.restart();
  const restored=(await f.call(`/api/games/${id}`,'GET',undefined,usa.token)).data;
  assert.equal(restored.scenario,'imperial-1910-v3');assert.ok(restored.armies.some(a=>a.groupId===receipt.groupId));
  const recall={opId:'return',action:{type:'recall',id:receipt.groupId}};
  assert.equal((await f.call(`/api/games/${id}/actions`,'POST',recall,usa.token)).status,200);
  f.app.step(f.app.games.get(id),10);
  assert.ok(!f.app.games.get(id).armies.some(a=>a.groupId===receipt.groupId));
  f.app.step(f.app.games.get(id),140);
  const build=await f.call(`/api/games/${id}/actions`,'POST',{opId:'build',action:{type:'develop',from:'namibia'}},germany.token);
  assert.equal(build.status,200,JSON.stringify(build.data));
  f.app.step(f.app.games.get(id),61);assert.equal(f.app.games.get(id).provinces.find(p=>p.id==='namibia').development,2);
});

test('MCP exposes structured multi-source plans, validates nested schemas and retries one attack exactly once',async t=>{
  const f=await fixture(t),host=await f.register('Host'),other=await f.register('Opponent');
  const id=(await f.call('/api/games','POST',{name:'MCP industry'},host.token)).data.id;
  const seat=await f.seat(id,host,'usa');await f.seat(id,other,'britain');await f.call(`/api/games/${id}/start`,'POST',{},seat.token);
  const commands=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'plan_attack',arguments:{to:'mexico',sources:[{from:'west-us',percent:50},{from:'central-us',amount:4}]}}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'coordinated_attack',arguments:{to:'mexico',opId:'stable-plan',sources:[{from:'west-us',percent:50},{from:'central-us',amount:4}]}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'coordinated_attack',arguments:{to:'mexico',opId:'stable-plan',sources:[{from:'west-us',percent:50},{from:'central-us',amount:4}]}}},
    {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'plan_attack',arguments:{to:'mexico',sources:[{from:'west-us',percent:101}]}}},
    {jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'plan_attack',arguments:{to:'mexico',sources:[{from:'west-us',amount:4,unexpected:true}]}}},
  ];
  const result=await subprocess('agents/mcp.js',[],{COUNCIL_URL:f.url,COUNCIL_SESSION:pathJoin(f.dir,'industrial.session.json'),COUNCIL_MATCH:id,COUNCIL_TOKEN:seat.token},commands.map(JSON.stringify).join('\n')+'\n');
  assert.equal(result.code,0,result.stderr);const responses=result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(JSON.parse(responses[1].result.content[0].text).sources.length,2);
  assert.deepEqual(responses[2].result,responses[3].result);assert.equal(f.app.games.get(id).orders.length,2);
  assert.equal(responses[4].error.code,-32602);assert.equal(responses[5].error.code,-32602);
});

test('the active scenario contributes to standings and player history',async t=>{
  const f=await fixture(t),{a,id,sa}=await f.boot();await f.call(`/api/games/${id}/start`,'POST',{},sa.token);
  const g=f.app.games.get(id);g.provinces.find(p=>p.id==='mexico').owner='usa';g.provinces.find(p=>p.id==='mexico').nextRecruit=20;f.app.step(g,1800);
  assert.equal((await f.call('/api/standings')).data.standings.length,2);
  assert.equal((await f.call('/api/standings?scenario=classic-64')).status,400);
  assert.equal((await f.call('/api/me','GET',undefined,a.token)).data.history[0].scenario,'imperial-1910-v3');
});
