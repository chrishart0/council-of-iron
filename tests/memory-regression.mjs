import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../src/server.js';
import { boardView } from '../agents/board.js';
import { decisionView } from '../agents/decision-view.js';

test('finished rooms release private history and keep their public archive durable', async t => {
  const app = makeServer({ dbPath: ':memory:', automatic: false,
    gameIdFactory: (() => { let n=0; return () => `mem${++n}`; })() });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, method='GET', data, token) => {
    const response=await fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
    assert.ok([200,201].includes(response.status),`${method} ${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  };
  const host=await call('/api/players','POST',{name:'Memory check'});
  const before=process.memoryUsage().heapUsed;
  for(let n=1;n<=3;n++){
    const {id}=await call('/api/games','POST',{name:`Memory ${n}`,preset:'quick'},host.token);
    const seat=await call(`/api/games/${id}/join`,'POST',{country:'britain',kind:'agent'},host.token);
    await call(`/api/games/${id}/bots`,'POST',{count:7},host.token);
    await call(`/api/games/${id}/start`,'POST',{},host.token);
    const g=app.games.get(id),map=await call(`/api/games/${id}/map`,'GET',undefined,seat.token);
    for(let part=0;part<15 && g.status==='running';part++){
      app.step(g,120);
      const after=g.sequence;
      const [observation]=await Promise.all([
        call(`/api/games/${id}?after=${Math.max(0,after-120)}&inbox=1`,'GET',undefined,seat.token),
        call(`/api/games/${id}/feed?after=${Math.max(0,after-120)}&limit=100`),
        call(`/api/games/${id}/inbox`,'GET',undefined,seat.token),
      ]);
      boardView(observation,map);decisionView(observation,map);
    }
    assert.equal(g.status,'finished');
    assert.equal(g.archiveMaterialized,true);
    assert.equal(g.afterAction,undefined);
    assert.deepEqual(g.events,[]);assert.deepEqual(g.receipts,{});assert.deepEqual(g.actionLog,[]);
    assert.equal(app.store.activity().has(id),false,'finished room activity is pruned');
    assert.ok(Buffer.byteLength(JSON.stringify(g))<60_000,'live room shell should not contain match history or the replay archive');
    const archived=app.store.loadGame(id);
    assert.equal(archived.afterAction.report.id,id);
    assert.equal(archived.afterAction.replay.duration,g.tick);
    assert.deepEqual(archived.actionLog,[]);assert.ok(archived.events.length>0);assert.ok(Object.keys(archived.receipts).length>0);
    assert.equal((await call(`/api/games/${id}/review`)).id,id);
  }
  global.gc?.();await new Promise(resolve=>setImmediate(resolve));global.gc?.();
  const after=process.memoryUsage().heapUsed;
  assert.ok(after-before<55*2**20,`three finished rooms retained ${(after-before)/2**20} MiB of heap`);
});
