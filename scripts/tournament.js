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
  console.log('node scripts/tournament.js --rounds 128 --seed 1000 --map public/map.json --mode solo|diplomacy --out artifacts/tournament.json [--variant v01|CASE_NAME] [--engine src/engine.js] [--policy mixed|no-build|no-sync|no-recall]');
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
const { createGame, join, start, act, tick, observe, RuleError } = await import(pathToFileURL(enginePath));
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
  const command = (id, action) => {
    try { act(g, map, id, action, `s-${++serial}`); if (['move','attack'].includes(action.type)) moves++; if (action.type==='develop') developments++; if (action.type==='recall') recalls++; if(action.type==='attack'&&action.sources.length>1)synchronized++; }
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
        const offer = s.proposals.find(q => q.status === 'open' && q.roster.includes(p.id) && !q.accepted.includes(p.id) && q.roster.length <= 4);
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
    const oldTotal = total(g), oldEvents = g.events.length, oldInvested = g.economy?.invested || 0;
    const expectedLevels = new Map(g.provinces.map(p=>[p.id,p.developing?.completesAt<=g.tick+1 ? p.developing.level : p.development || 1]));
    const dueRecruits = g.provinces.filter(p => p.owner && p.nextRecruit <= g.tick+1).map(p=>p.id);
    tick(g);
    const events = g.events.slice(oldEvents), captured = new Set(); let lost = 0;
    for (const e of events) {
      if (e.type === 'battle') {
        battles++; if (firstBattle === null) firstBattle = g.tick;
        lost += Object.values(e.strengths).reduce((n,v)=>n+v,0) - e.troops;
        if (e.owner !== e.previousOwner) captured.add(e.province);
      }
      if (e.type === 'eliminated' && firstElimination === null) firstElimination = g.tick;
      if (e.type === 'alliance_activated') alliances++;
      if (e.type === 'departed') departures++;
    }
    const born = dueRecruits.filter(id=>!captured.has(id)).reduce((n,id)=>n+(g.rules?.distanceMovement?expectedLevels.get(id):1),0); recruited += born; casualties += lost;
    invariant(total(g) === oldTotal + born - lost - ((g.economy?.invested || 0) - oldInvested), 'troop conservation', g);
    invariant(g.provinces.every(p=>Number.isSafeInteger(p.troops) && p.troops>=0), 'negative or noninteger garrison',g);
    invariant(g.armies.every(a=>Number.isSafeInteger(a.amount) && a.amount>0 && a.arrivesAt>g.tick), 'invalid moving army',g);
    invariant(g.tick<=1800, 'deadline overrun',g);
    if ([300,600,1200].includes(g.tick)) checkpoints[g.tick] = Object.fromEntries(g.players.map(p=>[p.id,g.provinces.filter(v=>v.owner===p.id).length]));
  }
  invariant(g.outcome.scores.every(s=>Number.isFinite(s.prestige)), 'invalid score',g);
  invariant(g.outcome.scores.reduce((n,s)=>n+s.payout,0)<=g.players.length*100+.00001, 'inflated prize pool',g);
  const outcome = structuredClone(g.outcome), endTick = g.tick; tick(g);
  invariant(g.tick===endTick && JSON.stringify(g.outcome)===JSON.stringify(outcome), 'nonterminal outcome',g);
  return {seed,reason:outcome.reason,draw:outcome.draw,tick:endTick,winningCountries:g.players.filter(p=>p.side===outcome.winningSide).map(p=>p.id),
    land:Object.fromEntries(g.players.map(p=>[p.id,g.provinces.filter(v=>v.owner===p.id).length])),
    prestige:Object.fromEntries(outcome.scores.map(s=>[s.country,s.prestige])),
    eliminatedAt:Object.fromEntries(g.players.map(p=>[p.id,p.eliminatedAt])),
    styles:Object.fromEntries(g.players.map((p,i)=>[p.id,STYLES[(i+seed)%STYLES.length].name])),
    cadence:Object.fromEntries(cadence),developments,recalls,synchronized,moves,battles,casualties,recruited,rejected,firstBattle,firstElimination,alliances,departures,checkpoints};
}
for(let n=0;n<rounds;n++) {
  results.push(run(seedStart+n));
  if((n+1)%8===0) console.error(`${mode}: ${n+1}/${rounds} matches; ${((performance.now()-began)/1000).toFixed(1)}s`);
}
const mean = values => values.reduce((a,b)=>a+b,0)/values.length;
const summary = {rounds,mode,variant,policy,seedStart,seedEnd:seedStart+rounds-1,
  mapSha256:createHash('sha256').update(mapBytes).digest('hex'), engineSha256:createHash('sha256').update(readFileSync(enginePath)).digest('hex'),
  draws:results.filter(r=>r.draw).length,meanDuration:mean(results.map(r=>r.tick)),meanFirstBattle:mean(results.filter(r=>r.firstBattle!==null).map(r=>r.firstBattle)),
  meanMoves:mean(results.map(r=>r.moves)),meanDevelopments:mean(results.map(r=>r.developments)),meanRecalls:mean(results.map(r=>r.recalls)),meanSynchronized:mean(results.map(r=>r.synchronized)),meanBattles:mean(results.map(r=>r.battles)),
  meanFirstElimination:mean(results.filter(r=>r.firstElimination!==null).map(r=>r.firstElimination)),
  meanPrestige:Object.fromEntries(map.countries.map(c=>[c.id,mean(results.map(r=>r.prestige[c.id]))])),
  eliminatedByMinute5:Object.fromEntries(map.countries.map(c=>[c.id,results.filter(r=>r.eliminatedAt[c.id]!==null && r.eliminatedAt[c.id]<=300).length])),
  countryWins:Object.fromEntries(map.countries.map(c=>[c.id,results.filter(r=>r.winningCountries.includes(c.id)).length])),
  averageLand:Object.fromEntries(map.countries.map(c=>[c.id,mean(results.map(r=>r.land[c.id]))])),
  invariantFailures:0,elapsedSeconds:(performance.now()-began)/1000};
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({summary,results},null,2)+'\n');console.log(JSON.stringify(summary,null,2));
