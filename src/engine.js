/** Authoritative, deterministic rules. Time is an integer simulation second.
 * No HTTP, random numbers, timers, credentials, or persistence in this module.
 */
export const RULES = Object.freeze({ duration: 1800, travel: 45, recruit: 20,
  notice: 30, hold: 90, threshold: 39, maturity: 300, orderWindow: 10,
  orderLimit: 3, chatWindow: 10, messageLength: 500, proposalLife: 120 });

export class RuleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function requireRule(condition, message, status = 400) {
  if (!condition) throw new RuleError(message, status);
}
export function text(value, label, max = 80) {
  requireRule(typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label} must be 1–${max} characters.`);
  requireRule(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${label} contains control characters.`);
  return value.trim();
}
const sorted = values => [...values].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const members = (g, side) => g.players.filter(p => p.side === side);
export const allied = (g, a, b) => Boolean(a && b && player(g, a).side === player(g, b).side);
export function player(g, id) {
  const p = g.players.find(p => p.id === id);
  requireRule(p, 'Country has no player.', 404); return p;
}
function province(g, id) {
  const p = g.provinces.find(p => p.id === id);
  requireRule(p, 'Unknown province.', 404); return p;
}
function event(g, type, data = {}, recipients = null) {
  const e = { id: ++g.sequence, tick: g.tick, type, ...data };
  if (recipients) e.recipients = [...recipients];
  g.events.push(e); return e;
}
function identifier(g, prefix) { return `${prefix}${++g.serial}`; }
function alive(g, id) {
  const p = player(g, id); requireRule(p.eliminatedAt === null, 'Eliminated countries cannot do that.'); return p;
}
export function createGame({ id, name, hostId, speed = 1, eligible = false }, map) {
  return { version: 1, id, name: text(name, 'Room name'), hostId, speed, eligible,
    status: 'lobby', tick: 0, sequence: 0, serial: 0, players: [],
    provinces: map.provinces.map(p => ({ id: p.id, owner: null, troops: 2, nextRecruit: null, route: null })),
    armies: [], orders: [], proposals: [], departures: [], coalitions: [], events: [], receipts: {},
    dominance: {}, outcome: null, actionLog: [] };
}
export function join(g, map, { profileId, name, country, kind = 'human', model = '', persona = '' }) {
  requireRule(g.status === 'lobby', 'Seats are closed after the match starts.', 409);
  requireRule(['human', 'agent', 'bot'].includes(kind), 'Unknown player kind.');
  const existing = g.players.find(p => p.profileId === profileId);
  if (existing) { requireRule(existing.id === country, 'You already occupy another country.', 409); return existing; }
  const c = map.countries.find(c => c.id === country);
  requireRule(c, 'Choose a listed country.');
  requireRule(!g.players.some(p => p.id === country), 'That country is taken.', 409);
  const p = { id: country, profileId, name: text(name, 'Player name', 40), kind,
    model: String(model).slice(0, 100), persona: String(persona).slice(0, 100),
    side: `solo:${country}:0`, joinedAt: 0, eliminatedAt: null, orderTicks: [], lastChat: null };
  g.players.push(p);
  for (const id of c.start) Object.assign(province(g, id), { owner: country, troops: 10 });
  if (kind === 'bot') g.eligible = false;
  event(g, 'joined', { country, name: p.name, kind }); return p;
}
export function start(g) {
  requireRule(g.status === 'lobby', 'Match has already started.', 409);
  requireRule(g.players.length >= 2, 'At least two occupied countries are needed.');
  g.status = 'running';
  for (const p of g.provinces) if (p.owner) p.nextRecruit = RULES.recruit;
  event(g, 'started', { countries: g.players.map(p => p.id), speed: g.speed });
}
function running(g) { requireRule(g.status === 'running', 'The match is not running.', 409); }
function mapProvince(map, id) { return map.provinces.find(p => p.id === id); }
function military(g, map, p, action) {
  alive(g, p.id);
  const source = province(g, action.from);
  requireRule(source.owner === p.id, 'You do not own the source province.', 403);
  requireRule(action.to === null && action.type === 'route' || mapProvince(map, source.id).neighbors.includes(action.to),
    'Destination must be connected to the source.');
  p.orderTicks = p.orderTicks.filter(t => t > g.tick - RULES.orderWindow);
  requireRule(p.orderTicks.length < RULES.orderLimit, 'Military command cooldown: three per ten game seconds.', 429);
  if (action.type === 'move') {
    requireRule(Number.isSafeInteger(action.amount) && action.amount > 0, 'Troop amount must be a positive integer.');
    const reserved = g.orders.filter(o => o.country === p.id && o.from === source.id && o.type === 'move')
      .reduce((n, o) => n + o.amount, 0);
    requireRule(action.amount <= source.troops - reserved - 1, 'Not enough uncommitted troops; leave one at home.');
  } else if (action.to !== null) {
    requireRule(allied(g, p.id, province(g, action.to).owner), 'Recruitment routes need a friendly destination.');
  }
  const order = { id: identifier(g, 'order-'), country: p.id, type: action.type,
    from: source.id, to: action.to, amount: action.amount ?? null, executeAt: g.tick + 1 };
  p.orderTicks.push(g.tick); g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt };
}
function locked(g, id) {
  return g.departures.some(d => d.country === id) ||
    g.proposals.some(p => p.status === 'pending' && p.roster.includes(id));
}
function signature(g, ids) { return ids.map(id => `${id}|${player(g, id).side}`).sort().join(','); }
function validProposal(g, q) {
  if (signature(g, q.roster) !== q.signature || player(g, q.candidate).eliminatedAt !== null) return false;
  if (q.coalition) return same(members(g, q.coalition).map(p => p.id), q.roster.filter(id => id !== q.candidate));
  return q.roster.every(id => player(g, id).side.startsWith('solo:') && player(g, id).eliminatedAt === null);
}
function cancel(g, q, reason) {
  const recipients = q.status === 'open' ? q.roster : null;
  q.status = 'cancelled'; event(g, 'proposal_cancelled', { proposalId: q.id, reason }, recipients);
}
function confirm(g, q) {
  const voters = q.roster.filter(id => player(g, id).eliminatedAt === null);
  if (!voters.every(id => q.accepted.includes(id))) return;
  requireRule(q.roster.every(id => !locked(g, id)), 'A member already has a confirmed membership change.', 409);
  q.status = 'pending'; q.activateAt = g.tick + RULES.notice;
  event(g, 'alliance_notice', { proposalId: q.id, name: q.name, roster: q.roster, activateAt: q.activateAt });
}
function propose(g, p, a) {
  alive(g, p.id); const candidate = alive(g, a.country);
  requireRule(candidate.id !== p.id, 'Choose another country.');
  requireRule(candidate.side.startsWith('solo:'), 'The candidate must first leave their current coalition.');
  requireRule(!locked(g, candidate.id) && !locked(g, p.id), 'Membership change already pending.', 409);
  requireRule(g.proposals.filter(q => q.status === 'open' && q.creator === p.id).length < 3,
    'At most three outstanding offers per country.', 429);
  const coalition = p.side.startsWith('solo:') ? null : p.side;
  const roster = [...members(g, p.side).map(m => m.id), candidate.id];
  const q = { id: identifier(g, 'offer-'), creator: p.id, candidate: candidate.id, coalition, roster,
    name: coalition ? g.coalitions.find(c => c.id === coalition).name : text(a.name || 'The Accord', 'Coalition name', 40),
    signature: signature(g, roster), accepted: [p.id], status: 'open', expiresAt: g.tick + RULES.proposalLife };
  g.proposals.push(q); event(g, 'alliance_offer', { proposalId: q.id, from: p.id, roster, name: q.name }, roster);
  return { proposalId: q.id };
}
function accept(g, p, a) {
  alive(g, p.id);
  const q = g.proposals.find(q => q.id === a.proposalId);
  requireRule(q && q.status === 'open', 'Offer is no longer open.', 409);
  requireRule(q.roster.includes(p.id), 'You are not a party to this offer.', 403);
  requireRule(validProposal(g, q), 'Membership changed; request a new offer.', 409);
  requireRule(q.roster.every(id => !locked(g, id)), 'A member already has a confirmed membership change.', 409);
  if (!q.accepted.includes(p.id)) q.accepted.push(p.id);
  confirm(g, q);
  event(g, 'offer_accepted', { proposalId: q.id, country: p.id }, q.roster);
  return { proposalId: q.id, status: q.status, activateAt: q.activateAt ?? null };
}
function decline(g, p, a) {
  alive(g, p.id);
  const q = g.proposals.find(q => q.id === a.proposalId);
  requireRule(q && q.status === 'open', 'Offer is no longer open.', 409);
  requireRule(q.roster.includes(p.id), 'You are not a party to this offer.', 403);
  cancel(g, q, 'A participant declined or withdrew the offer.');
  return { proposalId: q.id, status: q.status };
}
function leave(g, p) {
  alive(g, p.id); requireRule(!p.side.startsWith('solo:'), 'You are already independent.');
  requireRule(!g.departures.some(d => d.country === p.id), 'Your departure is already pending.', 409);
  // Departure is unilateral, including during an admission notice. Invalidate that consent.
  for (const q of g.proposals) if (['open', 'pending'].includes(q.status) && q.roster.includes(p.id))
    cancel(g, q, 'A participant filed a departure.');
  const departure = { country: p.id, side: p.side, activateAt: g.tick + RULES.notice };
  g.departures.push(departure); event(g, 'departure_notice', departure);
  return departure;
}
function chat(g, p, a) {
  const message = text(a.text, 'Message', RULES.messageLength);
  requireRule(p.lastChat === null || g.tick - p.lastChat >= RULES.chatWindow, 'Chat cooldown: ten game seconds across all channels.', 429);
  requireRule(['world', 'alliance', 'dm'].includes(a.channel), 'Choose world, alliance, or dm.');
  let recipients = null;
  if (a.channel === 'alliance') {
    requireRule(!p.side.startsWith('solo:'), 'You are not in a coalition.');
    recipients = members(g, p.side).map(p => p.id);
  } else if (a.channel === 'dm') {
    player(g, a.to); recipients = [...new Set([p.id, a.to])];
  }
  p.lastChat = g.tick;
  const e = event(g, 'message', { from: p.id, channel: a.channel, to: a.channel === 'dm' ? a.to : null,
    text: message, untrusted: true }, recipients);
  return { messageId: e.id };
}
/** Every client, including built-in practice bots, passes through this function.
 * Repeating an opId with the identical payload is safe; reusing it for another action is rejected.
 */
