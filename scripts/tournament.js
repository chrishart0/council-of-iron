/** Reproducible complete-match testing. Run --help for options. No network/inference.
 * A seed controls styles, decision latency, move preferences and actor order.
 * The same fixtures can compare map candidates without confusing repeatability with balance.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { random, controller, STYLES } from '../tests/simulation.js';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
if (args.includes('--help')) {
  console.log('node scripts/tournament.js --rounds 128 --seed 1000 --map public/imperial-map.json --mode solo|diplomacy --out artifacts/tournament.json [--variant v01|CASE_NAME] [--engine src/engine.js] [--policy mixed|no-build|no-sync|no-recall]');
  process.exit(0);
}
const rounds = Number(option('--rounds', 64)), seedStart = Number(option('--seed', 1000));
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10000 || !Number.isSafeInteger(seedStart)) throw new Error('Invalid rounds or seed.');
const policy = option('--policy', 'mixed');
const restrictions = {mixed:{},'no-build':{develop:false},'no-sync':{coordinated:false},'no-recall':{recall:false}};
if(!Object.hasOwn(restrictions,policy))throw new Error('Unknown policy restriction.');
const mode = option('--mode', 'solo');
if (!['solo', 'diplomacy'].includes(mode)) throw new Error('Unknown mode.');
const enginePath = resolve(option('--engine', 'src/engine.js'));
const { createGame, join, start, act, tick, observe, maxAlliance, RuleError } = await import(pathToFileURL(enginePath));
const mapBytes = readFileSync(option('--map', 'public/imperial-map.json')), map = JSON.parse(mapBytes);
const variant = option('--variant', 'v01');
const cases = JSON.parse(readFileSync(new URL('../tests/balance-cases.json', import.meta.url)));
if (!Object.hasOwn(cases, variant)) throw new Error('Unknown balance variant. See tests/balance-cases.json.');
const fixture = cases[variant];
for (const c of map.countries) {
  if (fixture.starts?.[c.id]) c.start = fixture.starts[c.id];
  if (fixture.troopsPerStartingProvince?.[c.id]) c.startTroops = fixture.troopsPerStartingProvince[c.id];
}
for (const [from,to] of fixture.seaConnections || []) {
  const a=map.provinces.find(p=>p.id===from),b=map.provinces.find(p=>p.id===to);
  if (!a.neighbors.includes(to)) {a.neighbors.push(to);b.neighbors.push(from);map.edges.push({from,to,sea:true});}
}
for (const p of map.provinces) p.neighbors.sort();
// Rules candidates (e.g. logistics-1) change only timing/cost fields for this run, never the published map.
if (fixture.rules) map.rules = { ...map.rules, ...fixture.rules };
const seaLinks = new Set(map.edges.filter(e => e.sea).flatMap(e => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
const placeOf = new Map(map.provinces.map(p => [p.id, p]));
/** Coarse theatre of a province from its map position (for travel-time reporting only). */
function region(id) {
  const p = placeOf.get(id), lon = p.lon ?? (p.x - 10) / 3.5 - 180, lat = p.lat ?? 83 - (p.y - 10) / 4.6;
  if (lon < -30) return 'americas';
  if (lat > 36 && lon < 45) return 'europe';
  if (lon < 60) return 'africa-mideast';
  return 'asia-pacific';
}
const IDLE_AFTER = 120, SAMPLE_EVERY = 30;
const out = option('--out', 'artifacts/tournament.json'), results = [], began = performance.now();
const total = g => g.provinces.reduce((n,p) => n+p.troops,0) + g.armies.reduce((n,a) => n+a.amount,0);
function invariant(condition, reason, g) { if (!condition) throw new Error(`Seed ${g.name}, tick ${g.tick}: ${reason}`); }
function run(seed) {
  const rng = random(seed), g = createGame({id:`seed-${seed}`, name:String(seed), hostId:'test'}, map);
  // Rotate style/latency assignments independently of country IDs and request iteration order.
  const controllers = new Map(), cadence = new Map();
  const countries = map.countries;
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i], style = STYLES[(i + seed) % STYLES.length];
    join(g, map, {profileId:c.id, name:c.id, country:c.id, kind:'agent'});
    controllers.set(c.id, controller(map, seed * 97 + i * 7919, style, restrictions[policy]));
    cadence.set(c.id, [5, 10, 15][(i + Math.floor(seed / 4)) % 3]);
  }
  // Fixture construction happens before the match, never during gameplay.
  // This lets us reject map/army-budget experiments without shipping handicaps.
  for (const c of map.countries) if (c.startTroops !== undefined)
    for (const p of g.provinces.filter(p=>p.owner===c.id)) p.troops=c.startTroops;
  start(g); let moves = 0, battles = 0, casualties = 0, recruited = 0, rejected = 0, serial = 0;
  let developments = 0, recalls = 0, synchronized = 0;
  let firstBattle = null, firstElimination = null, alliances = 0, departures = 0;
  const checkpoints = {};
  // Logistics metrics: leg durations by link class/theatre/country, idle surplus, battle lengths, industry.
  const legs = [], lastDeparture = new Map(), battleDurations = [], seenLegs = new Set();
  let idleSamples = 0, idleShare = 0, interiorIdleShare = 0, firstLevel2 = null, firstLevel3 = null;
  const command = (id, action) => {
    try { act(g, map, id, action, `s-${++serial}`); if (action.type==='march') moves++; if (action.type==='develop') developments++; if (action.type==='recall') recalls++; if(action.type==='march'&&action.sources?.length>1)synchronized++; }
    catch (e) { if (!(e instanceof RuleError)) throw e; rejected++; }
  };
  while (g.status === 'running') {
    // Fisher-Yates: randomize request order instead of permanently favoring one seat.
    const order = [...g.players];
    for (let i=order.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    for (const p of order) {
      if (p.eliminatedAt !== null) continue;
      if (mode === 'diplomacy' && g.tick > 90 && g.tick % 60 === 0) {
        const s = observe(g, p.id, g.sequence);
        const offer = s.proposals.find(q => q.status === 'open' && q.roster.includes(p.id) && !q.accepted.includes(p.id));
        if (offer) command(p.id, {type:'accept', proposalId:offer.id});
        else if (!p.side.startsWith('solo:') && rng() < .12) command(p.id,{type:'leave'});
        else if (rng() < .25) {
          const independent = g.players.filter(x=>x.id!==p.id && x.eliminatedAt===null && x.side.startsWith('solo:'));
          if (independent.length) command(p.id,{type:'propose',country:independent[Math.floor(rng()*independent.length)].id,name:`Accord ${seed}`});
        }
      }
      if (g.tick % cadence.get(p.id) === 0) {
        const action = controllers.get(p.id)(observe(g,p.id,g.sequence));
        if (action) command(p.id, action);
      }
    }
    const oldTotal = total(g), oldEvents = g.events.length, oldEconomy = {...g.economy};
    tick(g);
    const events = g.events.slice(oldEvents);
    for (const e of events) {
      if (e.type === 'battle') {
        battles++; if (firstBattle === null) firstBattle = g.tick;
      }
      if (e.type === 'eliminated' && firstElimination === null) firstElimination = g.tick;
      if (e.type === 'alliance_activated') alliances++;
      if (e.type === 'departed') departures++;
      if (e.type === 'battle' && Number.isSafeInteger(e.duration)) battleDurations.push(e.duration);
      if (e.type === 'development_completed' && e.level === 2 && firstLevel2 === null) firstLevel2 = g.tick;
      if (e.type === 'development_completed' && e.level === 3 && firstLevel3 === null) firstLevel3 = g.tick;
    }
    const sideOf = new Map(g.players.map(p => [p.id, p.side])), owner = new Map(g.provinces.map(p => [p.id, p.owner]));
    const friendly = (country, id) => owner.get(id) && sideOf.get(owner.get(id)) === sideOf.get(country);
    for (const a of g.armies) if (a.departedAt === g.tick && !a.returning && !seenLegs.has(`${a.id}:${a.departedAt}`)) {
      seenLegs.add(`${a.id}:${a.departedAt}`); lastDeparture.set(a.from, g.tick);
      const kind = seaLinks.has(`${a.from}|${a.to}`) ? 'sea' : friendly(a.country, a.from) && friendly(a.country, a.to) ? 'internal' : 'foreign';
      legs.push({ country: a.country, kind, region: region(a.from), ticks: a.arrivesAt - a.departedAt });
    }
    if (g.tick % SAMPLE_EVERY === 0) {
      const all = total(g); let idle = 0, interior = 0;
      for (const p of g.provinces) if (p.owner && g.tick - (lastDeparture.get(p.id) ?? 0) > IDLE_AFTER) {
        idle += Math.max(0, p.troops - 1);
        if (placeOf.get(p.id).neighbors.every(id => friendly(p.owner, id))) interior += Math.max(0, p.troops - 1);
      }
      if (all) { idleSamples++; idleShare += idle / all; interiorIdleShare += interior / all; }
    }
    const born=g.economy.recruited-oldEconomy.recruited,lost=(g.economy.casualties||0)-(oldEconomy.casualties||0);
    const interned=events.filter(e=>e.type==='army_interned').reduce((n,e)=>n+e.amount,0);
    recruited += born; casualties += lost;
    invariant(total(g) === oldTotal + born - lost - interned - (g.economy.invested-oldEconomy.invested), 'troop conservation', g);
    invariant(g.provinces.every(p=>Number.isSafeInteger(p.troops) && p.troops>=0), 'negative or noninteger garrison',g);
    invariant(g.armies.every(a=>Number.isSafeInteger(a.amount) && a.amount>0 && (a.engaged || a.arrivesAt>g.tick)), 'invalid moving army',g);
    invariant(g.tick<=g.rules.duration, 'deadline overrun',g);
    if ([300,600,1200].includes(g.tick)) checkpoints[g.tick] = Object.fromEntries(g.players.map(p=>[p.id,g.provinces.filter(v=>v.owner===p.id).length]));
  }
  invariant(g.outcome.scores.every(s=>['win','draw','loss'].includes(s.result) && Number.isSafeInteger(s.industry)), 'invalid result',g);
  // A country without territory at the finish loses even in a draw (engine score()); everyone else draws.
  invariant(g.outcome.draw === g.outcome.scores.filter(s=>s.industry>0).every(s=>s.result==='draw'), 'inconsistent draw',g);
  invariant(g.players.every(p=>g.players.filter(q=>q.side===p.side).length<=Math.max(1,maxAlliance(g))), 'alliance over the size cap',g);
  const outcome = structuredClone(g.outcome), endTick = g.tick; tick(g);
  invariant(g.tick===endTick && JSON.stringify(g.outcome)===JSON.stringify(outcome), 'nonterminal outcome',g);
  return {seed,reason:outcome.reason,draw:outcome.draw,tick:endTick,winningCountries:g.players.filter(p=>p.side===outcome.winningSide).map(p=>p.id),
    land:Object.fromEntries(g.players.map(p=>[p.id,g.provinces.filter(v=>v.owner===p.id).length])),
    eliminatedAt:Object.fromEntries(g.players.map(p=>[p.id,p.eliminatedAt])),
    styles:Object.fromEntries(g.players.map((p,i)=>[p.id,STYLES[(i+seed)%STYLES.length].name])),
    legs,battleDurations,unresolvedBattles:g.battles.length,idleShare:idleSamples?idleShare/idleSamples:0,
    interiorIdleShare:idleSamples?interiorIdleShare/idleSamples:0,firstLevel2,firstLevel3,
    finalDevelopment:(()=>{const owned=g.provinces.filter(p=>p.owner);return owned.reduce((n,p)=>n+p.development,0)/Math.max(1,owned.length);})(),
    cadence:Object.fromEntries(cadence),developments,recalls,synchronized,moves,battles,casualties,recruited,rejected,firstBattle,firstElimination,alliances,departures,checkpoints};
}
for(let n=0;n<rounds;n++) {
  results.push(run(seedStart+n));
  if((n+1)%8===0) console.error(`${mode}: ${n+1}/${rounds} matches; ${((performance.now()-began)/1000).toFixed(1)}s`);
}
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const median = values => { if (!values.length) return null; const v=[...values].sort((a,b)=>a-b), m=v.length>>1; return v.length%2 ? v[m] : (v[m-1]+v[m])/2; };
const allLegs = results.flatMap(r => r.legs), allBattles = results.flatMap(r => r.battleDurations);
const legMean = filter => { const v = allLegs.filter(filter).map(l => l.ticks); return v.length ? { mean: +mean(v).toFixed(1), median: median(v), count: v.length } : null; };
const logistics = {
  decisive: results.filter(r => r.reason === 'domination').length,
  deadlineStalemates: results.filter(r => r.reason === 'deadline' && r.draw).length,
  deadlineWins: results.filter(r => r.reason === 'deadline' && !r.draw).length,
  medianDuration: median(results.map(r => r.tick)),
  battleDuration: { mean: mean(allBattles), median: median(allBattles), p90: [...allBattles].sort((a,b)=>a-b)[Math.floor(allBattles.length*.9)] ?? null,
    longOver120: allBattles.filter(d => d > 120).length / Math.max(1, allBattles.length), unresolvedAtEnd: mean(results.map(r => r.unresolvedBattles)) },
  idleShare: mean(results.map(r => r.idleShare)), interiorIdleShare: mean(results.map(r => r.interiorIdleShare)),
  legTicksByKind: Object.fromEntries(['internal', 'foreign', 'sea'].map(k => [k, legMean(l => l.kind === k)])),
  legTicksByRegion: Object.fromEntries(['americas', 'europe', 'africa-mideast', 'asia-pacific'].map(k => [k, legMean(l => l.region === k)])),
  legTicksByCountry: Object.fromEntries(map.countries.map(c => [c.id, legMean(l => l.country === c.id)])),
  firstLevel2: mean(results.filter(r => r.firstLevel2 !== null).map(r => r.firstLevel2)),
  firstLevel3: mean(results.filter(r => r.firstLevel3 !== null).map(r => r.firstLevel3)),
  matchesWithLevel3: results.filter(r => r.firstLevel3 !== null).length,
  finalDevelopment: mean(results.map(r => r.finalDevelopment)) };
