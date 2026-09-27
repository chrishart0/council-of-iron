/** Public-observation-only practice policy. Intentionally not a language model.
 * The tournament supplies seeded preferences; runtime bots use deterministic defaults.
 */
export function chooseIndustrial(state, map, country, options = {}) {
  const me = state.players.find(p => p.id === country);
  if (state.status !== 'running' || !me || me.eliminatedAt !== null || !state.commandBudget?.remaining) return null;
  const style = { neutral: 15, fraction: .8, reserve: 2, develop: true, coordinated: true, recall: true, ...options };
  const rng = style.rng || (() => .5), board = new Map(state.provinces.map(p => [p.id, p]));
  const places = new Map(map.provinces.map(p => [p.id, p])), sides = new Map(state.players.map(p => [p.id, p.side]));
  const friend = p => p.owner && sides.get(p.owner) === me.side;
  const own = state.provinces.filter(p => p.owner === country);
  const reservations = new Map();
  for (const o of state.commandBudget.reserved) if (['move', 'develop'].includes(o.type))
    reservations.set(o.from, (reservations.get(o.from) || 0) + o.amount);
  const available = p => Math.max(0, p.troops - (reservations.get(p.id) || 0) - 1);
  const travel = (from, to) => state.travelTimes[from][to];
  const defendersAt = (target, arrival) => target.troops + (target.owner ?
    Math.max(0, Math.floor((arrival - target.nextRecruit) / state.rules.recruit) + 1) * target.development : 0);
  const hostileIncoming = p => state.armies.filter(a => a.to === p.id && sides.get(a.country) !== me.side)
    .reduce((n, a) => n + a.amount, 0);
  const safeSpare = p => Math.max(0, available(p) - style.reserve - hostileIncoming(p));
  const pendingRecall = new Set(state.commandBudget.reserved.filter(o=>o.type==='recall').map(o=>o.target));
  // Abort a clearly hopeless commitment, but not one synchronized with enough friendly help.
  if (style.recall) for (const a of state.armies.filter(a=>a.country===country && !a.returning && !pendingRecall.has(a.id))) {
    const target = board.get(a.to); if (friend(target)) continue;
    const together = state.armies.filter(b=>b.to===a.to && b.arrivesAt===a.arrivesAt && sides.get(b.country)===me.side)
      .reduce((n,b)=>n+b.amount,0) + state.commandBudget.reserved.filter(o=>o.type==='move'&&o.to===a.to&&o.arrivesAt===a.arrivesAt).reduce((n,o)=>n+o.amount,0);
    if (together < defendersAt(target,a.arrivesAt) * .65 && a.arrivesAt-state.tick>3)
      return {type:'recall',id:a.id};
  }
  // Compare one-target attack plans, not an unlimited series of privileged army moves.
  const attacks = [];
  for (const target of state.provinces.filter(p=>!friend(p))) {
    const donors = own.filter(p=>places.get(p.id).neighbors.includes(target.id) && safeSpare(p)>0)
      .sort((a,b)=>travel(a.id,target.id)-travel(b.id,target.id));
    if (!donors.length) continue;
    const variants = style.coordinated ? donors.map((_,i)=>donors.slice(0,i+1)) : donors.map(p=>[p]);
    for (const sources of variants) {
      if (sources.length>state.rules.maxAttackSources) continue;
      const duration = Math.max(...sources.map(p=>travel(p.id,target.id))), arrival = state.tick+1+duration;
      if (arrival>state.rules.duration) continue;
      const defense = defendersAt(target,arrival), spare = sources.reduce((n,p)=>n+safeSpare(p),0);
      const incoming = state.armies.filter(a=>a.to===target.id && sides.get(a.country)===me.side && a.arrivesAt<=arrival)
        .reduce((n,a)=>n+a.amount,0);
      const queued = state.commandBudget.reserved.filter(o=>o.type==='move'&&o.to===target.id).reduce((n,o)=>n+o.amount,0);
      if (incoming+queued>defense || spare<=defense+2) continue;
      const need=Math.max(defense+3,Math.ceil(spare*style.fraction));
      let remaining=need; const selected=[];
      for(let i=0;i<sources.length;i++) {
        const p=sources[i],amount=Math.min(safeSpare(p),Math.max(1,Math.ceil(need*safeSpare(p)/spare)));
        const send=Math.min(amount,remaining);if(send>0)selected.push({from:p.id,amount:send});remaining-=send;
      }
      if (remaining>0 || !selected.length) continue;
      attacks.push({type:'attack',to:target.id,sources:selected,
        value:(target.owner?target.development*7:style.neutral)+Math.min(20,(spare-defense)*.12)-duration*.10+rng()*5});
    }
  }
  attacks.sort((a,b)=>b.value-a.value);
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
  for(const p of own.sort((a,b)=>available(b)-available(a))) {
    const to=next.get(p.id);if(!to)continue;
    if(p.route!==to)return {type:'route',from:p.id,to};
    const amount=safeSpare(p);
    if(amount>=5 && state.tick+1+travel(p.id,to)<=state.rules.duration)return {type:'move',from:p.id,to,amount};
  }
  // Stalemated frontier: reinforce our strongest nearby stack to enable a breakthrough.
  for(const p of own) {
    const to=places.get(p.id).neighbors.map(id=>board.get(id)).filter(q=>q.owner===country && q.troops>p.troops && distance.get(q.id)===0)
      .sort((a,b)=>b.troops-a.troops)[0];
    if(to && safeSpare(p)>=8 && state.tick+1+travel(p.id,to.id)<=state.rules.duration)
      return {type:'move',from:p.id,to:to.id,amount:safeSpare(p)};
  }
  return null;
}
