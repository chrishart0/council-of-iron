import { truceUntil } from '../public/relations.js';
/** A bot does not re-declare war on a country for this long after making peace with it (ticks, from
 * the peace). Longer than the rules' truce so a bot never ping-pongs war and peace. Bot-only. */
const PEACE_MEMORY = 600;
/** Public-observation-only practice policy. Intentionally not a language model.
 * The tournament supplies seeded preferences; runtime bots use deterministic defaults.
 * `options.memory` (a Map the caller keeps per bot) remembers when it last made peace with each
 * country, read from the public truces; without it the bot still respects every truce.
 */
export function chooseIndustrial(state, map, country, options = {}) {
  const me = state.players.find(p => p.id === country);
  if (state.status !== 'running' || !me || me.eliminatedAt !== null) return null;
  const memory = options.memory || new Map();
  for (const t of state.truces || []) if (t.countries.includes(country)) {
    const other = t.countries.find(c => c !== country);
    memory.set(other, Math.max(memory.get(other) ?? -Infinity, t.since));
  }
  const peaceful = owner => truceUntil(state, country, owner) !== null
    || state.players.some(p => p.side === state.players.find(x => x.id === owner)?.side && state.tick < (memory.get(p.id) ?? -Infinity) + PEACE_MEMORY);
  const style = { neutral: 15, fraction: .8, reserve: 2, develop: true, coordinated: true, recall: true, ...options };
  const rng = style.rng || (() => .5), board = new Map(state.provinces.map(p => [p.id, p]));
  const places = new Map(map.provinces.map(p => [p.id, p])), sides = new Map(state.players.map(p => [p.id, p.side]));
  const friend = p => p.owner && sides.get(p.owner) === me.side;
  const canEnter=p=>!p.owner || friend(p) ||
    (state.wars || []).includes([country,p.owner].sort().join(':'));
  const own = state.provinces.filter(p => p.owner === country);
  const reservations = new Map();
  for (const o of state.orders) if (['march', 'develop'].includes(o.type))
    reservations.set(o.from, (reservations.get(o.from) || 0) + o.amount);
  const available = p => Math.max(0, p.troops - (reservations.get(p.id) || 0) - 1);
  const travel = (from, to) => state.travelTimes[from][to];
  const defendersAt = (target, arrival) => target.troops + (target.owner ?
    Math.max(0, Math.floor((arrival - target.nextRecruit) / state.rules.recruit) + 1) * target.development : 0);
  const hostileIncoming = p => state.armies.filter(a => a.to === p.id && sides.get(a.country) !== me.side)
    .reduce((n, a) => n + a.amount, 0);
  const safeSpare = p => Math.max(0, available(p) - style.reserve - hostileIncoming(p));
  // Peace is welcome when their troops are marching on us, or we have no winning attack on them.
  const peace=state.peaceOffers.find(o=>o.toRoster.includes(country));
  if(peace) {
    const theirs=new Set(peace.fromRoster);
    const threatened=state.armies.some(a=>theirs.has(a.country) && !a.returning && board.get(a.to)?.owner===country);
    const winning=state.provinces.some(p=>theirs.has(p.owner) && own.some(q=>places.get(q.id).neighbors.includes(p.id) && safeSpare(q)>p.troops+2));
    if(threatened || !winning)return {type:'accept_peace',offerId:peace.id};
  }
  const pendingRecall = new Set(state.orders.filter(o=>o.type==='recall').map(o=>o.target));
  // Abort a clearly hopeless commitment, but not one synchronized with enough friendly help.
  if (style.recall) for (const a of state.armies.filter(a=>a.country===country && !a.returning && !pendingRecall.has(a.id))) {
    const target = board.get(a.to); if (friend(target)) continue;
    const together = state.armies.filter(b=>b.to===a.to && b.arrivesAt===a.arrivesAt && sides.get(b.country)===me.side)
      .reduce((n,b)=>n+b.amount,0) + state.orders.filter(o=>o.type==='march'&&o.to===a.to&&o.arrivesAt===a.arrivesAt).reduce((n,o)=>n+o.amount,0);
    if (together < defendersAt(target,a.arrivesAt) * .65 && a.arrivesAt-state.tick>3)
      return {type:'recall',id:a.id};
  }
  // Compare one-target attack plans, not an unlimited series of privileged army moves.
  const attacks = [];
  for (const target of state.provinces.filter(p=>!friend(p) && canEnter(p))) {
    const donors = own.filter(p=>places.get(p.id).neighbors.includes(target.id) && safeSpare(p)>0)
      .sort((a,b)=>travel(a.id,target.id)-travel(b.id,target.id));
    if (!donors.length) continue;
    const variants = style.coordinated ? donors.map((_,i)=>donors.slice(0,i+1)) : donors.map(p=>[p]);
    for (const sources of variants) {
      if (sources.length>state.rules.maxSources) continue;
      const duration = Math.max(...sources.map(p=>travel(p.id,target.id))), arrival = state.tick+1+duration;
      if (arrival>state.rules.duration) continue;
      const defense = defendersAt(target,arrival), spare = sources.reduce((n,p)=>n+safeSpare(p),0);
      const incoming = state.armies.filter(a=>a.to===target.id && sides.get(a.country)===me.side && a.arrivesAt<=arrival)
        .reduce((n,a)=>n+a.amount,0);
      const queued = state.orders.filter(o=>o.type==='march'&&o.to===target.id).reduce((n,o)=>n+o.amount,0);
      if (incoming+queued>defense || spare<=defense+2) continue;
      const need=Math.max(defense+3,Math.ceil(spare*style.fraction));
      let remaining=need; const selected=[];
      for(let i=0;i<sources.length;i++) {
        const p=sources[i],amount=Math.min(safeSpare(p),Math.max(1,Math.ceil(need*safeSpare(p)/spare)));
        const send=Math.min(amount,remaining);if(send>0)selected.push({from:p.id,amount:send});remaining-=send;
      }
      if (remaining>0 || !selected.length) continue;
      attacks.push({type:'march',to:target.id,sources:selected,
        value:(target.owner?target.development*7:style.neutral)+Math.min(20,(spare-defense)*.12)-duration*.10+rng()*5});
    }
  }
  attacks.sort((a,b)=>b.value-a.value);
  if(!attacks.length) {
    const enemy=state.provinces.find(p=>p.owner && !friend(p) && !canEnter(p) && !peaceful(p.owner) &&
      own.some(q=>places.get(q.id).neighbors.includes(p.id) && safeSpare(q)>p.troops+2));
    if(enemy)return {type:'declare_war',country:enemy.owner};
  }
  // Infrastructure is useful only when there is enough match left to repay its cost.
  // A builder can invest before expansion, while an expander prefers a good open target.
  if (style.develop && (!attacks.length || style.investFirst)) {
    for (const p of own.sort((a,b)=>available(b)-available(a))) {
      if (p.development>=state.rules.maxDevelopment || p.developing || reservations.has(p.id) || hostileIncoming(p)) continue;
      const cost=state.rules.developmentCosts[p.development],duration=state.rules.developmentTicks[p.development];
      if (state.rules.duration-state.tick<duration+cost*state.rules.recruit+120) continue;
      const dangerous=places.get(p.id).neighbors.some(id=>{const q=board.get(id);return q.owner&&!friend(q)&&q.troops>p.troops-cost;});
      if (!dangerous && available(p)>=cost+style.reserve+3) return {type:'develop',from:p.id};
    }
  }
  if (attacks.length) { const {value,...action}=attacks[0];return action; }
  // Weighted distances prevent treating a transoceanic link like a local land border.
  const distance=new Map(),next=new Map(),unvisited=new Set(state.provinces.filter(friend).map(p=>p.id));
  for(const id of unvisited) if(places.get(id).neighbors.some(n=>!friend(board.get(n))))distance.set(id,0);
  while(unvisited.size) {
    let nearest=null,best=Infinity;
    for(const id of unvisited)if((distance.get(id)??Infinity)<best){nearest=id;best=distance.get(id);}
    if(nearest===null)break;unvisited.delete(nearest);
    for(const id of places.get(nearest).neighbors)if(unvisited.has(id)) {
      const candidate=best+travel(id,nearest);
      if(candidate<(distance.get(id)??Infinity)){distance.set(id,candidate);next.set(id,nearest);}
    }
  }
  // Interior provinces rally their new troops to the nearest front and send their surplus there.
  const frontOf=id=>{let at=id;while(next.has(at))at=next.get(at);return at;};
  const rallies=new Map((state.rallies || []).map(x=>[x.from,x.to]));
  for(const p of own.sort((a,b)=>available(b)-available(a))) {
    if(!next.has(p.id))continue;
    const front=frontOf(p.id);
    if(rallies.get(p.id)!==front && board.get(front).owner===country)return {type:'rally',from:p.id,to:front};
    const amount=safeSpare(p);
    if(amount>=5 && state.tick+1+travel(p.id,next.get(p.id))<=state.rules.duration)return {type:'march',from:p.id,to:next.get(p.id),amount};
  }
  // Stalemated frontier: reinforce our strongest nearby stack to enable a breakthrough.
  for(const p of own) {
    const to=places.get(p.id).neighbors.map(id=>board.get(id)).filter(q=>q.owner===country && q.troops>p.troops && distance.get(q.id)===0)
      .sort((a,b)=>b.troops-a.troops)[0];
    if(to && safeSpare(p)>=8 && state.tick+1+travel(p.id,to.id)<=state.rules.duration)
      return {type:'march',from:p.id,to:to.id,amount:safeSpare(p)};
  }
  return null;
}
