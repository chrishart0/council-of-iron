import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Store } from './store.js';
import { act, attackPlan, createGame, join, observe, preview, start, tick, worldFeed, RuleError, requireRule, text } from './engine.js';
import { buildReview, unavailableReview } from './review.js';
import { replayReader } from '../public/replay-model.js';
import { operationalInsights } from '../public/insights.js';
import { choose } from '../agents/policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const MAP = JSON.parse(readFileSync(resolve(root, 'public/imperial-map.json'), 'utf8'));
const PRESETS = { standard: 1, quick: 6 };
const staticFiles = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/atlas.js', ['public/atlas.js', 'text/javascript; charset=utf-8']],
  ['/presentation.js', ['public/presentation.js', 'text/javascript; charset=utf-8']],
  ['/feed.js', ['public/feed.js', 'text/javascript; charset=utf-8']],
  ['/feed-model.js', ['public/feed-model.js', 'text/javascript; charset=utf-8']],
  ['/leaderboard.js', ['public/leaderboard.js', 'text/javascript; charset=utf-8']],
  ['/leaderboard-panel.js', ['public/leaderboard-panel.js', 'text/javascript; charset=utf-8']],
  ['/feed.css', ['public/feed.css', 'text/css; charset=utf-8']],
  ['/ui.js', ['public/ui.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/review.js', ['public/review.js', 'text/javascript; charset=utf-8']],
  ['/review.css', ['public/review.css', 'text/css; charset=utf-8']],
  ['/replay-model.js', ['public/replay-model.js', 'text/javascript; charset=utf-8']],
  ['/insights.js', ['public/insights.js', 'text/javascript; charset=utf-8']],
  ['/movement.js', ['public/movement.js', 'text/javascript; charset=utf-8']],
  ['/map.json', ['public/imperial-map.json', 'application/json']],
]);
async function body(req) {
  requireRule((req.headers['content-type'] || '').startsWith('application/json'), 'Use application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; requireRule(size <= 16384, 'Request body too large.', 413); chunks.push(chunk);
  }
  try { const result=JSON.parse(Buffer.concat(chunks).toString('utf8')); requireRule(result && typeof result==='object' && !Array.isArray(result),'Expected a JSON object.'); return result; }
  catch (e) { if (e instanceof RuleError) throw e; throw new RuleError('Invalid JSON.'); }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
/** `clockScale` accelerates ALL game timing in local tests; no HTTP endpoint can advance time. */
export function makeServer({ dbPath = resolve(root,'data/council.db'), clockScale = 1,
  publicOrigin = process.env.PUBLIC_ORIGIN || '', league = process.env.LEAGUE_MODE === '1', automatic = true } = {}) {
  const store = new Store(dbPath), games = new Map(store.load()
    .filter(g=>g.scenario===MAP.id && (g.rules?.economyShare===.6 || g.status==='finished' && g.afterAction))
    .map(g=>[g.id,g]));
  const fractions = new Map(), ipBudgets = new Map();
  let previous = performance.now();
  const replayReaders = new Map(); // At most four decoded public records in memory.
  function afterAction(g) {
    requireRule(g.status === 'finished' && g.outcome, 'After-action review is available only when the match is finished.', 409);
    if (!g.afterAction) {
      try { g.afterAction = buildReview(g, MAP); }
      catch (error) {
        console.error('Review reconstruction withheld:', g.id, error.message);
        g.afterAction = unavailableReview(g, 'This match could not be reconstructed exactly. Final scores are intact; no approximate replay is shown.');
      }
      save(g);
    }
    return g.afterAction;
  }
  function save(g) { store.save(g); }
  function runBots(g) {
    if (g.tick % 5 !== 0) return;
    for (const p of g.players.filter(p=>p.kind==='bot')) {
      const action=choose(observe(g,p.id,g.sequence),MAP,p.id);
      if (action) try { act(g,MAP,p.id,action,`bot-${g.tick}-${p.id}`); }
      catch (e) { if (!(e instanceof RuleError)) throw e; }
    }
  }
  function step(g, count) {
    for (let i=0;i<count && g.status==='running';i++) { tick(g); if(g.status==='running') runBots(g); }
    if (g.status === 'finished') afterAction(g);
    else save(g);
  }
  const server = createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const port=server.address()?.port;
      const allowedHosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`, ...(publicOrigin ? [new URL(publicOrigin).host] : [])]);
      requireRule(allowedHosts.has(req.headers.host),'Unrecognized Host. Configure PUBLIC_ORIGIN for LAN/proxy access.',403);
      if(req.headers.origin) requireRule(req.headers.origin===`http://${req.headers.host}` || req.headers.origin===publicOrigin,'Cross-origin request rejected.',403);
      const url=new URL(req.url,`http://${req.headers.host}`), path=url.pathname;
      if(req.method==='GET' && staticFiles.has(path)) {
        const [file,type]=staticFiles.get(path); res.writeHead(200,{'Content-Type':type}); res.end(readFileSync(resolve(root,file))); return;
      }
      if(req.method==='GET' && path==='/favicon.ico') {res.writeHead(204);res.end();return;}
      const rawToken=req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
      const identity=store.authenticate(rawToken);
      if(rawToken) requireRule(identity,'Invalid credential.',401);
      function auth(gameId=null) {
        requireRule(identity,'A bearer credential is required.',401);
        requireRule(!identity.gameId || identity.gameId===gameId,'This credential is scoped to a different match.',403);
        return identity;
      }
      if(req.method==='POST') {
        // Coarse transport abuse bound, separate from simulation action cooldowns.
        const ip=req.socket.remoteAddress, now=Date.now();
        let bucket=ipBudgets.get(ip); if(!bucket || now-bucket.at>60000) {bucket={at:now,count:0};ipBudgets.set(ip,bucket);}
        requireRule(++bucket.count<=1200,'Transport request limit exceeded.',429);
      }
      if(path==='/api/health' && req.method==='GET') return json(res,200,{ok:true,version:'0.5.0'});
      if(path==='/api/players' && req.method==='POST') {
        const data=await body(req); return json(res,201,store.register(text(data.name,'Player name',40)));
      }
      if(path==='/api/me' && req.method==='GET') {
        const me=auth(); return json(res,200,{id:me.id,name:me.name,history:store.history(me.id)});
      }
      if(path==='/api/standings' && req.method==='GET') {
        requireRule(!url.searchParams.has('scenario') || url.searchParams.get('scenario')===MAP.id,'Unknown scenario.');
        const eligible=url.searchParams.get('eligible')==='true'; return json(res,200,{eligible,standings:store.standings(eligible,MAP.id)});
      }
      if(path==='/api/games' && req.method==='GET') {
        const all=[...games.values()],active=all.filter(g=>g.status!=='finished').reverse();
        const listed=[...active,...all.filter(g=>g.status==='finished').reverse().slice(0,50-active.length)];
        return json(res,200,{games:listed.map(g=>({
          id:g.id,name:g.name,status:g.status,tick:g.tick,speed:g.speed,
          you:identity && (!identity.gameId || identity.gameId===g.id) ? g.players.find(p=>p.profileId===identity.id)?.id || null : null,
          players:g.players.map(p=>({id:p.id,name:p.name,kind:p.kind})),eligible:g.eligible}))});
      }
      if(path==='/api/games' && req.method==='POST') {
        const me=auth(), data=await body(req);
        requireRule(Object.hasOwn(PRESETS,data.preset || 'standard'),'Unknown time preset.');
        requireRule([...games.values()].filter(g=>g.status!=='finished').length<32,'This prototype supports 32 active rooms.',429);
        requireRule(data.scenario===undefined || data.scenario===MAP.id,'Unknown scenario.');
        const g=createGame({id:randomUUID().slice(0,8),name:data.name || 'Council chamber',hostId:me.id,
          speed:PRESETS[data.preset || 'standard'],eligible:league},MAP);
        games.set(g.id,g);save(g);return json(res,201,{id:g.id});
      }
      const match=path.match(/^\/api\/games\/([a-zA-Z0-9-]+)(?:\/(join|start|bots|actions|preview|plan|map|review|replay|feed))?$/);
      if(match) {
        const g=games.get(match[1]);requireRule(g,'Room not found.',404);
        const endpoint=match[2], gameMap=MAP;
        function seat() { const me=auth(g.id),p=g.players.find(p=>p.profileId===me.id);requireRule(p,'Join a country first.',403);return p; }
        function host() { const me=auth(g.id);requireRule(me.id===g.hostId,'Only the host can do that.',403); }
        if(!endpoint && req.method==='GET') {
          if(identity) auth(g.id);
          const p=identity && g.players.find(p=>p.profileId===identity.id);
          const after=Number(url.searchParams.get('after') || 0);
          requireRule(Number.isSafeInteger(after) && after>=0,'Invalid event cursor.');
          const view = observe(g,p?.id || null,after);
          return json(res,200,{...view, insights:operationalInsights(view), isHost:identity?.id===g.hostId});
        }
        if(endpoint==='feed' && req.method==='GET') {
          // Public World feed: world chat + engine headlines only. Same for every viewer.
          if(identity) auth(g.id);
          const after=Number(url.searchParams.get('after') || 0),limit=Number(url.searchParams.get('limit') || 100);
          return json(res,200,worldFeed(g,after,limit));
        }
        if (['review', 'replay'].includes(endpoint) && req.method === 'GET') {
          if (identity) auth(g.id);
          const data = afterAction(g);
          if (endpoint === 'review') return json(res, 200, data.report);
          requireRule(data.replay, data.report.historyError || 'Replay unavailable.', 409);
          if (!url.searchParams.has('tick')) return json(res, 200, data.replay);
          const raw = url.searchParams.get('tick'), at = Number(raw);
          requireRule(/^\d+$/.test(raw) && Number.isSafeInteger(at) && at >= 0 && at <= g.tick, `Replay tick must be from 0 to ${g.tick}.`);
          if (!replayReaders.has(g.id)) {
            if (replayReaders.size >= 4) replayReaders.delete(replayReaders.keys().next().value);
            replayReaders.set(g.id, replayReader(data.replay));
          }
          return json(res, 200, replayReaders.get(g.id)(at));
        }
        if(endpoint==='map' && req.method==='GET') {
          if(identity) auth(g.id);
          return json(res,200,g.afterAction?.replay?.map || gameMap);
        }
        if(endpoint==='plan' && req.method==='POST') {
          const p=seat(), data=await body(req);
          return json(res,200,attackPlan(g,gameMap,p.id,data));
        }
        if(endpoint==='preview' && req.method==='GET') {
          if(identity) auth(g.id);
          return json(res,200,preview(g,gameMap,url.searchParams.get('from'),url.searchParams.get('to'),Number(url.searchParams.get('amount')),g.players.find(p=>p.profileId===identity?.id)?.id || null));
        }
        if(endpoint==='join' && req.method==='POST') {
          const me=auth(g.id),data=await body(req);
          requireRule(data.kind===undefined || ['human','agent'].includes(data.kind),'External clients choose human or agent.');
          const existing=g.players.find(p=>p.profileId===me.id);
          if(existing && g.status!=='lobby') {
            requireRule(existing.id===data.country,'You already control a different country.',409);
          } else join(g,gameMap,{...data,profileId:me.id,name:me.name});
          save(g);return json(res,200,{country:data.country,token:store.credential(me.id,g.id),match:g.id});
        }
        if(endpoint==='start' && req.method==='POST') {host();seat();await body(req);start(g);fractions.set(g.id,0);save(g);return json(res,200,{ok:true});}
        if(endpoint==='bots' && req.method==='POST') {
          host();await body(req);requireRule(g.status==='lobby','Cannot add seats during play.',409);
          for(const c of gameMap.countries.filter(c=>!g.players.some(p=>p.id===c.id))) {
            const profile=store.register(`${c.name.split(' ')[0]} automaton`);
            join(g,gameMap,{profileId:profile.id,name:profile.name,country:c.id,kind:'bot',model:'heuristic-industrial-v3',persona:'expansion-first'});
          }
          save(g);return json(res,200,{ok:true,players:g.players.length});
        }
        if(endpoint==='actions' && req.method==='POST') {
          const p=seat(),data=await body(req);
          const result=act(g,gameMap,p.id,data.action,data.opId);save(g);return json(res,200,result);
        }
      }
      throw new RuleError('Not found.',404);
    } catch(error) {
      if(!(error instanceof RuleError)) console.error(error);
      if(!res.headersSent) json(res,error.status || 500,{error: error instanceof RuleError ? error.message : 'Internal server error.'});
      else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const interval=automatic ? setInterval(()=>{
    const now=performance.now(), elapsed=(now-previous)*clockScale;previous=now;
    try {
      for(const g of games.values()) if(g.status==='running') {
        const accumulated=(fractions.get(g.id)||0)+elapsed*g.speed;
        const count=Math.floor(accumulated/1000);fractions.set(g.id,accumulated%1000);
        if(count) step(g,count);
      }
      for(const [ip,bucket] of ipBudgets) if(Date.now()-bucket.at>60000) ipBudgets.delete(ip);
    } catch(error) { console.error('Simulation halted to avoid unsaved progress:',error);clearInterval(interval); }
  },100) : null;
  return {server,store,games,step, async close(){clearInterval(interval);for(const g of games.values())save(g);
    await new Promise(resolve=>server.close(resolve));store.close();} };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 3107),host=process.env.HOST || '0.0.0.0';
  const publicOrigin=process.env.PUBLIC_ORIGIN || `http://192.168.1.216:${port}`;
  const app=makeServer({publicOrigin});
  app.server.listen(port,host,()=>console.log(`Council of Iron: ${publicOrigin} (SQLite; single process)`));
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
