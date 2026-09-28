import { developmentForecast } from '../../public/insights.js';
import { hash, paths, sum } from './position.js';

/** Evaluate concrete orders. Emergency responses outrank ordinary utility scores. */
export function military(pos, future, skill, doctrine, memory) {
  const { state: s, country, owned, neighbours, available, travel, friendly } = pos;
  if (!s.commandBudget?.remaining) return null;
  const r = s.rules, now = s.tick, industrial = Boolean(r.warRequired || r.distanceMovement);
  const enemyHolds = Object.entries(s.dominance).filter(([side]) => side !== pos.me.side);
  const end = Math.min(r.duration, ...enemyHolds.map(([, t]) => t + r.hold));
  const ownHold = s.dominance[pos.me.side];
  const investEnd = Math.min(end, ownHold === undefined ? r.duration : ownHold + r.hold);
  const friendlyAt = (id, at) => Boolean(id && future.sideAt(id, at) === future.sideAt(country, at));
  const candidates = [], dangers = new Map();
  const hostileWaves = s.armies.map(a => a.engaged ? { ...a, arrivesAt: now+1 } : a).filter(a => !(a.transit && !a.returning && a.pathIndex < a.path.length-1)).filter(a => a.arrivesAt <= Math.min(now + skill.horizon, end) && !friendlyAt(a.country, a.arrivesAt));
  for (const a of hostileWaves) {
    const p = pos.board.get(a.to);
    if (!friendlyAt(p.owner, a.arrivesAt)) continue;
    const result = future.combat(p.id, a.arrivesAt);
    if (result.side !== future.sideAt(country, a.arrivesAt) || !result.troops || result.confidence < .72) {
      if (!dangers.has(p.id) || dangers.get(p.id) > a.arrivesAt) dangers.set(p.id, a.arrivesAt);
    }
  }
  const spare = (p, attacking = null) => {
    if (dangers.has(p.id)) return 0;
    const hostile = neighbours(p).filter(q => q.owner && !friendlyAt(q.owner, now+1+travel(q.id,p.id)) && q.id !== attacking);
    const pressure = Math.max(0, ...hostile.map(q => Math.max(0, q.troops - 1 - (industrial ? p.development : 1) * Math.floor(travel(q.id, p.id) / r.recruit))));
    let keep = Math.ceil(Math.min(available(p) * .5, pressure * doctrine.reserve));
    // Keep known defenders, not the sum of every wave regardless of arrival time.
    for (const a of hostileWaves.filter(a => a.to === p.id)) {
      const result = future.combat(p.id, a.arrivesAt);
      keep = Math.max(keep, available(p) - Math.max(0, result.troops - 2));
    }
    return Math.max(0, Math.floor(available(p) - keep));
  };
  const matches = (a, id) => a.id === id || a.groupId === id || a.orderId === id;
  const pendingRecalls = pos.orders.filter(o => o.type === 'recall').map(o => o.target);
  function add(action, value, reason, extra = {}) { candidates.push({ action, value, reason, ...extra }); }
  function order(to, donors, amount, arriveAt, capacity = spare) {
    let left = amount;
    const sources = donors.map(p => { const send = Math.min(left, capacity(p)); left -= send; return { from: p.id, amount: send }; }).filter(p => p.amount > 0);
    if (left || !sources.length) return null;
    return industrial ? { type: 'attack', to, sources, ...(arriveAt ? { arriveAt } : {}) }
      : { type: 'move', from: sources[0].from, to, amount: sources[0].amount };
  }
  function required(id, at, maximum) {
    const wins = amount => {
      const result = future.combat(id, at, amount ? [{ country, amount }] : []);
      return result.side === future.sideAt(country, at) && result.troops > 0 && (result.confidence ?? 1) >= (doctrine.attack > 1 ? .67 : .8);
    };
    if (wins(0)) return 0;
    if (!wins(maximum)) return Infinity;
    let lo = 1, hi = maximum;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (wins(mid)) hi = mid; else lo = mid + 1; }
    return lo;
  }
  // Abort a hopeless group once, then impose a retarget cooldown to avoid yo-yoing.
  if (industrial) {
    const groups = new Map();
    for (const a of s.armies.filter(a => a.country === country && !a.returning)) {
      const id = a.groupId || a.id;
      if (!groups.has(id)) groups.set(id, []); groups.get(id).push(a);
    }
    for (const [id, armies] of groups) {
      const a = armies[0];
      if (pendingRecalls.some(target => armies.some(b => matches(b, target))) || !a.engaged && a.arrivesAt <= now + 2 || now - a.departedAt < 9) continue;
      if (a.transit && a.pathIndex < a.path.length-1) continue;
      const impact = Math.max(now+1, a.arrivesAt);
      const original = pos.board.get(a.to);
      if (friendlyAt(original.owner, impact)) continue;
      const result = future.combat(a.to, impact);
      if (r.warRequired ? result.confidence >= .2 : result.side === future.sideAt(country, impact) && result.troops > 0) continue;
      // A close exchange may still be useful. Avoid preserving armies at any price.
      const force = sum(armies.map(a => a.amount));
      const defenders = future.at(a.to, impact).troops;
      if (defenders < Math.max(4, force * .3)) continue;
      const safeHome = armies.some(a => friendlyAt(future.at(a.from, Math.min(r.duration, now + (now - a.departedAt) + 2)).owner, Math.min(r.duration, now + (now - a.departedAt) + 2)));
      if (safeHome) add({ type: 'recall', id }, 130 + Math.min(20, force / 10), 'Recall an outmatched attack', { avoid: a.to });
    }
  }
  // Rescue before impact, including an ally. Do not feed troops into a lost battle.
  for (const [id, firstImpact] of dangers) {
    const currentBattle = s.battles?.find(b => b.province === id);
    const estimate = future.combat(id, firstImpact);
    const impact = currentBattle ? Math.min(end, now + Math.max(1, estimate.rounds || 1) - 2) : firstImpact;
    const target = pos.board.get(id), mine = target.owner === country;
    // Confirmed future friendship does not yet permit a reinforcement order.
    if (!pos.canEnter(target.owner)) continue;
    const donors = owned.filter(p => p.id !== id && neighbours(p).some(q => q.id === id)
      && now + 1 + travel(p.id, id) <= impact && spare(p) > 0)
      .sort((a,b) => travel(a.id,id)-travel(b.id,id) || spare(b)-spare(a))
      .slice(0, industrial ? Math.min(skill.sources, r.maxAttackSources) : 1);
    const maximum = sum(donors.map(p => spare(p))), need = required(id, impact, maximum);
    const nearVictory = ownHold !== undefined || enemyHolds.some(([side]) => pos.side(s.armies.find(a => a.to === id)?.country) === side);
    if (need > 0 && need <= maximum) {
      const amount = Math.min(maximum, need + Math.max(2, Math.ceil(need * .12)));
      const action = order(id, donors, amount, industrial ? impact : undefined);
      if (action) add(action, 170 + (nearVictory ? 70 : 0) + target.development * 4 - (impact - now) * .1,
        mine ? 'Reinforce before the enemy arrives' : 'Save an allied province', { urgent: true });
    } else if (mine) {
      // Cancelling a waiting departure keeps its troops available at home.
      const waiting = pos.orders.find(o => o.type === 'move' && o.from === id && o.executeAt < impact && o.executeAt > now
        && !pendingRecalls.some(target => matches(o, target)));
      if (industrial && waiting) add({ type: 'recall', id: waiting.groupId || waiting.id }, 185, 'Cancel a departure to defend its source', { urgent: true });
      if (impact <= now + 1 || available(target) < 5) continue;
      const refuge = neighbours(target).filter(p => p.owner === country && !dangers.has(p.id) && now + 1 + travel(id, p.id) <= end
        && future.at(p.id, now + 1 + travel(id, p.id)).owner === country)
        .sort((a,b) => travel(id,a.id)-travel(id,b.id) || a.id.localeCompare(b.id))[0];
      if (refuge) add({ type: 'move', from: id, to: refuge.id, amount: available(target) }, 140 + Math.min(20, available(target) / 10),
        'Evacuate an indefensible garrison', { urgent: true });
    }
  }
  // Fronts must stop exporting their recruits when those recruits are needed here.
  for (const p of owned.filter(p => p.route)) if (dangers.has(p.id) || neighbours(p).some(q => q.owner && !friendly(q.owner))) {
    if (!pos.orders.some(o => o.type === 'route' && o.from === p.id)) add({ type: 'route', from: p.id, to: null }, 95, 'Keep new recruits on the threatened frontier', { urgent: dangers.has(p.id) });
  }
  if (memory.request?.kind === 'defend' && memory.request.expiresAt > now) {
    const target = pos.board.get(memory.request.target);
    if (target && friendly(target.owner) && !dangers.has(target.id)) {
      const pressure = Math.max(0, ...neighbours(target).filter(q => q.owner && !friendly(q.owner)).map(q => q.troops));
      const donors = owned.filter(p => p.id !== target.id && neighbours(p).some(q => q.id === target.id) && spare(p) >= 5)
        .sort((a,b) => travel(a.id,target.id)-travel(b.id,target.id)).slice(0, 1);
      if (donors.length) {
        const at = now+1+travel(donors[0].id,target.id);
        if (at <= end && friendlyAt(target.owner,at)) {
          const need = Math.ceil(pressure*.6)+4-future.at(target.id,at).troops;
          if (need >= 5) add(order(target.id,donors,Math.min(need,spare(donors[0]))), 50, 'Consider an ally’s defensive request');
        }
      }
    }
  }
  const targets = s.provinces.filter(p => !friendly(p.owner));
  const staging = [];
  for (const target of targets) {
    const threatenedLeader = enemyHolds.some(([side]) => pos.side(target.owner) === side);
    const needWar = !pos.canEnter(target.owner);
    const blockedMotion = (s.diplomacy || []).some(m => ['voting','offered'].includes(m.status) && m.kind==='war' && [m.fromSide,m.toSide].includes(pos.me.side) && [m.fromSide,m.toSide].includes(pos.side(target.owner)));
    if (needWar && (blockedMotion || (memory.warCooldown?.[pos.side(target.owner)] || 0)>now)) continue;
    if (target.owner && now < skill.opening && !threatenedLeader && !memory.relations[target.owner]?.harmedAt) continue;
    if ((memory.avoid[target.id] || 0) > now && !threatenedLeader) continue;
    const donors = owned.filter(p => neighbours(p).some(q => q.id === target.id) && spare(p, target.id) > 0)
      .sort((a,b) => travel(a.id,target.id)-travel(b.id,target.id) || spare(b)-spare(a));
    if (!donors.length) continue;
    const expansion = neighbours(target).filter(q => !q.owner).length;
    const priority = (target.owner ? 30 * doctrine.attack : 32 * doctrine.neutral) + target.development * 6
      + Math.min(4, expansion) * 3 + (threatenedLeader ? 95 : 0)
      + (memory.focus?.id === target.id && memory.focus.until > now ? 7 : 0)
      + (memory.request?.target === target.id && memory.request.expiresAt > now ? 12 : 0);
    staging.push({ target, value: priority, donors });
    // Prefixes of the nearest donors avoid waiting on a distant port unnecessarily.
    for (let size = 1; size <= Math.min(donors.length, industrial ? Math.min(skill.sources, r.maxAttackSources) : 1); size++) {
      const sources = donors.slice(0, size), duration = Math.max(...sources.map(p => travel(p.id, target.id)));
      const first = now + 1 + duration;
      if (first > end) continue;
      const timings = [first];
      if (industrial && skill.sources > 2) {
        // Follow a visible allied army's arrival, not that ally's secret orders.
        const allied = s.armies.filter(a => a.to === target.id && a.country !== country && friendlyAt(a.country, a.arrivesAt)
          && a.arrivesAt >= first && a.arrivesAt <= Math.min(end, first + 60)).sort((a,b) => a.arrivesAt-b.arrivesAt)[0];
        if (allied) timings.push(allied.arrivesAt);
      }
      for (const at of timings) {
        const capacity = p => spare(p, target.id);
        const maximum = sum(sources.map(capacity)), need = required(target.id, at, maximum);
        if (!Number.isFinite(need) || need === 0) continue;
        const amount = Math.min(maximum, Math.max(need + 3, Math.ceil(maximum * (doctrine.attack > 1 ? .8 : .7))));
        const predicted = future.combat(target.id, at, [{country,amount}]);
        if (at + (predicted.rounds || 0) > end) continue;
        const action = order(target.id, sources, amount, at === first ? undefined : at, capacity);
        if (!action) continue;
        const value = priority - need * .25 - (at-now) * .12 - (size-1) * 1.5
          + (hash(`${memory.seed}:${target.id}`) % 100) / 50;
        if (needWar) {
          const otherWars = new Set(s.players.filter(p=>pos.enemy(p.id)).map(p=>p.side)).size;
          if (threatenedLeader || otherWars < 2) add({type:'declare_war',country:target.owner}, value-8, 'Seek a feasible front through a lawful war declaration', {focus:target.id});
          continue;
        }
        add(action, value, threatenedLeader ? 'Break the leading coalition’s victory hold' : target.owner ? 'Attack an exposed front' : 'Expand into unclaimed territory',
          { focus: target.id, urgent: threatenedLeader });
      }
    }
  }
  // New factories pay in future troops. Never assume the war must last 30 minutes.
  if (industrial) for (const p of owned) {
    const f = developmentForecast(s, p.id);
    if (!f || f.alreadyInvested || f.queued || spare(p) < f.cost + 3) continue;
    const economyFinish = r.economyShare && f.completesAt + 60 < investEnd && (now > 1050 || ownHold !== undefined);
    if (!economyFinish && (f.paybackAt === null || f.paybackAt+60>investEnd)) continue;
    if (hostileWaves.some(a => a.to === p.id) || neighbours(p).some(q => q.owner && !friendly(q.owner))) continue;
    const net = Math.floor((investEnd - f.paybackAt) / r.recruit);
    add({ type: 'develop', from: p.id }, ((r.warRequired ? 18 : 14) + Math.min(24, Math.max(0, net) * .5) + (economyFinish ? 24 : 0)) * doctrine.economy, 'Invest in secure industry that can repay its manpower');
  }
  // Weighted supply routes; move old reserves explicitly (arrows only send new recruits).
  const goals = [];
  for (const p of owned.filter(pos.frontier)) {
    const options = staging.filter(t => t.donors.some(d => d.id === p.id));
    const cost = Math.min(...options.map(t => travel(p.id, t.target.id) + t.target.troops * .5 - t.value));
    goals.push([p.id, Number.isFinite(cost) ? cost : 100]);
  }
  // An allied border is a valid terminal for a gift, never a transit node we control.
  for (const p of owned) if (!goals.some(([id]) => id === p.id)) {
    const ally = neighbours(p).find(q => friendly(q.owner) && q.owner !== country && pos.frontier(q));
    if (ally) goals.push([p.id, 100]);
  }
  const route = paths(pos, goals);
  const alliedRoute = r.warRequired && !s.departures.some(d=>pos.friendly(d.country)) ? paths(pos, goals.filter(([id])=>pos.frontier(pos.board.get(id))), true) : null;
  for (const p of owned) {
    const to = route.next.get(p.id), amount = spare(p);
    if (to && now + 1 + travel(p.id, to) <= end && !dangers.has(to)) {
      const reverse = memory.transfers.some(t => t.from === to && t.to === p.id && t.until > now);
      if (!reverse && amount >= 5) add({ type: 'move', from: p.id, to, amount }, 26 + Math.min(36, amount * .18), 'Bring idle reserves toward a useful front', { transfer: true });
      if (!pos.frontier(p) && p.route !== to && !pos.orders.some(o => o.type === 'route' && o.from === p.id))
        add({ type: 'route', from: p.id, to }, 15, 'Direct local recruitment toward the front');
    }
    if (!to && alliedRoute && amount >= 8 && !pos.frontier(p)) {
      const path = []; let next = alliedRoute.next.get(p.id), from=p.id, duration=0;
      while(next && path.length < r.maxTransitHops && !path.includes(next) && !s.battles?.some(b=>b.province===next)) {
        path.push(next);duration+=travel(from,next);from=next;
        if(pos.board.get(next).owner===country)break;
        next=alliedRoute.next.get(next);
      }
      if(path.length>=2 && pos.board.get(path[0]).owner!==country && pos.board.get(path.at(-1)).owner===country && now+1+duration<=end)
        add({type:'transit',from:p.id,path,amount},42+Math.min(24,amount*.15),'Carry reserves through allied land without gifting the army', {transfer:true});
    }
    if (!to && !pos.frontier(p) && amount >= 10) {
      const ally = neighbours(p).filter(q => friendly(q.owner) && q.owner !== country && pos.frontier(q)
        && now + 1 + travel(p.id,q.id) <= end && friendlyAt(future.at(q.id, now + 1 + travel(p.id,q.id)).owner, now+1+travel(p.id,q.id)))
        .sort((a,b) => a.troops-b.troops)[0];
      if (ally) add({ type: 'move', from: p.id, to: ally.id, amount: Math.ceil(amount * .6) }, 20 + Math.min(20, amount * .15), 'Support an ally instead of stranding reserves behind their border', { transfer: true });
    }
  }
  candidates.sort((a,b) => b.value-a.value || hash(`${memory.seed}:${JSON.stringify(a.action)}`)-hash(`${memory.seed}:${JSON.stringify(b.action)}`));
  const best = candidates[0];
  return best && (best.value > 0 || best.urgent) ? best : null;
}
