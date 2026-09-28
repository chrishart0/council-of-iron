import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Store } from './store.js';
import { RULES, act, attention, inbox, markRead, rallyPlan, turnAroundPlan, createGame, displayName, join, observe, preview, start, tick, worldFeed, RuleError, requireRule, text } from './engine.js';
import { buildReview, unavailableReview } from './review.js';
import { replayReader } from '../public/replay-model.js';
import { operationalInsights } from '../public/insights.js';
import { choose } from '../agents/policy.js';
import { makeStt } from './stt.js';

const root = fileURLToPath(new URL('../', import.meta.url));
import { MAP } from './maps.js';
export { MAP };
const PRESETS = { standard: 1, quick: 6 };
/** A stored room is loaded only when it was created on the current map and rules (every current rule
 * key is present, and none that has been removed); a finished one also needs its public record.
 * Rooms from earlier versions of the game are skipped at startup (logged), never migrated. */
export function loadable(g, map = MAP) {
  if (!g || typeof g !== 'object' || g.scenario !== map.id || !g.rules) return false;
  if (!same(Object.keys(RULES), Object.keys(g.rules).filter(key => key !== 'revealAllianceChatAfterMatch'))) return false;
  return g.status !== 'finished' || Boolean(g.afterAction && g.outcome);
}
const same = (a, b) => a.length === b.length && [...a].sort().every((key, i) => key === [...b].sort()[i]);
export const ALLIANCE_CHAT_NOTICE = 'Alliance chat becomes public in the replay after the match ends.';
const staticFiles = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/atlas.js', ['public/atlas.js', 'text/javascript; charset=utf-8']],
  ['/presentation.js', ['public/presentation.js', 'text/javascript; charset=utf-8']],
  ['/feed.js', ['public/feed.js', 'text/javascript; charset=utf-8']],
  ['/feed-model.js', ['public/feed-model.js', 'text/javascript; charset=utf-8']],
  ['/leaderboard.js', ['public/leaderboard.js', 'text/javascript; charset=utf-8']],
  ['/leaderboard-panel.js', ['public/leaderboard-panel.js', 'text/javascript; charset=utf-8']],
  ['/comms.css', ['public/comms.css', 'text/css; charset=utf-8']],
  ['/comms.js', ['public/comms.js', 'text/javascript; charset=utf-8']],
  ['/comms-model.js', ['public/comms-model.js', 'text/javascript; charset=utf-8']],
  // v0.9 War Room type (SIL OFL 1.1; licences in public/fonts).
  ...['alegreya-sc-regular', 'alegreya-sc-bold', 'barlow-condensed-medium', 'barlow-condensed-semibold'].map(f => [`/fonts/${f}.woff2`, [`public/fonts/${f}.woff2`, 'font/woff2']]),
  ['/ui.js', ['public/ui.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/review.js', ['public/review.js', 'text/javascript; charset=utf-8']],
  ['/review.css', ['public/review.css', 'text/css; charset=utf-8']],
  ['/map-layers.css', ['public/map-layers.css', 'text/css; charset=utf-8']],
  ['/map-geometry.js', ['public/map-geometry.js', 'text/javascript; charset=utf-8']],
  ['/relations.js', ['public/relations.js', 'text/javascript; charset=utf-8']],
  ['/replay-model.js', ['public/replay-model.js', 'text/javascript; charset=utf-8']],
  ['/insights.js', ['public/insights.js', 'text/javascript; charset=utf-8']],
  ['/movement.js', ['public/movement.js', 'text/javascript; charset=utf-8']],
  ['/sound.js', ['public/sound.js', 'text/javascript; charset=utf-8']],
  ['/sound-model.js', ['public/sound-model.js', 'text/javascript; charset=utf-8']],
  ['/audio/manifest.json', ['public/audio/manifest.json', 'application/json']],
  ...['theme', 'tension', 'effects'].flatMap(stem => [['ogg', 'audio/ogg'], ['mp3', 'audio/mpeg']]
    .map(([ext, type]) => [`/audio/${stem}.${ext}`, [`public/audio/${stem}.${ext}`, type]])),
  ['/combat.js', ['public/combat.js', 'text/javascript; charset=utf-8']],
  ['/map.json', ['public/imperial-map.json', 'application/json']],
  ['/expand.js', ['public/expand.js', 'text/javascript; charset=utf-8']],
  ['/voice.js', ['public/voice.js', 'text/javascript; charset=utf-8']],
  // Installable web app: "Add to Home Screen" opens a chrome-free full-screen game (manifest-src falls under default-src 'self').
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['public/icon.svg', 'image/svg+xml']],
  ['/icon-192.png', ['public/icon-192.png', 'image/png']],
  ['/icon-512.png', ['public/icon-512.png', 'image/png']],
  ['/apple-touch-icon.png', ['public/apple-touch-icon.png', 'image/png']],
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
  publicOrigin = process.env.PUBLIC_ORIGIN || '', automatic = true,
  sttUrl = process.env.STT_URL || '', tls = null, gameIdFactory = () => randomUUID().slice(0,8), map = MAP } = {}) {
  // `map` is the board new rooms are created on; tests replaying a recorded match pass the board it was played on.
  const mapFor = g => g?.scenario === map.id ? map : null;
  // PUBLIC_ORIGIN may list several comma-separated origins (e.g. LAN http plus an HTTPS name for phones).
  const publicOrigins = publicOrigin.split(',').map(o=>o.trim()).filter(Boolean);
  const stt = makeStt({ url: sttUrl });
  const store = new Store(dbPath), stored = store.load(), games = new Map(stored.filter(g=>loadable(g,map)).map(g=>[g.id,g]));
  if (stored.length > games.size) console.log(`Skipped ${stored.length-games.size} stored room(s) from an earlier version of the game: ${stored.filter(g=>!loadable(g,map)).map(g=>g?.id).join(', ')}`);
  const fractions = new Map(), ipBudgets = new Map();
  let previous = performance.now();
  // Practice bots remember peace they have seen (public truces) so they do not re-declare war soon after.
  // In memory only: after a restart a bot still respects every truce, it just forgets older peace.
  const botMemory = new Map();
  const replayReaders = new Map(); // At most four decoded public records in memory.
  function afterAction(g) {
    requireRule(g.status === 'finished' && g.outcome, 'After-action review is available only when the match is finished.', 409);
    if (!g.afterAction) {
      try { g.afterAction = buildReview(g, mapFor(g)); }
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
      const key=`${g.id}:${p.id}`;if(!botMemory.has(key))botMemory.set(key,new Map());
      const action=choose(observe(g,p.id,g.sequence),mapFor(g),p.id,botMemory.get(key));
      if (action) try { act(g,mapFor(g),p.id,action,`bot-${g.tick}-${p.id}`); }
      catch (e) { if (!(e instanceof RuleError)) throw e; }
    }
  }
  function step(g, count) {
    for (let i=0;i<count && g.status==='running';i++) { tick(g); if(g.status==='running') runBots(g); }
    if (g.status === 'finished') afterAction(g);
    else save(g);
  }
  const handler = async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const port=req.socket.localPort, scheme=req.socket.encrypted ? 'https' : 'http';
      const allowedHosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`, ...publicOrigins.map(o=>new URL(o).host)]);
      requireRule(allowedHosts.has(req.headers.host),'Unrecognized Host. Configure PUBLIC_ORIGIN for LAN/proxy access.',403);
      if(req.headers.origin) requireRule(req.headers.origin===`${scheme}://${req.headers.host}` || publicOrigins.includes(req.headers.origin),'Cross-origin request rejected.',403);
      const url=new URL(req.url,`http://${req.headers.host}`), path=url.pathname;
      if(req.method==='GET' && staticFiles.has(path)) {
        const [file,type]=staticFiles.get(path);
        // Audio is large and versioned by ?v=<manifest hash>; let browsers keep it for a day.
        if(type.startsWith('audio/') || type==='font/woff2')res.setHeader('Cache-Control','public, max-age=86400');
        res.writeHead(200,{'Content-Type':type}); res.end(readFileSync(resolve(root,file))); return;
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
      // Optional human voice input (docs/API.md): capability flag only; no game state.
      if(path==='/api/stt' && req.method==='GET') return json(res,200,{available:await stt.available()});
      if(path==='/api/players' && req.method==='POST') {
        const data=await body(req); return json(res,201,store.register(text(data.name,'Player name',40)));
      }
      if(path==='/api/standings' && req.method==='GET') return json(res,200,{standings:store.standings()});
      if(path==='/api/games' && req.method==='GET') {
        const all=[...games.values()],active=all.filter(g=>g.status!=='finished').reverse();
        const listed=[...active,...all.filter(g=>g.status==='finished').reverse().slice(0,50-active.length)];
        return json(res,200,{games:listed.map(g=>({
          id:g.id,name:g.name,status:g.status,tick:g.tick,speed:g.speed,
          you:identity && (!identity.gameId || identity.gameId===g.id) ? g.players.find(p=>p.profileId===identity.id)?.id || null : null,
          players:g.players.map(p=>({id:p.id,name:p.name,displayName:displayName(p),kind:p.kind,model:p.model}))}))});
      }
      if(path==='/api/games' && req.method==='POST') {
        const me=auth(), data=await body(req);
        requireRule(Object.hasOwn(PRESETS,data.preset || 'standard'),'Unknown time preset.');
        requireRule([...games.values()].filter(g=>g.status!=='finished').length<32,'This server is full: 32 rooms are already active.',429);
        const gameId=gameIdFactory();
        requireRule(typeof gameId==='string' && /^[a-zA-Z0-9-]{1,32}$/.test(gameId) && !games.has(gameId),'Invalid or duplicate room ID.');
        const g=createGame({id:gameId,name:data.name || 'Council chamber',hostId:me.id,
          speed:PRESETS[data.preset || 'standard']},map);
        // New rooms only (never inside createGame): alliance chat is published in the finished replay.
        g.rules.revealAllianceChatAfterMatch=true;
        games.set(g.id,g);save(g);return json(res,201,{id:g.id});
      }
      const match=path.match(/^\/api\/games\/([a-zA-Z0-9-]+)(?:\/(join|start|bots|actions|plan|map|review|replay|feed|stt|inbox))?$/);
      if(match) {
        const g=games.get(match[1]);requireRule(g,'Room not found.',404);
        const endpoint=match[2], gameMap=mapFor(g);
        function seat() { const me=auth(g.id),p=g.players.find(p=>p.profileId===me.id);requireRule(p,'Join a country first.',403);return p; }
        function host() { const me=auth(g.id);requireRule(me.id===g.hostId,'Only the host can do that.',403); }
        if(!endpoint && req.method==='GET') {
          if(identity) auth(g.id);
          const p=identity && g.players.find(p=>p.profileId===identity.id);
          const after=Number(url.searchParams.get('after') || 0);
          requireRule(Number.isSafeInteger(after) && after>=0,'Invalid event cursor.');
          const view = observe(g,p?.id || null,after);
          // ?inbox=1 (agent clients): the seat's unread messages and pending decisions, same as GET /inbox.
          return json(res,200,{...view, insights:operationalInsights(view), isHost:identity?.id===g.hostId,
            ...(p && url.searchParams.get('inbox')==='1'?{inbox:inbox(g,p.id)}:{})});
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
          // Read-only: a rally plan, a turn-around (recall / march again) forecast, or a march forecast.
          requireRule(g.status==='running','The match is not running.',409);
          return json(res,200,data.type==='rally'?rallyPlan(g,p.id,data):data.type==='turn_around'?turnAroundPlan(g,p.id,data.armyId)
            :preview(g,gameMap,p.id,data));
        }
        if(endpoint==='join' && req.method==='POST') {
          const me=auth(g.id),data=await body(req);
          requireRule(data.kind===undefined || ['human','agent'].includes(data.kind),'External clients choose human or agent.');
          const existing=g.players.find(p=>p.profileId===me.id);
          if(existing && g.status!=='lobby') {
            requireRule(existing.id===data.country,'You already control a different country.',409);
          } else join(g,gameMap,{...data,profileId:me.id,name:me.name});
          save(g);return json(res,200,{country:data.country,token:store.credential(me.id,g.id),match:g.id,
            notices:g.rules?.revealAllianceChatAfterMatch===true?[ALLIANCE_CHAT_NOTICE]:[]});
        }
        if(endpoint==='start' && req.method==='POST') {host();seat();await body(req);start(g);fractions.set(g.id,0);save(g);return json(res,200,{ok:true,status:g.status});}
        if(endpoint==='bots' && req.method==='POST') {
          host();const data=await body(req);requireRule(g.status==='lobby','Cannot add seats during play.',409);
          if (!g.players.some(p=>p.profileId===identity.id)) {
            requireRule(typeof data.country==='string','Choose your country before filling practice seats.');
            join(g,gameMap,{profileId:identity.id,name:identity.name,country:data.country,kind:'human'});
          }
          for(const c of gameMap.countries.filter(c=>!g.players.some(p=>p.id===c.id))) {
            const profile=store.register(`${c.name.split(' ')[0]} automaton`);
            join(g,gameMap,{profileId:profile.id,name:profile.name,country:c.id,kind:'bot',model:'practice-bot',persona:'expansion-first'});
          }
          save(g);return json(res,200,{ok:true,players:g.players.length});
        }
        if(endpoint==='stt' && req.method==='POST') {
          // Seated players only; the transcript goes back to this player and is never stored, logged or sent as chat.
          const p=seat();requireRule(g.status!=='finished','This match has finished.',409);
          return json(res,200,await stt.transcribe(req,`${g.id}:${p.id}`));
        }
        if(endpoint==='inbox') {
          // The seat's own inbox (docs/API.md). GET reads it; POST also moves the read cursor.
          const p=seat();
          if(req.method==='GET') return json(res,200,inbox(g,p.id));
          if(req.method==='POST') {
            const data=await body(req);
            if(data.through!==undefined) {
              markRead(g,p.id,data.through,data.after ?? null);save(g);return json(res,200,inbox(g,p.id));
            }
            // Read a page oldest first and mark through the last message shown: nothing unread is skipped.
            const page=inbox(g,p.id,{limit:20,newest:false});
            const readThrough=markRead(g,p.id,page.more?page.messages.at(-1).id:g.sequence);save(g);
            return json(res,200,{...page,readThrough});
          }
        }
        if(endpoint==='actions' && req.method==='POST') {
          const p=seat(),data=await body(req);
          const result=act(g,gameMap,p.id,data.action,data.opId);save(g);
          // Not part of the stored receipt: what waits for this seat right now (unread messages, decisions).
          const note=attention(g,p.id);
          return json(res,200,note?{...result,attention:note}:result);
        }
      }
      throw new RuleError('Not found.',404);
    } catch(error) {
      if(!(error instanceof RuleError)) console.error(error);
      if(!res.headersSent) json(res,error.status || 500,error instanceof RuleError ? {error:error.message,...error.details} : {error:'Internal server error.'});
      else res.end();
    }
  };
  const server = createServer(handler), tlsServer = tls ? createTlsServer(tls, handler) : null;
  for(const s of [server,tlsServer].filter(Boolean)) {s.requestTimeout=15000;s.headersTimeout=10000;}
  const interval=automatic ? setInterval(()=>{
    const now=performance.now(), elapsed=(now-previous)*clockScale;previous=now;
    try {
      for(const g of games.values()) if(g.status==='running') {
        const accumulated=(fractions.get(g.id)||0)+elapsed*g.speed;
        const count=Math.floor(accumulated/1000);fractions.set(g.id,accumulated%1000);
        if(count) step(g,count);
      }
      for(const [ip,bucket] of ipBudgets) if(Date.now()-bucket.at>60000) ipBudgets.delete(ip);
      stt.prune();
    } catch(error) { console.error('Simulation halted to avoid unsaved progress:',error);clearInterval(interval); }
  },100) : null;
  return {server,tlsServer,store,games,step, async close(){clearInterval(interval);for(const g of games.values())save(g);
    await Promise.all([server,tlsServer].filter(s=>s?.listening).map(s=>new Promise(resolve=>s.close(resolve))));store.close();} };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 3107),host=process.env.HOST || '0.0.0.0';
  // One listener. HTTPS whenever a certificate is available (TLS_CERT/TLS_KEY, or data/tls from scripts/dev-cert.sh),
  // because phones only grant the microphone to a secure context. TLS=off forces plain HTTP.
  const certPath=process.env.TLS_CERT || resolve(root,'data/tls/cert.pem'),keyPath=process.env.TLS_KEY || resolve(root,'data/tls/key.pem');
  const tls=process.env.TLS!=='off' && existsSync(certPath) && existsSync(keyPath) ? {cert:readFileSync(certPath),key:readFileSync(keyPath)} : null;
  const publicOrigin=process.env.PUBLIC_ORIGIN || `${tls?'https':'http'}://192.168.1.216:${port}`;
  const app=makeServer({publicOrigin,tls});
  (tls?app.tlsServer:app.server).listen(port,host,()=>console.log(`Council of Iron: ${publicOrigin} (SQLite; single process)`));
  if(process.env.STT_URL) console.log('Voice input: proxying to the configured STT sidecar.');
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
