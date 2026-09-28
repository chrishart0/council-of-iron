import { combatForecast, combatDistribution } from '../../public/combat.js';

// Static public probability tables are shared math, never other players' memory.
// The same recurrence as the preview; precomputation avoids rebuilding a large
// matrix for every candidate in every decision. Four 251×251 Float64 tables < 2MB.
const tables = new Map(), roundCache = new Map();
export function odds(attackers, defenders, development) {
  const a = Math.max(0, Math.ceil(attackers)), d = Math.max(0, Math.ceil(defenders));
  const key = `${Math.min(3,a)}:${Math.min(2,d)}:${development}`;
  if (!roundCache.has(key)) roundCache.set(key, combatForecast(Math.min(3,a),Math.min(2,d),development));
  const round = roundCache.get(key);
  if (!a || !d) return {...round, attackerWinChance:a?1:0};
  if (a>250 || d>250) return combatForecast(a,d,development);
  if (!tables.has(development)) {
    const table=new Float64Array(251*251);
    for(let n=1;n<=250;n++)table[n*251]=1;
    for(let n=1;n<=250;n++)for(let m=1;m<=250;m++) {
      let chance=0;
      for(const outcome of combatDistribution(Math.min(3,n),Math.min(2,m),development))
        chance+=outcome.probability*table[(n-outcome.attackerLoss)*251+m-outcome.defenderLoss];
      table[n*251+m]=chance;
    }
    tables.set(development,table);
  }
  return {...round,attackerWinChance:tables.get(development)[a*251+d]};
}
const total = xs => xs.reduce((n, a) => n + a.amount, 0);

/** Expected-round projection of visible armies, recruitment and our reservations.
 * This is NOT an exact replay. Fractional losses approximate the public dice odds;
 * ownership/strength forecasts are uncertain and new orders can invalidate them.
 */