export function act(g, map, country, action, opId) {
  requireRule(typeof opId === 'string' && /^[\w-]{1,80}$/.test(opId), 'An operation ID (1–80 letters, digits, _ or -) is required.');
  requireRule(action && typeof action === 'object' && !Array.isArray(action), 'Action must be an object.');
  const key = `${country}:${opId}`;
  const fingerprint = JSON.stringify(Object.keys(action).sort().map(k => [k, action[k]]));
  const previous = g.receipts[key];
  if (previous) { requireRule(previous.fingerprint === fingerprint, 'Operation ID already used for a different action.', 409); return previous.result; }
  running(g); const p = player(g, country); let result;
  switch (action.type) {
    case 'move': case 'route': result = military(g, map, p, action); break;
    case 'propose': result = propose(g, p, action); break;
    case 'accept': result = accept(g, p, action); break;
    case 'decline': result = decline(g, p, action); break;
    case 'leave': result = leave(g, p); break;
    case 'chat': result = chat(g, p, action); break;
    default: throw new RuleError('Unknown action type.');
  }
  result = { ok: true, acceptedTick: g.tick, ...result };
  g.receipts[key] = { fingerprint, result };
  g.actionLog.push({ tick: g.tick, country, action: structuredClone(action), opId });
  return result;
}
function independent(g, p) {
  p.side = `solo:${p.id}:${identifier(g, 's')}`; p.joinedAt = g.tick;
}
function applyMembership(g) {
  for (const d of g.departures.filter(d => d.activateAt <= g.tick)) {
    const p = player(g, d.country);
    if (p.eliminatedAt !== null || p.side !== d.side) continue;
    independent(g, p); delete g.dominance[d.side];
    event(g, 'departed', { country: p.id, formerSide: d.side, side: p.side });
    const remaining = members(g, d.side);
    if (remaining.length === 1) {
      independent(g, remaining[0]); event(g, 'coalition_dissolved', { side: d.side });
    }
  }
  g.departures = g.departures.filter(d => d.activateAt > g.tick);
  for (const q of g.proposals) {
    if (!['open', 'pending'].includes(q.status)) continue;
    if (!validProposal(g, q)) { cancel(g, q, 'Roster or eligibility changed.'); continue; }
    if (q.status === 'open') {
      if (g.tick >= q.expiresAt) cancel(g, q, 'Offer expired.');
      // A retained eliminated member has no vote. Re-evaluate without requiring
      // an already-consenting survivor to find and press Accept again.
      else if (q.roster.every(id => !locked(g, id))) confirm(g, q);
      continue;
    }
    if (q.activateAt > g.tick) continue;
    const side = q.coalition || identifier(g, 'coalition-');
    if (!q.coalition) g.coalitions.push({ id: side, name: q.name, createdAt: g.tick });
    for (const id of q.coalition ? [q.candidate] : q.roster) {
      const p = player(g, id); delete g.dominance[p.side]; p.side = side; p.joinedAt = g.tick;
    }
    delete g.dominance[side]; q.status = 'activated';
    event(g, 'alliance_activated', { side, name: q.name, roster: q.roster });
  }
}
function departArmy(g, country, from, to, amount, automatic = false) {
  g.armies.push({ id: identifier(g, 'army-'), country, from, to, amount, departedAt: g.tick,
    arrivesAt: g.tick + RULES.travel });
  if (!automatic) event(g, 'army_departed', { country, from, to, amount, arrivesAt: g.tick + RULES.travel });
}
function executeOrders(g) {
  for (const o of g.orders.filter(o => o.executeAt <= g.tick)) {
    const source = province(g, o.from);
    let error = source.owner !== o.country ? 'Source is no longer yours.' : null;
    if (o.type === 'move' && o.amount >= source.troops) error = 'Not enough troops remain.';
    if (o.type === 'route' && o.to !== null && !allied(g, o.country, province(g, o.to).owner)) error = 'Destination is no longer friendly.';
    if (error) { event(g, 'order_failed', { country: o.country, orderId: o.id, reason: error }, [o.country]); continue; }
    if (o.type === 'route') source.route = o.to;
    else { source.troops -= o.amount; departArmy(g, o.country, o.from, o.to, o.amount); }
    event(g, 'order_executed', { country: o.country, orderId: o.id }, [o.country]);
  }
  g.orders = g.orders.filter(o => o.executeAt > g.tick);
}
function resolveArrivals(g) {
  const due = g.armies.filter(a => a.arrivesAt <= g.tick);
  g.armies = g.armies.filter(a => a.arrivesAt > g.tick);
  const ids = g.players.map(p => p.id).sort();
  const rotated = [...ids.slice(g.tick % ids.length), ...ids.slice(0, g.tick % ids.length)];
  for (const target of g.provinces) {
    const arrivals = due.filter(a => a.to === target.id);
    if (!arrivals.length) continue;
    const defender = target.owner ? player(g, target.owner).side : 'neutral';
    const strengths = new Map([[defender, target.troops]]);
    for (const a of arrivals) {
      const side = player(g, a.country).side;
      strengths.set(side, (strengths.get(side) || 0) + a.amount);
    }
    const total = [...strengths.values()].reduce((a,b) => a+b,0);
    const winner = [...strengths].find(([,n]) => n > total - n);
    const previousOwner = target.owner, before = target.troops;
    target.troops = winner ? 2 * winner[1] - total : 0;
    if (winner && winner[0] !== defender) {
      const contribution = new Map();
      for (const a of arrivals) if (player(g, a.country).side === winner[0])
        contribution.set(a.country, (contribution.get(a.country) || 0) + a.amount);
      target.owner = [...contribution].sort((a,b) => b[1]-a[1] || rotated.indexOf(a[0])-rotated.indexOf(b[0]))[0][0];
      target.nextRecruit = g.tick + RULES.recruit; target.route = null;
    }
    event(g, strengths.size > 1 ? 'battle' : 'reinforced', {
      province: target.id, previousOwner, owner: target.owner, before, troops: target.troops,
      arrivals: arrivals.map(a => ({ country: a.country, amount: a.amount })),
      strengths: Object.fromEntries(strengths) });
  }
}
function recruit(g) {
  for (const p of g.provinces) {
    if (p.route && !allied(g, p.owner, province(g, p.route).owner)) p.route = null;
    if (!p.owner || p.nextRecruit > g.tick) continue;
    p.troops++; p.nextRecruit = g.tick + RULES.recruit;
    if (p.route && p.troops > 1) { p.troops--; departArmy(g, p.owner, p.id, p.route, 1, true); }
  }
}
export function sides(g) {
  return [...new Set(g.players.map(p => p.side))].map(id => ({ id,
    name: g.coalitions.find(c => c.id === id)?.name || members(g, id)[0]?.id,
    members: members(g, id).map(p => p.id),
    provinces: g.provinces.filter(v => v.owner && player(g, v.owner).side === id).length }));
}
export function score(g, winningSide = null, draw = false) {
  const duration = Math.max(1, Math.min(RULES.maturity, g.tick));
  return g.players.map(p => {
    const roster = members(g, p.side), maturity = Math.min(1, Math.max(0, (p.eliminatedAt ?? g.tick) - p.joinedAt) / duration);
    const share = 100 * g.players.length / roster.length;
    const payout = draw ? 100 : p.side === winningSide ? share * maturity : 0;
    return { country: p.id, maturity, maximumShare: share, projectedPrestige: share * maturity - 100,
      payout, prestige: payout - 100 };
  });
}
function finish(g, winningSide, reason) {
  g.status = 'finished';
  g.outcome = { winningSide, reason, tick: g.tick, draw: winningSide === null,
    scores: score(g, winningSide, winningSide === null) };
  event(g, 'finished', g.outcome);
}
function victory(g) {
  const teams = sides(g);
  if (teams.some(t => t.members.length === g.players.length)) { finish(g, null, 'negotiated_draw'); return; }
  for (const p of g.players) if (p.eliminatedAt === null &&
    !g.provinces.some(v => v.owner === p.id) && !g.armies.some(a => a.country === p.id)) {
    p.eliminatedAt = g.tick; event(g, 'eliminated', { country: p.id });
  }
  for (const t of teams) {
    if (t.provinces < RULES.threshold) { delete g.dominance[t.id]; continue; }
    if (g.dominance[t.id] === undefined) { g.dominance[t.id] = g.tick; event(g, 'dominance', { side: t.id, winsAt: g.tick + RULES.hold }); }
    if (g.tick - g.dominance[t.id] >= RULES.hold) { finish(g, t.id, 'domination'); return; }
  }
  if (g.tick >= RULES.duration) {
    const ranked = teams.sort((a,b) => b.provinces-a.provinces);
    finish(g, ranked[0].provinces > ranked[1].provinces ? ranked[0].id : null, 'deadline');
  }
}
export function tick(g) {
  if (g.status !== 'running') return;
  g.tick++; applyMembership(g); executeOrders(g); resolveArrivals(g); recruit(g); victory(g);
}
/** A viewer gets only public events and inbox messages addressed to that seat at SEND time. */
export function observe(g, country = null, after = 0, limit = 200) {
  requireRule(Number.isSafeInteger(after) && after >= 0, 'Invalid event cursor.');
  requireRule(Number.isSafeInteger(limit) && limit > 0 && limit <= 10000, 'Invalid event limit.');
  // Cursor lookup is logarithmic; a quiet poll must not rescan a whole match.
  let lo = 0, hi = g.events.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1;
    if (g.events[mid].id <= after) lo = mid + 1; else hi = mid; }
  const visible = [];
  for (let i = lo; i < g.events.length && visible.length <= limit; i++) {
    const e = g.events[i];
    if (!e.recipients || e.recipients.includes(country)) visible.push(e);
  }
  const hasMore = visible.length > limit;
  const events = visible.slice(0, limit).map(({ recipients, ...e }) => e);
  const p = country ? player(g, country) : null;
  return { id: g.id, name: g.name, status: g.status, tick: g.tick, speed: g.speed, rules: RULES,
    eligible: g.eligible, you: country, players: g.players.map(({ profileId, orderTicks, lastChat, ...p }) => p),
    provinces: g.provinces, armies: g.armies, sides: sides(g), projections: score(g),
    proposals: g.proposals.filter(q => q.status === 'pending' || q.status === 'open' && q.roster.includes(country))
      .map(({ signature, ...q }) => q), departures: g.departures, dominance: g.dominance,
    commandBudget: p ? { remaining: RULES.orderLimit - p.orderTicks.filter(t => t > g.tick-RULES.orderWindow).length,
      reserved: g.orders.filter(o => o.country === country),
      nextRecoveryAt: p.orderTicks.find(t => t > g.tick-RULES.orderWindow) === undefined ? null :
        p.orderTicks.find(t => t > g.tick-RULES.orderWindow) + RULES.orderWindow,
      chatReadyAt: p.lastChat === null ? g.tick : p.lastChat + RULES.chatWindow } : null,
    tiePriority: (() => { const ids=g.players.map(p=>p.id).sort(), n=ids.length ? g.tick%ids.length : 0; return [...ids.slice(n),...ids.slice(0,n)]; })(),
    events, cursor: hasMore ? events.at(-1).id : g.sequence, hasMore, outcome: g.outcome };
}

