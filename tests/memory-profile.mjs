// Local profiling harness. Run with: node --expose-gc tests/memory-profile.mjs
// It uses the real HTTP API and server-owned clock stepping, with no public clock endpoint.
import { makeServer } from '../src/server.js';
import { writeHeapSnapshot } from 'node:v8';
import { statSync } from 'node:fs';
import { boardView } from '../agents/board.js';
import { decisionView } from '../agents/decision-view.js';

const app = makeServer({ dbPath: ':memory:', automatic: false, gameIdFactory: (() => { let n=0; return () => `memory${++n}`; })() });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const req = async (path, method='GET', data, token) => {
  const response=await fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
};
const collect = () => { global.gc?.(); return process.memoryUsage(); };
const mb = n => +(n/2**20).toFixed(2);
try {
  const host=await req('/api/players','POST',{name:'Memory probe'});
  const samples=[];
  for(let roomNo=1;roomNo<=3;roomNo++){
    const {id}=await req('/api/games','POST',{name:`Memory match ${roomNo}`,preset:'quick'},host.token);
    const seat=await req(`/api/games/${id}/join`,'POST',{country:'britain',kind:'agent'},host.token);
    await req(`/api/games/${id}/bots`,'POST',{count:7},host.token);
    await req(`/api/games/${id}/start`,'POST',{},host.token);
    let g=app.games.get(id),map=await req(`/api/games/${id}/map`,'GET',undefined,seat.token);
    samples.push({room:roomNo,phase:'start',tick:g.tick,...Object.fromEntries(Object.entries(collect()).map(([k,v])=>[k,mb(v)]))});
    for(let tick=0;tick<1800 && g.status==='running';tick++){
      app.step(g,1);
      if(tick%120===119){
        // Poll as a browser/spectator and agents do. Anonymous view/feed and host view/inbox.
        const cursor=g.sequence;
        const [observation]=await Promise.all([
          req(`/api/games/${id}?after=${Math.max(0,cursor-120)}&inbox=1`,'GET',undefined,seat.token),
          req(`/api/games/${id}/feed?after=${Math.max(0,cursor-120)}&limit=100`),
          req(`/api/games/${id}/inbox`,'GET',undefined,seat.token),
        ]);
        boardView(observation,map);decisionView(observation,map);
      }
    }
    const m=collect();g=app.games.get(id);const history=app.store.loadHistory(id);
    samples.push({room:roomNo,phase:'finished',tick:g.tick,status:g.status,events:history.events.length,actionLog:history.actionLog.length,
      receipts:Object.keys(history.receipts).length,headlines:Object.keys(history.headlines).length,
      gameJsonBytes:Buffer.byteLength(JSON.stringify(g)),historyJsonBytes:Buffer.byteLength(JSON.stringify(history)),roomsInMap:app.games.size,
      ...Object.fromEntries(Object.entries(m).map(([k,v])=>[k,mb(v)]))});
    if(process.env.MEMORY_SNAPSHOT && (roomNo===1 || roomNo===3)){
      const path=writeHeapSnapshot(`artifacts/memory-${roomNo}-${g.status}.heapsnapshot`);
      samples.at(-1).snapshot={path,bytes:statSync(path).size};
    }
  }
  console.log(JSON.stringify(samples,null,2));
} finally { await app.close(); }