export function riskForecast(pos) {
  const { state: s, orders, travel } = pos, now = s.tick, r = s.rules;
  const affiliations = new Map(s.players.map(p => [p.id, p.side]));
  const changes = [...s.proposals.filter(q => q.status === 'pending'), ...s.departures].sort((a,b) => a.activateAt-b.activateAt);
  const sideHistory = [{tick:now, values:new Map(affiliations)}];
  for(const c of changes) {
    if(c.roster)for(const member of c.roster)affiliations.set(member,c.coalition || `forecast:${c.id}`);
    else {
      const old=affiliations.get(c.country);affiliations.set(c.country,`forecast:solo:${c.country}:${c.activateAt}`);
      const left=[...affiliations].filter(([,side])=>side===old);
      if(left.length===1)affiliations.set(left[0][0],`forecast:solo:${left[0][0]}:${c.activateAt}`);
    }
    sideHistory.push({tick:c.activateAt,values:new Map(affiliations)});
  }
  function sideAt(id, at) {
    for(let i=sideHistory.length-1;i>=0;i--)if(sideHistory[i].tick<=at)return sideHistory[i].values.get(id) ?? 'neutral';
    return 'neutral';
  }
  const canFight = (a,b,t) => !b || sideAt(a,t) !== sideAt(b,t) && pos.wars.has([a,b].sort().join(':'));
  const board = new Map(s.provinces.map(p => [p.id, { ...p, developing: p.developing ? { ...p.developing } : null }]));
  const rows = new Map([...board].map(([id,p]) => [id, [{ ...p, tick:now }]]));
  const arrivals = new Map(), departing = new Map(), engaged = new Map(), before = new Map();
  const push = (index, at, a) => { if (!index.has(at)) index.set(at, []); index.get(at).push(a); };
  const recalled = new Set(orders.filter(o => o.type === 'recall').map(o => o.target));
  const cancelled = a => [a.id,a.groupId,a.orderId].some(id => recalled.has(id));
  function routeArrival(a) {
    let at = a.arrivesAt, to = a.to;
    // A transit army passes through allies without gifting; count it only at its final stop.
    if (a.transit && !a.returning) {
      for (let i = (a.pathIndex ?? 0)+1; i < a.path.length; i++) { at += travel(to,a.path[i]); to=a.path[i]; }
    }
    push(arrivals, at, { ...a, to });
  }
  for (const a of s.armies) {
    if (cancelled(a) && !a.returning) {
      const back = a.transit ? now+1-a.originDepartedAt : Math.min(a.arrivesAt-a.departedAt, now+1-a.departedAt);
      push(arrivals, now+1+Math.max(1,back), { ...a, to:a.transit?a.origin:a.from, engaged:false, returning:true });
    } else if (a.engaged) { if (!engaged.has(a.to)) engaged.set(a.to,[]); engaged.get(a.to).push({ ...a }); }
    else routeArrival(a);
  }
  for (const o of orders) if (o.type !== 'recall' && !cancelled(o)) push(departing,o.executeAt,o);
  let tick = now;
  const snapshot = (p, attackers, t) => ({ ...p, tick:t, attackers:attackers.map(a => ({ ...a })) });
  function ensure(until) {
    until = Math.min(r.duration,until);
    while (tick < until) {
      tick++;
      const changed = new Set();
      for (const o of departing.get(tick) || []) {
        const p = board.get(o.from);
        if (!p || p.owner !== o.country) continue;
        if (o.type === 'route') p.route = o.to;
        else if (p.troops > o.amount) {
          p.troops -= o.amount;
          if (o.type === 'develop') p.developing = {level:o.level,completesAt:tick+r.developmentTicks[p.development]};
          else if (o.type === 'transit') push(arrivals,o.ultimateArrivesAt,{...o,to:o.path.at(-1)});
          else push(arrivals,o.arrivesAt ?? tick+travel(o.from,o.to),{...o});
        }
        changed.add(p.id);
      }
      const due = new Map();
      for (const a of arrivals.get(tick) || []) { if (!due.has(a.to)) due.set(a.to,[]); due.get(a.to).push(a); }
      for (const id of new Set([...due.keys(),...engaged.keys()])) {
        const p = board.get(id), existing = engaged.get(id) || [];
        const entrants = (due.get(id)||[]).filter(a => p.owner && sideAt(a.country,tick) === sideAt(p.owner,tick) || canFight(a.country,p.owner,tick));
        const groups = new Map();
        for (const a of [...existing,...entrants]) {
          if (p.owner && sideAt(a.country,tick) === sideAt(p.owner,tick)) { p.troops += a.amount; continue; }
          const side=sideAt(a.country,tick); if(!groups.has(side))groups.set(side,[]); groups.get(side).push(a);
        }
        const selected = existing.length ? sideAt(existing[0].country,tick) : [...groups].sort((a,b)=>total(b[1])-total(a[1]) || a[0].localeCompare(b[0]))[0]?.[0];
        const fighting=groups.get(selected)||[];
        before.set(`${tick}:${id}`,snapshot(p,fighting,tick));
        if (fighting.length && (existing.length || p.troops===0)) {
          const forecast=odds(total(fighting),p.troops,p.development);
          // Current-round expected losses, not a prediction of the seeded result.
          let loss=Math.min(total(fighting),forecast.expectedAttackerLoss);
          p.troops=Math.max(0,p.troops-forecast.expectedDefenderLoss);
          for(const a of [...fighting].sort((a,b)=>b.amount-a.amount)) {const lost=Math.min(a.amount,loss);a.amount-=lost;loss-=lost;}
        }
        const surviving=fighting.filter(a=>a.amount>.01);
        if(surviving.length && p.troops<.5) {
          const contributions=new Map();for(const a of surviving)contributions.set(a.country,(contributions.get(a.country)||0)+a.amount);
          p.owner=[...contributions].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0][0];
          p.troops=total(surviving);p.route=null;p.developing=null;p.nextRecruit=tick+r.recruit;
          // Keep development unchanged: random post-battle damage is not observable yet.
          engaged.delete(id);
        } else if(surviving.length)engaged.set(id,surviving);else engaged.delete(id);
        changed.add(id);
      }
      for(const p of board.values()) {
        if(p.developing?.completesAt<=tick){p.development=p.developing.level;p.developing=null;changed.add(p.id);}
        if(p.route && (!p.owner || sideAt(p.owner,tick)!==sideAt(board.get(p.route).owner,tick))){p.route=null;changed.add(p.id);}
        if(!p.owner || p.nextRecruit===null || p.nextRecruit>tick)continue;
        p.troops+=p.development;p.nextRecruit=tick+r.recruit;changed.add(p.id);
        if(p.route){const sent=Math.min(p.development,Math.max(0,p.troops-1));p.troops-=sent;if(sent)push(arrivals,tick+travel(p.id,p.route),{country:p.owner,to:p.route,amount:sent});}
      }
      for(const id of changed)rows.get(id).push(snapshot(board.get(id),engaged.get(id)||[],tick));
    }
  }
  function at(id,t) {
    ensure(t);const history=rows.get(id);let lo=0,hi=history.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(history[mid].tick<=t)lo=mid+1;else hi=mid;}
    return history[Math.max(0,lo-1)];
  }
  function combat(id,t,additions=[]) {
    t=Math.max(now+1,t);ensure(t);
    const p=before.get(`${t}:${id}`)||at(id,t-1), ownerSide=sideAt(p.owner,t), ourSide=sideAt(pos.country,t);
    let defenders=p.troops;
    const groups=new Map();
    for(const a of [...(p.attackers||[]),...additions]) {
      const side=sideAt(a.country,t);
      if(side===ownerSide && p.owner)defenders+=a.amount;
      else groups.set(side,(groups.get(side)||0)+a.amount);
    }
    const leader=[...groups].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
    if(!leader)return {side:ownerSide,troops:defenders,conquered:false,confidence:ownerSide===ourSide?1:0,rounds:0};
    const [attackerSide,attackers]=leader;
    // Recruitment during combat matters, especially for a developed defender.
    const rates=odds(3,2,p.development), recruit=p.owner?p.development/r.recruit:0;
    const rounds=defenders/Math.max(.2,rates.expectedDefenderLoss-recruit);
    const defense=defenders+Math.max(0,rounds)*recruit;
    const chance=odds(attackers,defense,p.development).attackerWinChance;
    const confidence=attackerSide===ourSide?chance:ownerSide===ourSide?1-chance:0;
    const winner=chance>=.5?attackerSide:ownerSide;
    const survivors=chance>=.5?attackers-defense*rates.expectedAttackerLoss/Math.max(.1,rates.expectedDefenderLoss):defense-attackers*rates.expectedDefenderLoss/Math.max(.1,rates.expectedAttackerLoss);
    return {side:winner,troops:Math.max(1,survivors),conquered:winner!==ownerSide,confidence,rounds:Math.max(1,Math.ceil(rounds)),attackerWinChance:chance};
  }
  return {at,combat,sideAt};
}