for (const r of results) delete r.legs;
const summary = {rounds,mode,variant,policy,seedStart,seedEnd:seedStart+rounds-1,
  mapSha256:createHash('sha256').update(mapBytes).digest('hex'), engineSha256:createHash('sha256').update(readFileSync(enginePath)).digest('hex'),
  draws:results.filter(r=>r.draw).length,decisive:results.filter(r=>r.reason==='domination').length,meanDuration:mean(results.map(r=>r.tick)),meanFirstBattle:mean(results.filter(r=>r.firstBattle!==null).map(r=>r.firstBattle)),
  meanMoves:mean(results.map(r=>r.moves)),meanDevelopments:mean(results.map(r=>r.developments)),meanRecalls:mean(results.map(r=>r.recalls)),meanSynchronized:mean(results.map(r=>r.synchronized)),meanBattles:mean(results.map(r=>r.battles)),
  meanFirstElimination:mean(results.filter(r=>r.firstElimination!==null).map(r=>r.firstElimination)),
  eliminatedByMinute5:Object.fromEntries(map.countries.map(c=>[c.id,results.filter(r=>r.eliminatedAt[c.id]!==null && r.eliminatedAt[c.id]<=300).length])),
  countryWins:Object.fromEntries(map.countries.map(c=>[c.id,results.filter(r=>r.winningCountries.includes(c.id)).length])),
  averageLand:Object.fromEntries(map.countries.map(c=>[c.id,mean(results.map(r=>r.land[c.id]))])),
  logistics,invariantFailures:0,elapsedSeconds:(performance.now()-began)/1000};
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({summary,results},null,2)+'\n');console.log(JSON.stringify(summary,null,2));