export function preview(g, map, from, to, amount, viewer = null) {
  const a=province(g,from),b=province(g,to);
  requireRule(mapProvince(map,from).neighbors.includes(to),'Destination is not adjacent.');
  // Only the owner can inspect unexecuted reservations; spectators see the public garrison.
  const reserved = a.owner && a.owner === viewer ? g.orders.filter(o=>o.country===viewer && o.from===from && o.type==='move').reduce((n,o)=>n+o.amount,0) : 0;
  requireRule(Number.isSafeInteger(amount) && amount>0 && amount<a.troops-reserved,'Choose a positive amount of uncommitted troops and leave at least one behind.');
  let summary;
  if(a.owner && allied(g,a.owner,b.owner)) summary=`Reinforce ${mapProvince(map,to).name} with ${amount} troops${a.owner!==b.owner?'; ownership of these troops passes to your ally':''}.`;
  else if(amount>b.troops) summary=`Against the current garrison: capture with ${amount-b.troops} surviving troops.`;
  else if(amount===b.troops) summary='Both forces are destroyed; the previous owner keeps the empty province.';
  else summary=`The current defenders survive with ${b.troops-amount} troops.`;
  return {from,to,amount,reserved,available:a.troops-reserved-1,remaining:a.troops-reserved-amount,summary,
    incoming:g.armies.filter(a=>a.to===to),warning:'Current garrison only; not a prediction of future orders, recruitment, or diplomatic changes.'};
}
