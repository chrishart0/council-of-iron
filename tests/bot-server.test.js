import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { makeServer } from '../src/server.js';
import { createBot } from '../agents/bots/controller.js';
import { BOT_VERSION } from '../public/bot-profiles.js';
import { observe } from '../src/engine.js';

async function fixture(t, scenario) {
  const dir=mkdtempSync(pathJoin(tmpdir(),'council-ai-')),dbPath=pathJoin(dir,'state.db');
  let app=makeServer({dbPath,automatic:false}),url;
  const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${app.server.address().port}`;};await listen();
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const request=async(path,method='GET',data,token)=>{const res=await fetch(url+path,{method,headers:{Connection:'close',...(token?{Authorization:`Bearer ${token}`}:{ }),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,data:await res.json()};};
  const host=(await request('/api/players','POST',{name:'Host'})).data;
  const room=(await request('/api/games','POST',{name:'Bot council',...(scenario?{scenario}:{})},host.token)).data.id;
  await request(`/api/games/${room}/join`,'POST',{country:'usa'},host.token);
  return {request,dir,host,room,get app(){return app;},get url(){return url;},get game(){return app.games.get(room);},
    bots:(data={})=>request(`/api/games/${room}/bots`,'POST',data,host.token),
    start:()=>request(`/api/games/${room}/start`,'POST',{},host.token),
    async restart(){await app.close();app=makeServer({dbPath,automatic:false});await listen();}};
}
async function waitFor(check, ms=10000) {const until=Date.now()+ms;while(!check()){if(Date.now()>until)throw new Error('Timed out waiting for bot');await new Promise(r=>setTimeout(r,80));}}

test('host can fill or configure individual bot seats; settings are public and bonuses absent',async t=>{
  const f=await fixture(t),r=await f.bots({country:'germany',difficulty:'hard',personality:'builder'});
  assert.equal(r.status,200);assert.equal(f.game.players.length,2);
  const bot=f.game.players.find(p=>p.id==='germany');assert.equal(bot.model,BOT_VERSION);assert.deepEqual(bot.bot,{difficulty:'hard',personality:'builder'});
  const troops=f.game.provinces.filter(p=>p.owner==='germany').map(p=>p.troops);
  await f.bots({country:'germany',difficulty:'easy',personality:'diplomat'});
  assert.equal(f.game.players.length,2);assert.deepEqual(f.game.provinces.filter(p=>p.owner==='germany').map(p=>p.troops),troops);
  await f.bots();assert.equal(f.game.players.length,8);assert.equal(f.game.eligible,false);
  assert.equal((await f.request(`/api/games/${f.room}`)).data.players.find(p=>p.id==='germany').bot.difficulty,'easy');
});
test('invalid settings, human-seat replacement and non-host configuration are rejected without partial writes',async t=>{
  const f=await fixture(t);const before=JSON.stringify(f.game),profiles=()=>f.app.store.db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n;
  const n=profiles();
  for(const data of [{difficulty:'impossible'},{bonus:100},{country:'unknown'},{personality:'evil'},{country:'usa'}])assert.ok((await f.bots(data)).status>=400);
  assert.equal(JSON.stringify(f.game),before);assert.equal(profiles(),n);
  const other=(await f.request('/api/players','POST',{name:'Other'})).data;
  assert.equal((await f.request(`/api/games/${f.room}/bots`,'POST',{},other.token)).status,403);
});
test('difficulty and doctrine cannot be changed in a live match',async t=>{
  const f=await fixture(t);await f.bots();await f.start();
  const old=structuredClone(f.game.botControllers);
  assert.equal((await f.bots({country:'germany',difficulty:'easy'})).status,409);
  assert.deepEqual(f.game.botControllers,old);
});
test('bot memory survives SQLite restart and resumes the identical decision sequence',async t=>{
  const f=await fixture(t);await f.bots();await f.start();f.app.step(f.game,105);
  const checkpoint=structuredClone(f.game);f.app.step(f.game,130);
  const expected=structuredClone({actions:f.game.actionLog,events:f.game.events,brains:f.game.botControllers,provinces:f.game.provinces});
  f.app.games.set(f.room,checkpoint);await f.restart();f.app.step(f.game,130);
  assert.deepEqual({actions:f.game.actionLog,events:f.game.events,brains:f.game.botControllers,provinces:f.game.provinces},expected);
});
test('private bot memory and inboxes are absent from spectators, other seats and public replay',async t=>{
  const f=await fixture(t);await f.bots({difficulty:'easy'});await f.start();f.app.step(f.game,10);
  f.game.botControllers.germany.privateTest='PRIVATE_BOT_SENTINEL';
  for(const token of [undefined,f.host.token]){
    const s=(await f.request(`/api/games/${f.room}`,'GET',undefined,token)).data;
    assert.ok(!JSON.stringify(s).includes('PRIVATE_BOT_SENTINEL'));assert.ok(!Object.hasOwn(s,'botControllers'));
  }
  f.app.step(f.game,1800);
  const r=await f.request(`/api/games/${f.room}/review`);assert.equal(r.status,200);assert.equal(r.data.historyAvailable,true);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_BOT_SENTINEL'));
  assert.ok(!JSON.stringify((await f.request(`/api/games/${f.room}/replay`)).data).includes('PRIVATE_BOT_SENTINEL'));
});
test('new traditional bots also finish the classic scenario without industrial-only commands',async t=>{
  const f=await fixture(t,'classic-64');await f.bots({difficulty:'easy'});await f.start();f.app.step(f.game,1800);
  assert.equal(f.game.status,'finished');assert.ok(f.game.actionLog.length>0);
  assert.ok(!f.game.actionLog.some(a=>['attack','recall','develop'].includes(a.action.type)));
});
test('legacy saved bots keep their previous policy instead of switching mid-match',async t=>{
  const f=await fixture(t);await f.bots({country:'germany'});
  const p=f.game.players.find(p=>p.id==='germany');p.model='heuristic-industrial-v3';delete f.game.botControllers;
  await f.start();f.app.step(f.game,10);assert.ok(!f.game.botControllers);
  assert.ok(f.game.actionLog.some(a=>a.country==='germany'));
});
test('external bot retries a lost response with the same operation ID, saves private memory and completes',async t=>{
  const f=await fixture(t),agent=(await f.request('/api/players','POST',{name:'External commander'})).data;
  const seat=(await f.request(`/api/games/${f.room}/join`,'POST',{country:'britain',kind:'agent'},agent.token)).data;
  await f.start();f.app.step(f.game,10);
  let dropped=false;const seen=[];
  const proxy=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=Buffer.concat(chunks);
      const upstream=await fetch(f.url+req.url,{method:req.method,headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(data.length?{'Content-Type':'application/json'}:{})},body:data.length?data:undefined});
      const text=await upstream.text();
      if(req.url.endsWith('/actions')){seen.push(JSON.parse(data).opId);if(!dropped&&upstream.ok){dropped=true;res.destroy();return;}}
      res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(text);
    } catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>proxy.close(r)));
  const memory=pathJoin(f.dir,'external.bot.json');
  const child=spawn(process.execPath,['agents/bot.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,
    COUNCIL_URL:`http://127.0.0.1:${proxy.address().port}`,COUNCIL_TOKEN:seat.token,COUNCIL_MATCH:f.room,COUNCIL_COUNTRY:'britain',
    COUNCIL_SESSION:pathJoin(f.dir,'unused.session.json'),COUNCIL_BOT_STATE:memory,COUNCIL_BOT_DIFFICULTY:'hard'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await waitFor(()=>seen.length>=2 && existsSync(memory) && !JSON.parse(readFileSync(memory)).pending);
  assert.equal(seen[0],seen[1]);assert.equal(f.game.actionLog.filter(a=>a.opId===seen[0]).length,1);
  assert.equal(statSync(memory).mode&0o777,0o600);assert.equal(JSON.parse(readFileSync(memory)).brain.config.difficulty,'hard');
  assert.ok(!readFileSync(memory,'utf8').includes(seat.token));
  f.app.step(f.game,1800);await waitFor(()=>child.exitCode!==null);
  assert.equal(child.exitCode,0,stderr);assert.deepEqual(JSON.parse(stdout),f.game.outcome);
});

test('external bot refuses mismatched persisted settings instead of silently ignoring requested difficulty',async t=>{
  const f=await fixture(t), path=pathJoin(f.dir,'pinned.bot.json');
  const brain=createBot('usa',{difficulty:'easy',personality:'diplomat'},'fixed');
  writeFileSync(path,JSON.stringify({scope:`${f.url}/${f.room}/usa`,brain,pending:null}));
  const child=spawn(process.execPath,['agents/bot.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,
    COUNCIL_URL:f.url,COUNCIL_TOKEN:f.host.token,COUNCIL_MATCH:f.room,COUNCIL_COUNTRY:'usa',
    COUNCIL_SESSION:pathJoin(f.dir,'unused.session.json'),COUNCIL_BOT_STATE:path,COUNCIL_BOT_DIFFICULTY:'hard'},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>stderr+=b);t.after(()=>{if(child.exitCode===null)child.kill();});
  await waitFor(()=>child.exitCode!==null);assert.equal(child.exitCode,1);assert.match(stderr,/Settings differ from this saved commander/);
  assert.equal(JSON.parse(readFileSync(path)).brain.config.difficulty,'easy');assert.equal(f.game.actionLog.length,0);
});
