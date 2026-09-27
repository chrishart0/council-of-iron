/** Reproducible traditional-bot evaluation. No military shortcuts or secret state.
 * Faction rotations balance exposure, not geography. Reports are not human win rates.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createGame, join, start, act, observe, tick } from '../src/engine.js';
import { createBot, decideBot, recordDecision } from '../agents/bots/controller.js';
import { controller, random, STYLES } from '../tests/simulation.js';

const sum = xs => xs.reduce((a,b) => a+b, 0);
const count = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function play({ map, seed, mode = 'mixed', difficulty = 'standard', diplomacy = false, retain = false }) {
  const g = createGame({ id:`test-${seed}`, name:`Traditional bots ${seed}`, hostId:'test' }, map), rng = random(seed);
  const brains = new Map(), legacy = new Map(), tags = {}, moves = {}, reasons = {}, failures = [], trace = [], timings = [];
  const ids = map.countries.map(c => c.id), rotation = seed % ids.length;
  for (const [i, c] of map.countries.entries()) {
    join(g, map, { profileId:c.id, name:c.id, country:c.id, kind:'agent' });
    const slot = (i + rotation) % ids.length;
    const old = mode === 'mixed' && slot >= Math.ceil(ids.length/2) || mode === 'legacy';
    const level = mode === 'difficulty' ? ['easy','standard','hard','standard'][slot % 4] : difficulty;
    tags[c.id] = old ? 'legacy' : level;
    if (old) legacy.set(c.id, controller(map, seed*97+i*7919, STYLES[(i+seed)%STYLES.length]));
    else brains.set(c.id, createBot(c.id, { difficulty:level, personality:['marshal','raider','builder','diplomat'][(i+Math.floor(seed/8))%4] }, seed));
  }
  start(g);
  const total = () => sum(g.provinces.map(p => p.troops)) + sum(g.armies.map(a => a.amount));
  const initial = total(); let casualties=0, eventAt=g.events.length, commands=0;
  const checkpoints = {};
  while (g.status === 'running') {
    const order = [...g.players];
    for (let i=order.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    for (const p of order) {
      if (p.eliminatedAt !== null) continue;
      const brain = brains.get(p.id);
      if (brain ? g.tick < brain.nextThinkAt : g.tick % 5 !== 0) continue;
      const s = observe(g, p.id, brain?.cursor ?? g.sequence, 10000);
      const began = performance.now();
      const d = brain ? decideBot(s, map, brain, { diplomacyEnabled:diplomacy })
        : (() => { const a=legacy.get(p.id)(s); return a?{action:a,reason:'Legacy policy'}:null; })();
      if (brain) timings.push(performance.now()-began);
      if (!d) continue;
      try {
        act(g, map, p.id, d.action, `test-${++commands}`);
        if (brain) recordDecision(brain, d, s);
        count(moves, d.action.type); count(reasons, d.reason);
        if (retain) trace.push({ tick:g.tick, country:p.id, reason:d.reason, action:d.action });
      } catch (e) {
        failures.push({tick:g.tick,country:p.id,policy:tags[p.id],error:e.message,action:d.action});
        if (brain) recordDecision(brain,d,s,false);
      }
    }
    tick(g);
    for (const e of g.events.slice(eventAt)) if(e.type==='battle') casualties += e.before + sum(e.arrivals.map(a=>a.amount)) - e.troops;
    eventAt=g.events.length;
    assert.equal(total(),initial+g.economy.recruited-g.economy.invested-casualties,`Ledger seed ${seed}, tick ${g.tick}`);
    assert.ok(g.provinces.every(p=>Number.isSafeInteger(p.troops)&&p.troops>=0));
    assert.ok(g.armies.every(a=>Number.isSafeInteger(a.amount)&&a.amount>0&&a.arrivesAt>g.tick));
    assert.ok(g.tick<=g.rules?.duration || g.tick<=1800);
    if ([300,600,1200].includes(g.tick)) checkpoints[g.tick]=Object.fromEntries(ids.map(id=>[id,g.provinces.filter(p=>p.owner===id).length]));
  }
  assert.ok(sum(g.outcome.scores.map(s=>s.payout))<=g.players.length*100+1e-6);
  const ending=digest(g.outcome); tick(g); assert.equal(digest(g.outcome),ending);
  const stats = {
    seed, mode, diplomacy, tags, tick:g.tick, draw:g.outcome.draw,
    winners:g.players.filter(p=>p.side===g.outcome.winningSide).map(p=>p.id),
    scores:g.outcome.scores.map(p=>({country:p.country,prestige:p.prestige})),
    land:Object.fromEntries(ids.map(id=>[id,g.provinces.filter(p=>p.owner===id).length])),
    troops:Object.fromEntries(ids.map(id=>[id,sum(g.provinces.filter(p=>p.owner===id).map(p=>p.troops))])),
    eliminated:g.players.map(p=>({country:p.id,at:p.eliminatedAt})),
    moves, reasons, rejected:failures, executionFailures:g.events.filter(e=>e.type==='order_failed').length,
    attacks:g.actionLog.filter(a=>a.action.type==='attack' && a.action.sources.length>1).length,
    alliances:g.events.filter(e=>e.type==='alliance_activated').length,
    departures:g.events.filter(e=>e.type==='departed').length,
    totalMessages:g.events.filter(e=>e.type==='message').length,
    ledger:{initial,recruited:g.economy.recruited,invested:g.economy.invested,casualties,remaining:total()},
    checkpoints, eventDigest:digest(g.events),
    memoryBytes:sum([...brains.values()].map(b=>JSON.stringify(b).length)),
    decisions:timings.length, decisionMs:sum(timings), ...(retain?{trace}:{}),
  };
  return { stats, timings, game:retain?g:undefined };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2), arg=(k,f)=>args.includes(k)?args[args.indexOf(k)+1]:f;
  const rounds=Number(arg('--rounds',8)), seedStart=Number(arg('--seed',1000)), mode=arg('--mode','mixed'), difficulty=arg('--difficulty','standard');
  assert.ok(Number.isSafeInteger(rounds)&&rounds>0&&rounds<=2048);
  assert.ok(Number.isSafeInteger(seedStart));
  assert.ok(['mixed','selfplay','difficulty','legacy'].includes(mode));
  assert.ok(['easy','standard','hard'].includes(difficulty));
  const mapPath=arg('--map','public/imperial-map.json'), bytes=readFileSync(mapPath), map=JSON.parse(bytes);
  const out=arg('--out','artifacts/bot-tournament.json'), results=[], times=[], begin=performance.now();
  for(let i=0;i<rounds;i++) {
    const {stats,timings}=play({map,seed:seedStart+i,mode,difficulty,diplomacy:args.includes('--diplomacy'),retain:args.includes('--trace')});
    results.push(stats);for(const t of timings)times.push(t);
    if((i+1)%8===0)console.error(`${mode} ${i+1}/${rounds} (${((performance.now()-begin)/1000).toFixed(1)}s)`);
  }
  times.sort((a,b)=>a-b);
  const summary={rounds,seedStart,seedEnd:seedStart+rounds-1,mode,difficulty,diplomacy:args.includes('--diplomacy'),
    mapSha256:createHash('sha256').update(bytes).digest('hex'),draws:results.filter(r=>r.draw).length,
    meanDuration:sum(results.map(r=>r.tick))/rounds,byPolicy:{},
    countryWins:Object.fromEntries(map.countries.map(c=>[c.id,results.filter(r=>r.winners.includes(c.id)).length])),
    rejectedNew:sum(results.map(r=>r.rejected.filter(e=>e.policy!=='legacy').length)),
    rejectedLegacy:sum(results.map(r=>r.rejected.filter(e=>e.policy==='legacy').length)),
    invariantsFailed:0,meanMessages:sum(results.map(r=>r.totalMessages))/rounds,
    meanAlliances:sum(results.map(r=>r.alliances))/rounds,meanDepartures:sum(results.map(r=>r.departures))/rounds,
    decisionMeanMs:sum(times)/Math.max(1,times.length),decisionP95Ms:times[Math.floor(times.length*.95)]??null,
    maxMemoryBytes:Math.max(...results.map(r=>r.memoryBytes)),elapsedSeconds:(performance.now()-begin)/1000};
  for(const label of new Set(results.flatMap(r=>Object.values(r.tags)))) {
    const seats=results.flatMap(r=>r.scores.filter(s=>r.tags[s.country]===label).map(s=>({...s,win:r.winners.includes(s.country),tick:r.tick})));
    summary.byPolicy[label]={seats:seats.length,winningSeats:seats.filter(s=>s.win).length,meanPrestige:sum(seats.map(s=>s.prestige))/seats.length};
  }
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({summary,results},null,2)+'\n');console.log(JSON.stringify(summary,null,2));
}
