import { riskForecast } from './risk-forecast.js';
/** A bounded forecast of the OBSERVED world, assuming no new orders.
 * Only our queued orders are visible. Future enemy decisions are never simulated
 * from private data. Forecasts are advice, not guarantees; the engine adjudicates.
 */
export const sum = values => values.reduce((n, v) => n + v, 0);
export function hash(text) {
  let value = 2166136261;
  for (const c of String(text)) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function position(state, map, country) {
  const places = new Map(map.provinces.map(p => [p.id, p]));
  const board = new Map(state.provinces.map(p => [p.id, p]));
  const players = new Map(state.players.map(p => [p.id, p]));
  const me = players.get(country), owned = state.provinces.filter(p => p.owner === country);
  const side = id => players.get(id)?.side ?? 'neutral';
  const friendly = id => Boolean(id && side(id) === me.side);
  const travel = (a, b) => state.travelTimes?.[a]?.[b] ?? state.rules.travel;
  const orders = state.commandBudget?.reserved || [];
  const reserved = new Map();
  for (const o of orders) if (['move', 'transit', 'develop'].includes(o.type)) reserved.set(o.from, (reserved.get(o.from) || 0) + o.amount);
  const available = p => Math.max(0, p.troops - (reserved.get(p.id) || 0) - 1);
  const neighbours = p => places.get(p.id).neighbors.map(id => board.get(id));
  const frontier = p => neighbours(p).some(q => !friendly(q.owner));
  const wars = new Set(state.wars || []);
  const enemy = id => Boolean(id && !friendly(id) && (!state.rules.warRequired || wars.has([country,id].sort().join(':'))));
  const canEnter = id => !id || friendly(id) || enemy(id);
  return { wars, enemy, canEnter, state, map, country, places, board, players, me, side, friendly, travel, orders, reserved, available, neighbours, frontier, owned };
}
function battle(garrison, arrivals, sideAt, tick) {
  const defender = sideAt(garrison.owner, tick), strengths = new Map([[defender, garrison.troops]]);
  for (const a of arrivals) { const s = sideAt(a.country, tick); strengths.set(s, (strengths.get(s) || 0) + a.amount); }
  const total = sum([...strengths.values()]), winner = [...strengths].find(([, n]) => n > total - n);
  return { side: winner?.[0] ?? defender, troops: winner ? 2 * winner[1] - total : 0, conquered: Boolean(winner && winner[0] !== defender) };
}
export function forecast(pos) {
  if (pos.state.rules.warRequired) return riskForecast(pos);
  const { state, orders, travel } = pos, r = state.rules;
  const board = new Map(state.provinces.map(p => [p.id, { ...p, developing: p.developing ? { ...p.developing } : null }]));
  const timeline = new Map([...board].map(([id, p]) => [id, [{ tick: state.tick, ...p }]]));
  const arrivals = new Map(), departures = new Map(), memberships = new Map();
  const push = (index, at, value) => { if (!index.has(at)) index.set(at, []); index.get(at).push(value); };
  // Known, confirmed future allegiance changes only; open offers are not allies.
  let affiliations = new Map(state.players.map(p => [p.id, p.side]));
  const sideHistory = [{ tick: state.tick, values: new Map(affiliations) }];
  for (const q of state.proposals.filter(q => q.status === 'pending')) push(memberships, q.activateAt, q);
  for (const d of state.departures) push(memberships, d.activateAt, d);
  const sideAt = (id, at) => {
    for (let i = sideHistory.length - 1; i >= 0; i--) if (sideHistory[i].tick <= at) return sideHistory[i].values.get(id) ?? 'neutral';
    return 'neutral';
  };
  const cancelled = new Set(orders.filter(o => o.type === 'recall').map(o => o.target));
  const recalled = a => [a.id, a.groupId, a.orderId].some(id => id && cancelled.has(id));
  for (const a of state.armies) {
    if (recalled(a) && !a.returning) {
      const back = Math.max(1, Math.min(a.arrivesAt - a.departedAt, state.tick + 1 - a.departedAt));
      push(arrivals, state.tick + 1 + back, { ...a, to: a.from });
    } else push(arrivals, a.arrivesAt, { ...a });
  }
  for (const o of orders) if (o.type !== 'recall' && !recalled(o)) push(departures, o.executeAt, o);
  const before = new Map();
  let now = state.tick;
  function ensure(until) {
    until = Math.min(r.duration, until);
    while (now < until) {
      now++;
      if (memberships.has(now)) {
        for (const change of memberships.get(now)) {
          if (change.roster) {
            const id = change.coalition || `forecast:${change.id}`;
            for (const member of change.roster) affiliations.set(member, id);
          } else {
            const previous = affiliations.get(change.country);
            affiliations.set(change.country, `forecast:solo:${change.country}:${now}`);
            const remaining = [...affiliations].filter(([, s]) => s === previous);
            if (remaining.length === 1) affiliations.set(remaining[0][0], `forecast:solo:${remaining[0][0]}:${now}`);
          }
        }
        sideHistory.push({ tick: now, values: new Map(affiliations) });
      }
      const changed = new Set();
      for (const o of departures.get(now) || []) {
        const p = board.get(o.from);
        if (p.owner !== o.country) continue;
        if (o.type === 'route') { if (o.to === null || sideAt(o.country, now) === sideAt(board.get(o.to).owner, now)) p.route = o.to; }
        else if (p.troops > o.amount) {
          p.troops -= o.amount;
          if (o.type === 'develop') p.developing = { level: o.level, completesAt: now + r.developmentTicks[p.development] };
          else push(arrivals, o.arrivesAt ?? now + travel(o.from, o.to), { ...o, country: o.country });
        }
        changed.add(p.id);
      }
      const targets = new Map();
      for (const a of arrivals.get(now) || []) { if (!targets.has(a.to)) targets.set(a.to, []); targets.get(a.to).push(a); }
      for (const [id, troops] of targets) {
        const p = board.get(id); before.set(`${now}:${id}`, { ...p });
        const result = battle(p, troops, sideAt, now);
        if (result.conquered) {
          const totals = new Map();
          for (const a of troops) if (sideAt(a.country, now) === result.side) totals.set(a.country, (totals.get(a.country) || 0) + a.amount);
          const ids = [...pos.players.keys()].sort(), offset = now % ids.length;
          const priority = [...ids.slice(offset), ...ids.slice(0, offset)];
          p.owner = [...totals].sort((a,b) => b[1]-a[1] || priority.indexOf(a[0])-priority.indexOf(b[0]))[0][0];
          p.nextRecruit = now + r.recruit; p.developing = null; p.route = null;
        }
        p.troops = result.troops; changed.add(id);
      }
      for (const p of board.values()) {
        if (p.developing?.completesAt <= now) { p.development = p.developing.level; p.developing = null; changed.add(p.id); }
        if (p.route && (!p.owner || sideAt(p.owner, now) !== sideAt(board.get(p.route).owner, now))) { p.route = null; changed.add(p.id); }
        if (!p.owner || p.nextRecruit > now) continue;
        const born = r.distanceMovement ? p.development : 1;
        p.troops += born; p.nextRecruit = now + r.recruit; changed.add(p.id);
        if (p.route) {
          const amount = Math.min(born, p.troops - 1); p.troops -= amount;
          if (amount) push(arrivals, now + travel(p.id, p.route), { from: p.id, to: p.route, country: p.owner, amount });
        }
      }
      for (const id of changed) timeline.get(id).push({ tick: now, ...board.get(id) });
    }
  }
  function at(id, time) {
    ensure(time);
    const rows = timeline.get(id); let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].tick <= time) lo = mid + 1; else hi = mid; }
    return rows[Math.max(0, lo - 1)];
  }
  function combat(id, time, additions = []) {
    ensure(time);
    const p = before.get(`${time}:${id}`) || { ...at(id, time - 1) };
    if (!before.has(`${time}:${id}`)) for (const o of departures.get(time) || [])
      if (o.from === id && ['move', 'transit', 'develop'].includes(o.type) && p.owner === o.country && p.troops > o.amount) p.troops -= o.amount;
    return battle(p, [...(arrivals.get(time) || []).filter(a => a.to === id), ...additions], sideAt, time);
  }
  return { at, combat, sideAt: (id,t) => { ensure(t); return sideAt(id,t); } };
}
/** Dijkstra over OWN territory: crossing an ally's land gifts away the army. */
export function paths(pos, goals, includeAllies = false) {
  const distance = new Map(), next = new Map(), todo = new Set((includeAllies ? pos.state.provinces.filter(p=>pos.friendly(p.owner)) : pos.owned).map(p => p.id));
  for (const [id, value] of goals) if (todo.has(id)) distance.set(id, value);
  while (todo.size) {
    let from = null, best = Infinity;
    for (const id of todo) if ((distance.get(id) ?? Infinity) < best) { from = id; best = distance.get(id); }
    if (from === null) break;
    todo.delete(from);
    for (const q of pos.neighbours(pos.board.get(from))) if (todo.has(q.id)) {
      const candidate = best + pos.travel(q.id, from);
      if (candidate < (distance.get(q.id) ?? Infinity)) { distance.set(q.id, candidate); next.set(q.id, from); }
    }
  }
  return { distance, next };
}
