import { travelTicks, journeyPoint, friendlyPath as sharedPath } from '../public/movement.js';
import { feedItems, feedPage, isWorldMessage } from '../public/feed-model.js';
import { combatForecast } from '../public/combat.js';
import { truceUntil } from '../public/relations.js';
/** Authoritative, deterministic rules. Time is an integer simulation second.
 * No HTTP, random numbers, timers, credentials, or persistence in this module.
 * The player-facing rules are README "How to play"; docs/AGENT-RULES.md for agents.
 */
export const RULES = Object.freeze({ duration: 1800, recruit: 20,
  notice: 30, hold: 90, economyShare: .6, messageLength: 500, proposalLife: 120, peaceLife: 60,
  // Truce: once peace takes effect, neither side (both whole alliances at that moment) may declare war
  // on the other for `truce` ticks. A peace offer that expires unanswered cannot be repeated to the same
  // side for `peaceRetry` ticks. Evidence: docs/PLAYTEST.md (war/peace ping-pong).
  truce: 120, peaceRetry: 30,
  // Invisible anti-spam limits, not rules players plan around: 10 orders per 10 s, one message per 2 s.
  orderLimit: 10, orderWindow: 10, chatWindow: 2,
  // Movement: every link ×1.2 faster than the base table; internal links (both ends yours or an
  // ally's when the leg departs, sea lanes included) a further ×2. Battle rounds 25% slower
  // (4 rounds per 5 ticks, same dice per round). Development: 24/120 then 48/180. Evidence: docs/BALANCE.md.
  marchSetup: 15, kmPerTick: 35, moveSpeedPercent: 120, internalSpeedPercent: 200, battleSlowdownPercent: 125,
  maxSources: 16, maxTurnArounds: 2, maxDevelopment: 3, developmentCosts: [0, 24, 48], developmentTicks: [0, 120, 180] });
export const gameRules = g => g.rules;
export const reservedTroops = (g, country, from) => g.orders
  .filter(o => o.country === country && o.from === from && ['march', 'develop'].includes(o.type))
  .reduce((n, o) => n + o.amount, 0);
/** A link is internal for `country` when both ends belong to it or an ally right now. */
const internalLink = (g, country, from, to) => Boolean(country &&
  allied(g, country, province(g, from).owner) && allied(g, country, province(g, to).owner));
const journeyTicks = (g, from, to, country = null) =>
  internalLink(g, country, from, to) ? g.internalTravelTimes[from][to] : g.travelTimes[from][to];
function arrivalDefense(g,target,arrivesAt){
  const recruits=target.owner && Number.isSafeInteger(target.nextRecruit) && target.nextRecruit<=arrivesAt
    ? (Math.floor((arrivesAt-target.nextRecruit)/gameRules(g).recruit)+1)*target.development : 0;
  const incoming=g.armies.filter(a=>!a.engaged && !a.returning && a.to===target.id && target.owner && allied(g,a.country,target.owner) && a.arrivesAt<=arrivesAt)
    .reduce((n,a)=>n+a.amount,0);
  return {current:target.troops,recruits,incoming,total:target.troops+recruits+incoming,
    assumption:'Current owner, industry, recruitment schedule and visible friendly incoming armies stay unchanged; no new orders, captures, recalls or combat.'};
}

export class RuleError extends Error {
  /** `details` are extra machine-readable facts returned beside the message (e.g. `truceUntil`). */
  constructor(message, status = 400, details = null) { super(message); this.status = status; if (details) this.details = details; }
}
export function requireRule(condition, message, status = 400, details = null) {
  if (!condition) throw new RuleError(message, status, details);
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
const warKey = (a, b) => [a, b].sort().join(':');
export const atWar = (g, a, b) => Boolean(a && b && !allied(g, a, b) && g.wars.includes(warKey(a, b)));
function mayEnter(g, country, owner) { return !owner || allied(g, country, owner) || atWar(g, country, owner); }
function sideRoster(g, side) { return members(g, side).map(p => p.id); }
/** An alliance holds at most half the countries in the match, so there is always an opponent. */
export const maxAlliance = g => Math.floor(g.players.length / 2);
export function player(g, id) {
  const p = g.players.find(p => p.id === id);
  requireRule(p, 'Country has no player.', 404); return p;
}
export function displayName(p) {
  return p.kind==='agent' && p.model && !p.name.toLowerCase().includes(p.model.toLowerCase())
    ? `${p.name} · ${p.model}` : p.name;
}
function province(g, id) {
  const p = g.provinces.find(p => p.id === id);
  requireRule(p, 'Unknown province.', 404); return p;
}
function event(g, type, data = {}, recipients = null) {
  const e = { id: ++g.sequence, tick: g.tick, type, ...data };
  if (recipients) e.recipients = [...recipients];
  g.events.push(e);
  // Battles are classified at the end of their tick, against the settled troop total.
  if (!recipients && type !== 'battle') headline(g, e, { maxDevelopment: gameRules(g).maxDevelopment });
  return e;
}
/** Public headlines: one deterministic classification per PUBLIC event, shared by every client.
 * Stored beside the adjudication log (not inside events); `observe` and `worldFeed` attach it as
 * `event.headline`. Structured facts only: clients write the prose. Shared-battle casualties stay a
 * total, never per-country kills.
 * Major battle: casualties >= max(20, ceil(3% of all troops on the map at the end of that tick)).
 */
export const HEADLINES = Object.freeze({ battleFloor: 20, battleShare: .03 });
export const majorBattleThreshold = troops => Math.max(HEADLINES.battleFloor, Math.ceil(HEADLINES.battleShare * troops));
export const worldTroops = g => g.provinces.reduce((n, p) => n + p.troops, 0) + g.armies.reduce((n, a) => n + a.amount, 0);
export function classifyHeadline(e, context = {}) {
  if (e.recipients) return null;
  switch (e.type) {
    case 'war_declared': return { kind: 'war', from: [...e.fromRoster], to: [...e.toRoster] };
    case 'peace_accepted': return { kind: 'peace', from: [...e.fromRoster], to: [...e.toRoster] };
    case 'alliance_activated': return { kind: 'alliance', side: e.side, countries: [...e.roster] };
    case 'departed': return { kind: 'departure', country: e.country, side: e.formerSide };
    case 'coalition_dissolved': return { kind: 'dissolved', side: e.side };
    case 'eliminated': return { kind: 'eliminated', country: e.country };
    case 'dominance': return { kind: 'dominance', side: e.side, winsAt: e.winsAt };
    case 'finished': return { kind: 'finished', winningSide: e.winningSide, draw: e.draw, reason: e.reason };
    // Only the top tier: level II builds are routine and would bury the feed.
    case 'development_completed': return Number.isSafeInteger(context.maxDevelopment) && e.level >= context.maxDevelopment
      ? { kind: 'industry_up', province: e.province, country: e.country, level: e.level } : null;
    case 'battle': {
      if (!Number.isSafeInteger(context.worldTroops)) return null;
      const casualties = e.casualties, threshold = majorBattleThreshold(context.worldTroops);
      return casualties >= threshold ? { kind: 'major_battle', province: e.province, casualties,
        worldTroops: context.worldTroops, threshold, captured: e.owner !== e.previousOwner,
        owner: e.owner, previousOwner: e.previousOwner } : null;
    }
    default: return null;
  }
}
function headline(g, e, context) {
  const h = classifyHeadline(e, context);
  if (h) g.headlines[e.id] = h;
}
function identifier(g, prefix) { return `${prefix}${++g.serial}`; }
function alive(g, id) {
  const p = player(g, id); requireRule(p.eliminatedAt === null, 'Eliminated countries cannot do that.'); return p;
}
export function createGame({ id, name, hostId, speed = 1 }, map) {
  const rules = { ...structuredClone(RULES), ...map.rules };
  const positions = Object.fromEntries(map.provinces.map(p => [p.id, { x: p.x, y: p.y }]));
  const byId = new Map(map.provinces.map(p => [p.id, p]));
  const table = internal => Object.fromEntries(map.provinces.map(p => [p.id,
    Object.fromEntries(p.neighbors.map(id => [id, travelTicks(p, byId.get(id), rules, internal)]))]));
  return { scenario: map.id, rules, positions, travelTimes: table(false), internalTravelTimes: table(true),
    economy: { recruited: 0, invested: 0, casualties: 0 }, id, name: text(name, 'Room name'), hostId, speed,
    status: 'lobby', tick: 0, sequence: 0, serial: 0, players: [],
    provinces: map.provinces.map(p => ({ id: p.id, owner: null, troops: 2, nextRecruit: null, development: 1, developing: null })),
    armies: [], battles: [], orders: [], proposals: [], departures: [], coalitions: [], wars: [], peaceOffers: [], rallies: [],
    truces: [], peaceRetries: [], readCursors: {},
    events: [], headlines: {}, dominanceBreaks: [], receipts: {}, dominance: {}, outcome: null, actionLog: [] };
}
export function join(g, map, { profileId, name, country, kind = 'human', model = '', persona = '', visibility = 'private' }) {
  requireRule(g.status === 'lobby', 'Seats are closed after the match starts.', 409);
  requireRule(['human', 'agent', 'bot'].includes(kind), 'Unknown player kind.');
  requireRule(['public','private'].includes(visibility), 'Choose public or private agent visibility.');
  requireRule(kind !== 'human' || visibility === 'private', 'Human seats are private.');
  const existing = g.players.find(p => p.profileId === profileId);
  if (existing) { requireRule(existing.id === country, 'You already occupy another country.', 409); return existing; }
  const c = map.countries.find(c => c.id === country);
  requireRule(c, 'Choose a listed country.');
  const occupied = g.players.find(p => p.id === country);
  if (occupied && profileId === g.hostId && occupied.kind === 'bot' && kind === 'human') {
    Object.assign(occupied, { profileId, name: text(name, 'Player name', 40), kind, model: '', persona: '', visibility: 'private' });
    event(g, 'seat_claimed', { country, name: occupied.name });
    return occupied;
  }
  requireRule(!occupied, 'That country is taken. Choose a different unoccupied country.', 409);
  const p = { id: country, profileId, name: text(name, 'Player name', 40), kind,
    model: String(model).slice(0, 100), persona: String(persona).slice(0, 100), visibility,
    side: `solo:${country}:0`, joinedAt: 0, eliminatedAt: null, orderTicks: [], lastChat: null };
  g.players.push(p);
  for (const id of c.start) Object.assign(province(g, id), { owner: country, troops: c.garrisons?.[id] ?? c.startTroops ?? 10, development: c.development?.[id] ?? 1 });
  event(g, 'joined', { country, name: p.name, kind }); return p;
}
export function start(g) {
  requireRule(g.status === 'lobby', 'Match has already started.', 409);
  requireRule(g.players.length >= 2, 'At least two occupied countries are needed.');
  g.status = 'running';
  for (const p of g.provinces) if (p.owner) p.nextRecruit = gameRules(g).recruit;
  event(g, 'started', { countries: g.players.map(p => p.id), speed: g.speed });
  // Preserve the exact opening for public after-action reconstruction. Never exported.
  g.reviewOrigin = structuredClone(g);
}
function running(g) { requireRule(g.status === 'running', 'The match is not running.', 409); }
function mapProvince(map, id) { return map.provinces.find(p => p.id === id); }
/** Anti-spam only (10 orders per 10 s); humans never meet it in normal play. */
function checkBudget(g, p) {
  const r = gameRules(g);
  requireRule(p.orderTicks.filter(t => t > g.tick - r.orderWindow).length < r.orderLimit,
    'Too many orders at once; wait a moment.', 429);
}
function useBudget(g, p) {
  p.orderTicks = p.orderTicks.filter(t => t > g.tick - gameRules(g).orderWindow);
  p.orderTicks.push(g.tick);
}
const friendlyPath = (g, country, from, to) => sharedPath(g, country, from, to);
const marchSources = action => action.sources ?? [{ from: action.from,
  ...(action.amount !== undefined ? { amount: action.amount } : {}), ...(action.percent !== undefined ? { percent: action.percent } : {}) }];
/** Validate a march (one or more sources, one target) without mutating state or consuming budget.
 * Every column takes the quickest route through friendly land; all of them arrive on the same tick.
 * `assumeWar` (read-only plans) forecasts a target that still needs a declaration. */
export function marchPlan(g, map, country, action, { assumeWar = false } = {}) {
  alive(g, country); const r = gameRules(g);
  requireRule(typeof action.to === 'string', 'Choose a destination province.');
  const target = province(g, action.to);
  requireRule((action.from === undefined) !== (action.sources === undefined), 'Give either one source (from) or a list of sources.');
  const warRequired = !mayEnter(g, country, target.owner);
  const truce = warRequired ? truceUntil(g, country, target.owner) : null;
  requireRule(assumeWar || !warRequired, truce === null ? 'Declare war before attacking another country.' : truceMessage(target.owner, truce), 409,
    truce === null ? null : { truceUntil: truce });
  const inputs = marchSources(action);
  requireRule(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= r.maxSources,
    `Choose 1–${r.maxSources} source provinces.`);
  const unique = new Set();
  const sources = inputs.map(input => {
    requireRule(input && typeof input === 'object' && !Array.isArray(input), 'Invalid march source.');
    const source = province(g, input.from);
    requireRule(source.owner === country, 'You do not own the source province.', 403);
    requireRule(source.id !== target.id, 'Choose a different destination.');
    requireRule(!unique.has(source.id), 'Each source may appear only once.'); unique.add(source.id);
    const route = mapProvince(map, source.id).neighbors.includes(target.id)
      ? { path: [target.id], travel: journeyTicks(g, source.id, target.id, country) }
      : friendlyPath(g, country, source.id, target.id);
    requireRule(route, `No route from ${source.id} to ${target.id}: a march passes only through your own or allied provinces (not through battles) and may end one step beyond them. March to a nearer province, or ally with or conquer the land between.`);
    const available = Math.max(0, source.troops - reservedTroops(g, country, source.id) - 1);
    requireRule((input.amount !== undefined) !== (input.percent !== undefined), 'Supply exactly one of amount or percent per source.');
    if (input.percent !== undefined) requireRule(Number.isFinite(input.percent) && input.percent > 0 && input.percent <= 100,
      'Percentage must be greater than zero and at most 100.');
    // Percentages select currently uncommitted troops, never future recruitment.
    const amount = input.amount ?? Math.floor(available * input.percent / 100);
    requireRule(Number.isSafeInteger(amount) && amount > 0 && amount <= available,
      'Not enough uncommitted troops; leave one at home. A percentage must select at least one troop.');
    return { from: source.id, amount, available, travel: route.travel, path: route.path };
  });
  const arrivesAt = g.tick + 1 + Math.max(...sources.map(s => s.travel));
  const total = sources.reduce((n, s) => n + s.amount, 0);
  const defenseAtArrival = arrivalDefense(g, target, arrivesAt), hostile = !allied(g, country, target.owner);
  return { to: target.id, owner: target.owner, warRequired, ...(truce === null ? {} : { truceUntil: truce }), reinforcement: !hostile, arrivesAt, total,
    ...(hostile ? { combat: combatForecast(total, target.troops, target.development), defenseAtArrival,
      combatAtArrival: combatForecast(total, defenseAtArrival.total, target.development) } : {}),
    sources: sources.map(s => ({ ...s, executeAt: arrivesAt - s.travel })),
    warning: 'Checked again at departure. Waiting troops stay in their provinces and can be attacked; new orders, battles and diplomacy can change the forecast.' };
}
function march(g, map, p, action) {
  const plan = marchPlan(g, map, p.id, action); checkBudget(g, p);
  const groupId = identifier(g, 'march-');
  const orders = plan.sources.map(s => ({ id: identifier(g, 'order-'), groupId, country: p.id,
    type: 'march', from: s.from, to: plan.to, path: s.path, amount: s.amount, executeAt: s.executeAt, arrivesAt: plan.arrivesAt }));
  useBudget(g, p); g.orders.push(...orders);
  event(g, 'order_accepted', { country: p.id, groupId, orderId: orders[0].id, executeAt: orders[0].executeAt,
    arrivesAt: plan.arrivesAt, orders }, [p.id]);
  return { groupId, orderId: orders[0].id, executeAt: orders[0].executeAt, arrivesAt: plan.arrivesAt, orders };
}
/** Optional `declareWar: true` on a march: one atomic "declare war and march". The march is validated
 * as if the war already existed, then the ordinary declaration runs, then the ordinary reservation.
 * Any invalid part rejects the whole action before any state changes. Where no declaration is needed
 * (neutral, own or allied target, already at war) the flag is harmless and the march is unchanged. */
function marchWithWar(g, map, p, action) {
  const { declareWar: flag, type, ...order } = action;
  requireRule(flag === undefined || typeof flag === 'boolean', 'declareWar must be true or false.');
  alive(g, p.id);
  const owner = g.provinces.find(v => v.id === action.to)?.owner;
  if (!flag || !owner || mayEnter(g, p.id, owner)) return { ...march(g, map, p, order), ...(flag ? { warDeclared: false } : {}) };
  marchPlan(g, map, p.id, order, { assumeWar: true }); checkBudget(g, p);
  const war = declareWar(g, p, { country: owner });
  return { ...march(g, map, p, order), warDeclared: true, war };
}
function develop(g, p, action) {
  alive(g, p.id);
  const source = province(g, action.from), r = gameRules(g);
  requireRule(source.owner === p.id, 'You do not own this province.', 403);
  requireRule(source.development < r.maxDevelopment, 'Province is fully developed.');
  requireRule(!source.developing && !g.orders.some(o => o.type === 'develop' && o.from === source.id), 'Development is already underway.');
  const amount = r.developmentCosts[source.development];
  const free = Math.max(0, source.troops - reservedTroops(g, p.id, source.id) - 1);
  requireRule(free >= amount, `Developing ${source.id} to level ${source.development + 1} needs ${amount} free troops (one more stays home); it has ${free}. `
    + 'Wait for recruitment, rally troops there, or develop a province listed in readyDevelopments.', 400, { province: source.id, cost: amount, free });
  checkBudget(g, p); useBudget(g, p);
  const order = { id: identifier(g, 'order-'), type: 'develop', country: p.id, from: source.id, amount,
    level: source.development + 1, executeAt: g.tick + 1 };
  g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt, cost: amount, completesAt: order.executeAt + r.developmentTicks[source.development] };
}
/** Rally points: at each recruitment, a source province's new troops march to one of your own
 * provinces along the quickest path through your own or allied land, never into foreign land.
 * Rallies are private to their owner. */
export function rallyPlan(g, country, action) {
  alive(g, country); const r = gameRules(g);
  const sources = Array.isArray(action.from) ? action.from : [action.from];
  requireRule(sources.length > 0 && sources.length <= r.maxSources && sources.every(id => typeof id === 'string'),
    `Choose 1–${r.maxSources} source provinces.`);
  requireRule(new Set(sources).size === sources.length, 'Each source may appear only once.');
  for (const id of sources) requireRule(province(g, id).owner === country, 'You do not own the source province.', 403);
  if (action.to === null) {
    for (const id of sources) requireRule(g.rallies.some(x => x.from === id), `No rally point is set in ${id}.`, 409);
    return { to: null, sources: sources.map(from => ({ from })) };
  }
  requireRule(typeof action.to === 'string', 'Choose a rally province, or null to clear.');
  requireRule(province(g, action.to).owner === country, 'A rally point must be one of your own provinces.', 403);
  return { to: action.to, sources: sources.map(from => {
    requireRule(from !== action.to, 'A province cannot rally to itself.');
    const route = friendlyPath(g, country, from, action.to);
    requireRule(route, `No path from ${from} to ${action.to} through your or allied land.`, 409);
    return { from, ...route, arrivesAt: g.tick + 1 + route.travel };
  }), warning: 'New troops march at each recruitment. Troops already there stay.' };
}
function rally(g, p, action) {
  const plan = rallyPlan(g, p.id, action); checkBudget(g, p); useBudget(g, p);
  const order = { id: identifier(g, 'order-'), type: 'rally', country: p.id, sources: plan.sources.map(s => s.from),
    to: plan.to, executeAt: g.tick + 1 };
  g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt, ...plan };
}
function executeRally(g, o) {
  const lost = o.sources.filter(id => province(g, id).owner !== o.country);
  const error = lost.length ? `${lost.join(', ')} is no longer yours.` :
    o.to !== null && province(g, o.to).owner !== o.country ? 'The rally province is no longer yours.' : null;
  if (error) { event(g, 'order_failed', { country: o.country, orderId: o.id, reason: error }, [o.country]); return; }
  g.rallies = g.rallies.filter(x => !o.sources.includes(x.from));
  if (o.to !== null) {
    for (const from of o.sources) g.rallies.push({ country: o.country, from, to: o.to, status: 'active', since: g.tick });
    g.rallies.sort((a, b) => a.from.localeCompare(b.from));
  }
  event(g, o.to === null ? 'rally_cleared' : 'rally_set', { country: o.country, sources: o.sources, to: o.to,
    ...(o.to === null ? { reason: 'order' } : {}) }, [o.country]);
}
function rallyStatus(g, x, status, detail = {}) {
  if (x.status === status && x.reason === detail.reason) return;
  x.status = status; x.since = g.tick; delete x.reason; Object.assign(x, detail);
  event(g, status === 'active' ? 'rally_resumed' : 'rally_paused', { country: x.country, from: x.from, to: x.to, ...detail }, [x.country]);
}
/** At a source's recruitment: dispatch its new troops along the current quickest friendly path.
 * Pauses only when territory is lost: the rally province, or every friendly path to it. */
function dispatchRally(g, source, x, born, battle) {
  if (province(g, x.to).owner !== x.country) return rallyStatus(g, x, 'paused', { reason: 'destination_lost' });
  const send = Math.min(born, source.troops - reservedTroops(g, x.country, source.id) - 1);
  if (send < 1) return rallyStatus(g, x, 'active');
  const route = friendlyPath(g, x.country, source.id, x.to);
  if (!route) return rallyStatus(g, x, 'paused', { reason: 'no_path' });
  rallyStatus(g, x, 'active');
  source.troops -= send; if (battle) battle.defenderRouted += send;
  const army = departArmy(g, x.country, source.id, route.path, send, { rally: true });
  event(g, 'rally_dispatched', { country: x.country, armyId: army.id, from: source.id, to: x.to, amount: send,
    path: route.path, arrivesAt: g.tick + route.travel }, [x.country]);
}
const matchesRecall = (item, id) => item.id === id || item.groupId === id || item.orderId === id;
function recall(g, p, action) {
  alive(g, p.id);
  requireRule(typeof action.id === 'string' && action.id.length <= 80, 'Specify an army, queued order, or march group ID.');
  const items = [...g.orders.filter(o => o.type === 'march'), ...g.armies.filter(a => !a.returning)]
    .filter(item => matchesRecall(item, action.id));
  requireRule(items.length > 0, 'This order has already arrived, been cancelled, or is returning.', 409);
  requireRule(items.every(item => item.country === p.id), 'You cannot recall another country’s troops.', 403);
  requireRule(!g.orders.some(o => ['recall', 'turn_around'].includes(o.type) && o.target === action.id), 'Recall is already queued.', 409);
  checkBudget(g, p); useBudget(g, p);
  const order = { id: identifier(g, 'order-'), type: 'recall', country: p.id, target: action.id, executeAt: g.tick + 1 };
  g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt };
}
function executeRecall(g, order) {
  const selected = item => item.country === order.country && matchesRecall(item, order.target);
  const waiting = g.orders.filter(o => o.type === 'march' && selected(o));
  g.orders = g.orders.filter(o => o.type !== 'march' || !selected(o));
  let returned = 0;
  for (const a of g.armies.filter(a => !a.returning && selected(a))) { turnArmy(g, a, 'manual'); returned++; }
  event(g, waiting.length || returned ? 'recall_executed' : 'order_failed', {
    country: order.country, orderId: order.id, cancelled: waiting.length, returning: returned,
    ...(!waiting.length && !returned ? { reason: 'The selected troops are no longer recallable.' } : {}) }, [order.country]);
}
/** Ticks a moving army needs to get home if it turns back at `tick`: as long as it has been out
 * (a column or a resumed army measures from its first departure), never longer than a single leg. */
export function returnTicks(army, tick) {
  return Math.max(1, army.originDepartedAt !== undefined ? tick - army.originDepartedAt
    : Math.min(army.arrivesAt - army.departedAt, tick - army.departedAt));
}
/** Reverse a marching army from its actual position. `reason` is 'manual' for a player's recall;
 * automatic reasons add `province` (where it was heading) and cause-specific detail. The army
 * remembers where it was going (`resume`) so its owner can send it back ("march again"). */
function turnArmy(g,a,reason,detail={}) {
  const battle=g.battles.find(b=>b.province===a.to && a.engaged);
  if(battle)battle.withdrawn+=a.amount;
  const startPoint=journeyPoint(a,g.positions,g.tick),back=returnTicks(a,g.tick);
  const home=a.origin ?? a.from,heading=a.to;
  a.resume={to:heading,target:a.path?.at(-1) ?? heading,remaining:Math.max(0,a.arrivesAt-g.tick),turnedAt:g.tick};
  Object.assign(a,{from:a.to,to:home,startPoint,returning:true,engaged:false,departedAt:g.tick,arrivesAt:g.tick+back});
  delete a.path;delete a.pathIndex;delete a.origin;delete a.originDepartedAt;
  event(g,'army_recalled',{country:a.country,armyId:a.id,to:a.to,amount:a.amount,arrivesAt:a.arrivesAt,
    ...(reason==='manual'?{}:{reason,province:heading,...detail})});
}
/** Read-only check for turning one of your moving armies around at tick `at` (default: next tick,
 * when the order executes). An advancing army turns home (a recall). A returning army marches again
 * toward the target it had been heading for, from where it actually is: the time it has spent
 * coming back plus what it still had to go, then on along friendly land if the target was further. */
export function turnAroundPlan(g, country, armyId, at = g.tick + 1) {
  alive(g, country);
  requireRule(typeof armyId === 'string' && armyId.length > 0 && armyId.length <= 80, 'Specify an army ID.');
  const army = g.armies.find(a => a.id === armyId);
  requireRule(army, 'That army has already arrived or no longer exists.', 409);
  requireRule(army.country === country, 'You cannot turn another country’s troops around.', 403);
  requireRule(!army.engaged, 'That army is fighting; recall it to withdraw.', 409);
  if (!army.returning) return { armyId, mode: 'recall', to: army.origin ?? army.from, arrivesAt: at + returnTicks(army, at) };
  const limit = gameRules(g).maxTurnArounds;
  requireRule((army.turnArounds || 0) < limit, `An army can march again at most ${limit} times.`, 409);
  const { to, target } = army.resume;
  const onward = target === to ? null : friendlyPath(g, country, to, target);
  requireRule(target === to || onward, `No route from ${to} to ${target} through your or allied land.`, 409);
  if (target !== to) requireRule(allied(g, country, province(g, to).owner), `${to} is no longer friendly land to pass through.`, 409);
  const owner = province(g, target).owner;
  requireRule(mayEnter(g, country, owner), 'Declare war before attacking another country.', 409);
  const first = army.resume.remaining + (at - army.resume.turnedAt);
  const arrivesAt = at + first + (onward?.travel ?? 0);
  const battle = g.battles.find(b => b.province === target);
  return { armyId, mode: 'resume', to: target, via: to, owner, amount: army.amount, arrivesAt,
    turnArounds: (army.turnArounds || 0) + 1, limit,
    ...(battle && !allied(g, country, owner) ? { battleInProgress: { attackerSide: battle.attackerSide,
      joins: battle.attackerSide === player(g, country).side } } : {}),
    warning: 'Checked again when the order executes next tick. Ownership, wars and battles can change before arrival.' };
}
function turnAround(g, p, action) {
  const plan = turnAroundPlan(g, p.id, action.armyId);
  if (plan.mode === 'recall') return { mode: 'recall', ...recall(g, p, { id: action.armyId }) };
  requireRule(!g.orders.some(o => ['recall', 'turn_around'].includes(o.type) && o.target === action.armyId),
    'A turn-around is already queued for this army.', 409);
  checkBudget(g, p); useBudget(g, p);
  const order = { id: identifier(g, 'order-'), type: 'turn_around', country: p.id, target: action.armyId, executeAt: g.tick + 1 };
  g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { mode: 'resume', orderId: order.id, executeAt: order.executeAt, to: plan.to, arrivesAt: plan.arrivesAt };
}
function executeTurnAround(g, order) {
  let plan;
  try { plan = turnAroundPlan(g, order.country, order.target, g.tick); }
  catch (error) {
    if (!(error instanceof RuleError)) throw error;
    event(g, 'order_failed', { country: order.country, orderId: order.id, reason: error.message }, [order.country]); return;
  }
  if (plan.mode !== 'resume') {
    event(g, 'order_failed', { country: order.country, orderId: order.id, reason: 'The army is already heading for its target.' }, [order.country]); return;
  }
  const a = g.armies.find(x => x.id === order.target), home = a.to;
  const startPoint = journeyPoint(a, g.positions, g.tick), out = Math.max(0, a.arrivesAt - g.tick);
  const onward = plan.to === plan.via ? null : friendlyPath(g, a.country, plan.via, plan.to);
  delete a.returning; delete a.resume;
  Object.assign(a, { from: home, to: plan.via, startPoint, departedAt: g.tick, origin: home, originDepartedAt: g.tick - out,
    arrivesAt: g.tick + (plan.arrivesAt - g.tick - (onward?.travel ?? 0)), turnArounds: plan.turnArounds,
    ...(onward ? { path: [plan.via, ...onward.path], pathIndex: 0 } : {}) });
  event(g, 'army_turned_around', { country: a.country, armyId: a.id, from: home, to: plan.to, amount: a.amount, arrivesAt: plan.arrivesAt });
}
/** Why an arriving, non-allied army that did not join the attack is turned back. */
function refusal(g,army,target,battle,chosen) {
  if(!mayEnter(g,army.country,target.owner))return {reason:'no_war',owner:target.owner};
  if(battle && battle.attackerSide!==player(g,army.country).side)
    return {reason:'battle_in_progress',battleAttackerSide:battle.attackerSide,owner:target.owner};
  // Two sides reached the same province on the same tick; the stronger arrival has first claim.
  return {reason:'rival_arrival',rivalSide:chosen,owner:target.owner};
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
  q.status = 'pending'; q.activateAt = g.tick + gameRules(g).notice;
  event(g, 'alliance_notice', { proposalId: q.id, name: q.name, roster: q.roster, activateAt: q.activateAt });
}
function propose(g, p, a) {
  alive(g, p.id); const candidate = alive(g, a.country);
  requireRule(candidate.id !== p.id, 'Choose another country.');
  requireRule(candidate.side.startsWith('solo:'), 'The candidate must first leave their current alliance.');
  requireRule(!locked(g, candidate.id) && !locked(g, p.id), 'Membership change already pending.', 409);
  requireRule(g.proposals.filter(q => q.status === 'open' && q.creator === p.id).length < 3,
    'At most three outstanding offers per country.', 429);
  const coalition = p.side.startsWith('solo:') ? null : p.side;
  const roster = [...members(g, p.side).map(m => m.id), candidate.id];
  requireRule(roster.length <= maxAlliance(g), maxAlliance(g) < 2
    ? 'Alliances need at least four countries in the match.'
    : `An alliance can include at most ${maxAlliance(g)} countries (half the match).`, 409);
  const q = { id: identifier(g, 'offer-'), creator: p.id, candidate: candidate.id, coalition, roster,
    name: coalition ? g.coalitions.find(c => c.id === coalition).name : text(a.name || 'The Accord', 'Alliance name', 40),
    signature: signature(g, roster), accepted: [p.id], status: 'open', expiresAt: g.tick + gameRules(g).proposalLife };
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
  const departure = { country: p.id, side: p.side, activateAt: g.tick + gameRules(g).notice };
  g.departures.push(departure); event(g, 'departure_notice', departure);
  return departure;
}
function normalizeWars(g) {
  const pairs=new Set(g.wars), teams=[...new Set(g.players.map(p=>p.side))];
  const expanded=new Set();
  for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++) {
    const left=sideRoster(g,teams[i]),right=sideRoster(g,teams[j]);
    if(left.some(a=>right.some(b=>pairs.has(warKey(a,b)))))
      for(const a of left)for(const b of right)expanded.add(warKey(a,b));
  }
  g.wars=[...expanded].sort();
}
/** Any member speaks for its alliance: both whole sides are at war at once. */
function declareWar(g, p, a) {
  alive(g, p.id); const target = alive(g, a.country);
  requireRule(!allied(g, p.id, target.id), 'Choose a country outside your alliance.');
  requireRule(!atWar(g, p.id, target.id), 'These sides are already at war.', 409);
  const truce = truceUntil(g, p.id, target.id);
  requireRule(truce === null, truceMessage(target.id, truce), 409, { truceUntil: truce });
  const fromRoster = sideRoster(g, p.side), toRoster = sideRoster(g, target.side);
  for (const x of fromRoster) for (const y of toRoster) g.wars.push(warKey(x, y));
  g.wars = [...new Set(g.wars)].sort();
  event(g, 'war_declared', { country: p.id, from: p.side, to: target.side, fromRoster, toRoster });
  return { from: p.side, to: target.side, fromRoster, toRoster };
}
const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const truceMessage = (country, until) =>
  `Truce with ${country} until ${clock(until)} (tick ${until}): no war can be declared between your sides before then.`;
const openOffer = (g, a, b) => g.peaceOffers.find(o => o.status === 'offered' &&
  (o.fromSide === a && o.toSide === b || o.fromSide === b && o.toSide === a));
function offerPeace(g, p, a) {
  alive(g, p.id); const target = alive(g, a.country);
  requireRule(atWar(g, p.id, target.id), 'These sides are not at war.', 409);
  requireRule(!openOffer(g, p.side, target.side), 'A peace offer between these sides is already open.', 409);
  const retry = g.peaceRetries.find(x => x.fromSide === p.side && x.toSide === target.side && x.until > g.tick);
  requireRule(!retry, `Your side's last peace offer to ${target.id} went unanswered; you can offer again at ${clock(retry?.until)} (tick ${retry?.until}). Message them meanwhile.`,
    429, retry ? { retryAt: retry.until } : null);
  const offer = { id: identifier(g, 'peace-'), status: 'offered', by: p.id, fromSide: p.side, toSide: target.side,
    fromRoster: sideRoster(g, p.side), toRoster: sideRoster(g, target.side), expiresAt: g.tick + gameRules(g).peaceLife };
  g.peaceOffers.push(offer);
  event(g, 'peace_offered', { offerId: offer.id, by: p.id, from: offer.fromSide, to: offer.toSide,
    fromRoster: offer.fromRoster, toRoster: offer.toRoster, expiresAt: offer.expiresAt }, [...offer.fromRoster, ...offer.toRoster]);
  return { offerId: offer.id, expiresAt: offer.expiresAt };
}
const sameRosters = (g, o) => same(sideRoster(g, o.fromSide), o.fromRoster) && same(sideRoster(g, o.toSide), o.toRoster);
function acceptPeace(g, p, a) {
  alive(g, p.id);
  const offer = g.peaceOffers.find(o => o.id === a.offerId);
  requireRule(offer && offer.status === 'offered' && g.tick < offer.expiresAt, 'This peace offer is no longer open.', 409);
  requireRule(p.side === offer.toSide, 'Only the side receiving the offer can accept it.', 403);
  requireRule(sameRosters(g, offer), 'Alliance membership changed; offer peace again.', 409);
  const left = new Set(offer.fromRoster), right = new Set(offer.toRoster);
  const across = (country, id) => left.has(country) && right.has(province(g, id).owner) || right.has(country) && left.has(province(g, id).owner);
  g.wars = g.wars.filter(pair => { const [x, y] = pair.split(':'); return !(left.has(x) && right.has(y) || left.has(y) && right.has(x)); });
  offer.status = 'accepted';
  // The truce binds both whole sides as they are now, pair by pair (joining later does not lift it).
  const until = g.tick + gameRules(g).truce;
  for (const x of offer.fromRoster) for (const y of offer.toRoster) {
    const countries = [x, y].sort(), existing = g.truces.find(t => t.countries[0] === countries[0] && t.countries[1] === countries[1]);
    if (existing) Object.assign(existing, { since: g.tick, until }); else g.truces.push({ countries, since: g.tick, until });
  }
  g.truces.sort((a, b) => a.countries.join(':').localeCompare(b.countries.join(':')));
  const cancelled = g.orders.filter(o => o.type === 'march' && across(o.country, o.to));
  g.orders = g.orders.filter(o => !cancelled.includes(o));
  for (const o of cancelled) event(g, 'order_cancelled', { country: o.country, orderId: o.id, reason: 'Peace treaty.' }, [o.country]);
  let recalled = 0;
  for (const army of g.armies) if (!army.returning && across(army.country, army.path?.at(-1) || army.to)) {
    turnArmy(g, army, 'peace', { owner: province(g, army.path?.at(-1) || army.to).owner }); recalled++;
  }
  event(g, 'peace_accepted', { offerId: offer.id, country: p.id, from: offer.fromSide, to: offer.toSide,
    fromRoster: offer.fromRoster, toRoster: offer.toRoster, cancelled: cancelled.length, recalled, truceUntil: until });
  return { offerId: offer.id, status: offer.status, truceUntil: until };
}
function chat(g, p, a) {
  const message = text(a.text, 'Message', gameRules(g).messageLength);
  requireRule(p.lastChat === null || g.tick - p.lastChat >= gameRules(g).chatWindow, 'Too many messages at once; wait a moment.', 429);
  requireRule(['world', 'alliance', 'dm'].includes(a.channel), 'Choose world, alliance, or dm.');
  let recipients = null;
  if (a.channel === 'alliance') {
    requireRule(!p.side.startsWith('solo:'), 'You are not in an alliance.');
    recipients = members(g, p.side).map(p => p.id);
  } else if (a.channel === 'dm') {
    player(g, a.to); recipients = [...new Set([p.id, a.to])];
  }
  p.lastChat = g.tick;
  const publicAgent = id => { const actor=player(g,id);return actor.kind!=='human' && actor.visibility==='public'; };
  const archiveEligible = publicAgent(p.id) && (a.channel==='world' ||
    a.channel==='dm' && publicAgent(a.to) ||
    a.channel==='alliance' && members(g,p.side).every(member=>publicAgent(member.id)));
  const e = event(g, 'message', { from: p.id, channel: a.channel, to: a.channel === 'dm' ? a.to : null,
    text: message, untrusted: true,
    ...(archiveEligible ? {archiveEligible:true,side:a.channel==='alliance'?p.side:null} : {}) }, recipients);
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
    case 'march': result = marchWithWar(g, map, p, action); break;
    case 'rally': result = rally(g, p, action); break;
    case 'recall': result = recall(g, p, action); break;
    case 'turn_around': result = turnAround(g, p, action); break;
    case 'develop': result = develop(g, p, action); break;
    case 'propose': result = propose(g, p, action); break;
    case 'accept': result = accept(g, p, action); break;
    case 'decline': result = decline(g, p, action); break;
    case 'leave': result = leave(g, p); break;
    case 'declare_war': result = declareWar(g, p, action); break;
    case 'offer_peace': result = offerPeace(g, p, action); break;
    case 'accept_peace': result = acceptPeace(g, p, action); break;
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
  normalizeWars(g);
}
function expirePeace(g) {
  for (const offer of g.peaceOffers) if (offer.status === 'offered') {
    const reason = !sameRosters(g, offer) ? 'Alliance membership changed.' :
      !atWar(g, offer.fromRoster[0], offer.toRoster[0]) ? 'The sides are no longer at war.' :
      g.tick >= offer.expiresAt ? 'The peace offer expired.' : null;
    if (reason === 'The peace offer expired.') g.peaceRetries.push({ fromSide: offer.fromSide, toSide: offer.toSide, until: g.tick + gameRules(g).peaceRetry });
    if (reason) { offer.status = 'expired';
      event(g, 'peace_expired', { offerId: offer.id, reason }, [...new Set([...offer.fromRoster, ...offer.toRoster])]); }
  }
  g.peaceOffers = g.peaceOffers.filter(o => o.status === 'offered');
  g.truces = g.truces.filter(t => t.until > g.tick);
  g.peaceRetries = g.peaceRetries.filter(x => x.until > g.tick);
}
/** Put an army on the road along `path` (the provinces after `from`). A march order's single-leg army
 * keeps its scheduled arrival; a multi-leg column (or a rally) recomputes each leg as it goes. */
function departArmy(g, country, from, path, amount, { order = null, rally = false } = {}) {
  const to = path[0], column = path.length > 1 || rally;
  const arrivesAt = !column && order?.arrivesAt ? order.arrivesAt : g.tick + journeyTicks(g, from, to, country);
  const army = { id: identifier(g, 'army-'), country, from, to, amount, departedAt: g.tick, arrivesAt,
    ...(order ? { orderId: order.id, groupId: order.groupId } : {}),
    ...(column ? { path: [...path], pathIndex: 0, origin: from, originDepartedAt: g.tick, ...(rally ? { rally: true } : {}) } : {}) };
  g.armies.push(army);
  if (!rally) event(g, 'army_departed', { country, from, to: path.at(-1), amount, arrivesAt: order?.arrivesAt ?? arrivesAt });
  return army;
}
function executeOrders(g) {
  // Cancellation received before the arrival/departure tick wins that boundary.
  // No troop is refunded instantly if it has already left its garrison.
  // Recalls and turn-arounds run in submission order before any departure or arrival.
  for (const o of g.orders.filter(o => ['recall', 'turn_around'].includes(o.type) && o.executeAt <= g.tick))
    if (o.type === 'recall') executeRecall(g, o); else executeTurnAround(g, o);
  for (const o of g.orders.filter(o => !['recall', 'turn_around'].includes(o.type) && o.executeAt <= g.tick)) {
    if (o.type === 'rally') { executeRally(g, o); continue; }
    const source = province(g, o.from);
    let error = source.owner !== o.country ? 'Source is no longer yours.' : o.amount >= source.troops ? 'Not enough troops remain.' : null;
    if (!error && o.type === 'march') {
      if (!mayEnter(g, o.country, province(g, o.to).owner)) error = 'War ended before departure.';
      else if (o.path.slice(0, -1).some(id => !allied(g, o.country, province(g, id).owner))) {
        // The way changed hands while this source waited: take the quickest friendly way now, if any.
        const route = friendlyPath(g, o.country, o.from, o.to);
        if (route) o.path = route.path; else error = 'No route through your or allied land any more.';
      }
    }
    if (!error && o.type === 'develop' && (source.developing || source.development !== o.level - 1)) error = 'Development state changed.';
    if (error) { event(g, 'order_failed', { country: o.country, orderId: o.id, reason: error }, [o.country]); continue; }
    source.troops -= o.amount;
    if (o.type === 'develop') {
      g.economy.invested += o.amount;
      source.developing = { level: o.level, completesAt: g.tick + gameRules(g).developmentTicks[source.development] };
      event(g, 'development_started', { country: o.country, province: source.id, cost: o.amount, ...source.developing });
    } else departArmy(g, o.country, o.from, o.path, o.amount, { order: o });
    event(g, 'order_executed', { country: o.country, orderId: o.id }, [o.country]);
  }
  g.orders = g.orders.filter(o => o.executeAt > g.tick);
}
function hashChance(value) {
  let hash=2166136261;
  for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
  hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);
  hash^=hash>>>15;hash=Math.imul(hash,0x846ca68b);
  hash^=hash>>>16;
  return (hash>>>0)/4294967296;
}
function die(g,battle,index) { return 1+Math.floor(hashChance(`${g.id}:${battle.id}:${g.tick}:${index}`)*6); }
function resolveArrivals(g) {
  const due=g.armies.filter(a=>!a.engaged && a.arrivesAt<=g.tick);
  g.armies=g.armies.filter(a=>a.engaged || a.arrivesAt>g.tick);
  const byTarget=new Map();
  for(const army of due){const list=byTarget.get(army.to)||[];list.push(army);byTarget.set(army.to,list);}
  for(const target of g.provinces) {
    const arriving=[];
    for(const army of byTarget.get(target.id)||[]) {
      if(army.path && !army.returning && army.pathIndex<army.path.length-1) {
        // A column passes only through friendly land that is not a battlefield.
        const passable=id=>allied(g,army.country,province(g,id).owner) && !g.battles.some(b=>b.province===id);
        const rest=army.path.slice(army.pathIndex+1),goal=army.path.at(-1);
        // Re-checked leg by leg: when the planned way is no longer friendly, take the quickest friendly way from here.
        const reroute=passable(target.id) && !rest.slice(0,-1).every(passable) ? friendlyPath(g,army.country,target.id,goal) : null;
        if(passable(target.id) && (rest.slice(0,-1).every(passable) || reroute)) {
          if(reroute){army.path=[...army.path.slice(0,army.pathIndex+1),...reroute.path];
            event(g,'army_rerouted',{country:army.country,armyId:army.id,province:target.id,to:goal,path:reroute.path},[army.country]);}
          army.from=target.id;army.pathIndex++;army.to=army.path[army.pathIndex];
          army.departedAt=g.tick;army.arrivesAt=g.tick+journeyTicks(g,army.from,army.to,army.country);
          g.armies.push(army);event(g,'army_transited',{country:army.country,province:target.id,to:army.to,amount:army.amount});
        } else {turnArmy(g,army,'transit_blocked',{owner:target.owner,
          ...(passable(target.id)?{noRoute:true}:allied(g,army.country,target.owner)?{battleAttackerSide:g.battles.find(b=>b.province===target.id).attackerSide}:{})});g.armies.push(army);}
      } else if(army.rally && !army.returning && !allied(g,army.country,target.owner)) {
        // A rally column only reinforces; it never attacks the land it was sent to hold.
        turnArmy(g,army,'rally_blocked',{owner:target.owner});g.armies.push(army);
      } else arriving.push(army);
    }
    if(!arriving.length)continue;
    let battle=g.battles.find(b=>b.province===target.id);
    const defenderSide=target.owner?player(g,target.owner).side:null;
    const groups=new Map();
    for(const army of arriving)if(!target.owner || !allied(g,army.country,target.owner)) {
      const side=player(g,army.country).side,list=groups.get(side)||[];list.push(army);groups.set(side,list);
    }
    const chosen=battle?.attackerSide || [...groups].sort((a,b)=>
      b[1].reduce((n,x)=>n+x.amount,0)-a[1].reduce((n,x)=>n+x.amount,0) || a[0].localeCompare(b[0]))[0]?.[0];
    let reinforced=0;
    for(const army of arriving) {
      if(target.owner && allied(g,army.country,target.owner)) {
        target.troops+=army.amount;reinforced+=army.amount;
        if(battle)battle.arrivals.push({country:army.country,amount:army.amount});
      } else if(player(g,army.country).side===chosen && mayEnter(g,army.country,target.owner)) {
        if(!battle){battle={id:identifier(g,'battle-'),province:target.id,startedAt:g.tick,
          attackerSide:chosen,previousOwner:target.owner,before:target.troops,arrivals:[],
          defenderRecruited:0,defenderRouted:0,withdrawn:0,engaged:0,casualties:0,lastRound:null};
          g.battles.push(battle);event(g,'battle_started',{battleId:battle.id,province:target.id,
            attackerSide:chosen,defenderSide,startedAt:g.tick});}
        army.engaged=true;g.armies.push(army);battle.arrivals.push({country:army.country,amount:army.amount});battle.engaged+=army.amount;
      } else if(army.returning)event(g,'army_interned',{country:army.country,armyId:army.id,province:target.id,amount:army.amount});
      else {const {reason,...detail}=refusal(g,army,target,battle,chosen);turnArmy(g,army,reason,detail);g.armies.push(army);}
    }
    if(reinforced)event(g,'reinforced',{province:target.id,owner:target.owner,troops:target.troops,amount:reinforced});
  }
}
function resolveBattleRounds(g) {
  for(const battle of [...g.battles]) {
    if(battle.startedAt>=g.tick)continue;
    const target=province(g,battle.province);
    const attackers=g.armies.filter(a=>a.engaged && a.to===target.id);
    for(const army of attackers)if(target.owner && !atWar(g,army.country,target.owner))
      turnArmy(g,army,'no_war',{owner:target.owner,...(allied(g,army.country,target.owner)?{allied:true}:{})});
    const fighting=attackers.filter(a=>a.engaged),strength=()=>fighting.reduce((n,a)=>n+a.amount,0);
    let attackerLoss=0,defenderLoss=0,attackDice=[],defendDice=[];
    // battleSlowdownPercent 125 = one round per 1.25 ticks (4 rounds per 5 ticks), same dice per round.
    const slow=gameRules(g).battleSlowdownPercent,elapsed=g.tick-battle.startedAt;
    const roundDue=Math.floor(elapsed*100/slow)>Math.floor((elapsed-1)*100/slow);
    if(roundDue && strength()>0 && target.troops>0) {
      attackDice=Array.from({length:Math.min(3,strength())},(_,i)=>die(g,battle,i)).sort((a,b)=>b-a);
      defendDice=Array.from({length:Math.min(2,target.troops)},(_,i)=>die(g,battle,3+i)).sort((a,b)=>b-a);
      defendDice[0]=Math.min(6,defendDice[0]+Math.floor(target.development/2));
      for(let i=0;i<Math.min(attackDice.length,defendDice.length);i++){
        if(attackDice[i]>defendDice[i])defenderLoss++;else attackerLoss++;
      }
      target.troops-=defenderLoss;
      for(const army of fighting.sort((a,b)=>b.amount-a.amount || a.id.localeCompare(b.id))){
        const lost=Math.min(army.amount,attackerLoss);army.amount-=lost;attackerLoss-=lost;if(!attackerLoss)break;
      }
      const casualties=Math.min(attackDice.length,defendDice.length);
      battle.casualties+=casualties;g.economy.casualties+=casualties;
      g.armies=g.armies.filter(a=>a.amount>0);
    }
    if(roundDue){
      battle.lastRound={tick:g.tick,attackDice,defendDice,attackerLoss:Math.min(attackDice.length,defendDice.length)-defenderLoss,defenderLoss};
      (battle.rounds ||= []).push({...battle.lastRound,attackers:strength(),defenders:target.troops});
      if(battle.rounds.length>40)battle.rounds.shift();
    }
    const survivors=g.armies.filter(a=>a.engaged && a.to===target.id);
    if(survivors.length && target.troops>0)continue;
    if(survivors.length && target.troops===0) {
      // Largest surviving contingent takes the province; ties rotate by tick so no seat is favoured.
      const rotated=g.players.map(p=>p.id).sort(),n=g.tick%rotated.length;
      const priority=[...rotated.slice(n),...rotated.slice(0,n)];
      const byCountry=new Map();for(const a of survivors)byCountry.set(a.country,(byCountry.get(a.country)||0)+a.amount);
      target.owner=[...byCountry].sort((a,b)=>b[1]-a[1] || priority.indexOf(a[0])-priority.indexOf(b[0]))[0][0];
      target.troops=survivors.reduce((n,a)=>n+a.amount,0);
      g.armies=g.armies.filter(a=>!survivors.includes(a));
      target.nextRecruit=g.tick+gameRules(g).recruit;
      if(target.developing){event(g,'development_cancelled',{province:target.id,reason:'Captured; unfinished investment is lost.'});target.developing=null;}
    }
    g.battles=g.battles.filter(b=>b!==battle);
    event(g,'battle',{province:target.id,previousOwner:battle.previousOwner,owner:target.owner,before:battle.before,
      defenderRecruited:battle.defenderRecruited,defenderRouted:battle.defenderRouted,withdrawn:battle.withdrawn,troops:target.troops,
      arrivals:battle.arrivals,duration:g.tick-battle.startedAt,casualties:battle.casualties});
  }
}
function recruit(g) {
  for (const x of [...g.rallies]) if (province(g, x.from).owner !== x.country) {
    g.rallies = g.rallies.filter(y => y !== x);
    event(g, 'rally_cleared', { country: x.country, sources: [x.from], to: x.to, reason: 'source_lost' }, [x.country]);
  }
  for (const p of g.provinces) {
    if (p.developing?.completesAt <= g.tick) {
      p.development = p.developing.level; p.developing = null;
      event(g, 'development_completed', { province: p.id, country: p.owner, level: p.development });
    }
    if (!p.owner || p.nextRecruit > g.tick) continue;
    const born = p.development;
    p.troops += born; p.nextRecruit = g.tick + gameRules(g).recruit;
    const battle=g.battles.find(b=>b.province===p.id);
    if(battle)battle.defenderRecruited+=born;
    g.economy.recruited += born;
    const standing = g.rallies.find(x => x.from === p.id);
    if (standing) dispatchRally(g, p, standing, born, battle);
  }
}
export function sides(g) {
  return [...new Set(g.players.map(p => p.side))].map(id => ({ id,
    name: g.coalitions.find(c => c.id === id)?.name || members(g, id)[0]?.id,
    members: members(g, id).map(p => p.id),
    provinces: g.provinces.filter(v => v.owner && player(g, v.owner).side === id).length,
    economy: g.provinces.filter(v => v.owner && player(g, v.owner).side === id)
      .reduce((n, v) => n + v.development, 0),
    dominanceStartedAt: g.dominance[id] ?? null }));
}
export const economyThreshold = g => Math.ceil(g.provinces.filter(p => p.owner)
  .reduce((n, p) => n + p.development, 0) * gameRules(g).economyShare);
const ownedIndustry = (g, country) => g.provinces.filter(v => v.owner === country)
  .reduce((n, v) => n + v.development, 0);
/** One result per player: everyone on the winning side wins; a draw is a draw. `industry` (your own
 * industry at the end) is the score: bragging rights and the order within a side. */
export function score(g, winningSide, draw) {
  return g.players.map(p => ({ country: p.id, result: draw ? 'draw' : p.side === winningSide ? 'win' : 'loss',
    industry: ownedIndustry(g, p.id) }));
}
function finish(g, winningSide, reason) {
  g.status = 'finished';
  g.outcome = { winningSide, reason, tick: g.tick, draw: winningSide === null,
    scores: score(g, winningSide, winningSide === null) };
  event(g, 'finished', g.outcome);
}
function victory(g) {
  const teams = sides(g);
  const threshold = economyThreshold(g);
  for (const p of g.players) if (p.eliminatedAt === null &&
    !g.provinces.some(v => v.owner === p.id) && !g.armies.some(a => a.country === p.id)) {
    p.eliminatedAt = g.tick; event(g, 'eliminated', { country: p.id });
  }
  for (const t of teams) {
    if (t.economy < threshold) { delete g.dominance[t.id]; continue; }
    if (g.dominance[t.id] === undefined) { g.dominance[t.id] = g.tick; event(g, 'dominance', { side: t.id, winsAt: g.tick + gameRules(g).hold }); }
    if (g.tick - g.dominance[t.id] >= gameRules(g).hold) { finish(g, t.id, 'domination'); return; }
  }
  if (g.tick >= gameRules(g).duration) {
    const ranked = teams.sort((a,b) => b.economy-a.economy);
    finish(g, ranked[0].economy > ranked[1].economy ? ranked[0].id : null, 'deadline');
  }
}
export function tick(g) {
  if (g.status !== 'running') return;
  const before = { ...g.dominance }, affiliations = new Map(g.players.map(p => [p.id, p.side]));
  g.tick++; const firstEvent = g.events.length;
  applyMembership(g); expirePeace(g); executeOrders(g); resolveArrivals(g); resolveBattleRounds(g); recruit(g); victory(g);
  const battles = g.events.slice(firstEvent).filter(e => e.type === 'battle' && !e.recipients);
  if (battles.length) { const troops = worldTroops(g); for (const e of battles) headline(g, e, { worldTroops: troops }); }
  // A stopped victory hold is public feedback kept beside the event log.
  for (const [side, since] of Object.entries(before)) if (g.dominance[side] !== since) {
    const changed = g.players.some(p => (affiliations.get(p.id) === side) !== (p.side === side));
    const team = sides(g).find(s => s.id === side);
    // Feed position: directly after this tick's last event. Structured headline for every client.
    g.dominanceBreaks.push({ tick: g.tick, side, seq: g.sequence, headline: { kind: 'dominance_broken', side,
      cause: changed ? 'membership' : 'economy', economy: team?.economy ?? 0, threshold: economyThreshold(g) } });
    g.dominanceBreaks = g.dominanceBreaks.slice(-20);
  }
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
  const events = visible.slice(0, limit).map(({ recipients, ...e }) => g.headlines[e.id] ? { ...e, headline: g.headlines[e.id] } : e);
  return { id: g.id, name: g.name, status: g.status, tick: g.tick, speed: g.speed, rules: gameRules(g), scenario: g.scenario,
    travelTimes: g.travelTimes, internalTravelTimes: g.internalTravelTimes, maxAlliance: maxAlliance(g),
    you: country, players: g.players.map(({ profileId, orderTicks, lastChat, ...p }) => ({...p,displayName:displayName(p)})),
    provinces: g.provinces, armies: g.armies, battles: g.battles,
    rallies: g.rallies.filter(x => x.country === country), sides: sides(g), wars: g.wars, truces: g.truces, economyThreshold: economyThreshold(g),
    dominanceBreaks: g.dominanceBreaks,
    peaceOffers: g.peaceOffers.filter(o => o.status === 'offered' && (o.fromRoster.includes(country) || o.toRoster.includes(country))),
    proposals: g.proposals.filter(q => q.status === 'pending' || q.status === 'open' && q.roster.includes(country))
      .map(({ signature, ...q }) => q), departures: g.departures, dominance: g.dominance,
    orders: country ? g.orders.filter(o => o.country === country) : [],
    events, cursor: hasMore ? events.at(-1).id : g.sequence, hasMore, outcome: g.outcome };
}

const firstAfter = (g, after) => {
  let lo = 0, hi = g.events.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1;
    if (g.events[mid].id <= after) lo = mid + 1; else hi = mid; }
  return lo;
};
/** A seat's inbox: unread DMs and alliance messages delivered to it (the same recipient filter as
 * `observe`: addressed to that seat at send time, never its own), plus the decisions waiting on it
 * (alliance offers it has not accepted, peace offers to its side). Read-only.
 * Unread = after the seat's read cursor (`readThrough`, an event ID), which moves only through
 * `markRead`. `newest` shows the latest `limit` messages (`older` counts the rest); otherwise the
 * oldest `limit` (`more` counts the rest), so a reader that marks through the last one shown loses nothing. */
export function inbox(g, country, { limit = 5, newest = true } = {}) {
  player(g, country);
  const readThrough = g.readCursors[country] ?? 0, unread = [];
  for (let i = firstAfter(g, readThrough); i < g.events.length; i++) {
    const e = g.events[i];
    if (e.type === 'message' && e.recipients?.includes(country) && e.from !== country) unread.push(e);
  }
  const shown = limit <= 0 ? [] : newest ? unread.slice(-limit) : unread.slice(0, limit);
  const side = player(g, country).side;
  const needsDecision = [
    ...g.proposals.filter(q => q.status === 'open' && q.roster.includes(country) && !q.accepted.includes(country))
      .map(q => ({ kind: 'alliance_offer', proposalId: q.id, from: q.creator, name: q.name, roster: q.roster, expiresAt: q.expiresAt })),
    ...g.peaceOffers.filter(o => o.status === 'offered' && o.toSide === side)
      .map(o => ({ kind: 'peace_offer', offerId: o.id, from: o.by, fromRoster: o.fromRoster, expiresAt: o.expiresAt }))];
  const from = {};
  for (const e of unread) from[e.from] = (from[e.from] || 0) + 1;
  return { readThrough, unread: unread.length, from,
    messages: shown.map(e => ({ id: e.id, tick: e.tick, from: e.from, channel: e.channel, text: e.text, untrusted: true })),
    ...(unread.length > shown.length ? { [newest ? 'older' : 'more']: unread.length - shown.length } : {}), needsDecision };
}
/** Move a seat's read cursor forward to `through` (never back, never past the log). With `after`,
 * the reader saw only events after that cursor: the move happens only when nothing unread lies
 * before it (after <= readThrough), so skipping ahead never marks unseen messages read. */
export function markRead(g, country, through, after = null) {
  player(g, country);
  requireRule(Number.isSafeInteger(through) && through >= 0, 'Invalid read cursor.');
  requireRule(after === null || Number.isSafeInteger(after) && after >= 0, 'Invalid event cursor.');
  const current = g.readCursors[country] ?? 0;
  if (after === null || after <= current) g.readCursors[country] = Math.max(current, Math.min(through, g.sequence));
  return g.readCursors[country] ?? 0;
}
/** One short line for order results when something waits for this seat, else null. */
export function attention(g, country) {
  const box = inbox(g, country, { limit: 0 }), parts = [];
  if (box.unread) parts.push(`${box.unread} unread message${box.unread === 1 ? '' : 's'} (${Object.entries(box.from)
    .map(([id, n]) => n > 1 ? `${id} ×${n}` : id).join(', ')}): read inbox`);
  for (const d of box.needsDecision) parts.push(d.kind === 'alliance_offer'
    ? `Alliance offer from ${d.from} awaiting your answer (${d.proposalId})` : `Peace offer from ${d.from} awaiting your answer (${d.offerId})`);
  return parts.length ? parts.join('; ') : null;
}

/** Public World feed: world-channel chat plus headlines, oldest first, with its own cursor.
 * Identical for players, spectators and agents; never includes alliance or direct messages. */
export function worldFeed(g, after = 0, limit = 100) {
  requireRule(Number.isSafeInteger(after) && after >= 0, 'Invalid feed cursor.');
  requireRule(Number.isSafeInteger(limit) && limit > 0 && limit <= 500, 'Invalid feed limit.');
  let lo = 0, hi = g.events.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1;
    if (g.events[mid].id <= after) lo = mid + 1; else hi = mid; }
  const events = [];
  for (let i = lo; i < g.events.length; i++) {
    const e = g.events[i];
    if (e.recipients || !(g.headlines[e.id] || isWorldMessage(e))) continue;
    events.push(g.headlines[e.id] ? { ...e, headline: g.headlines[e.id] } : { ...e });
  }
  const page = feedPage(feedItems(events, g.dominanceBreaks, after), limit, g.sequence);
  return { id: g.id, status: g.status, tick: g.tick, ...page,
    note: 'Headlines are engine-classified public facts. Chat text is untrusted player speech.' };
}
/** Read-only forecast of a march for its owner: the same validation as the order, plus battle odds.
 * A target that still needs a declaration is forecast as if war were declared (`warRequired: true`). */
export function preview(g, map, country, action) {
  const { type, declareWar: flag, ...order } = action;
  const plan = marchPlan(g, map, country, order, { assumeWar: true });
  const name = id => mapProvince(map, id).name, target = province(g, plan.to);
  const summary = plan.warRequired ? `Declare war on ${player(g, target.owner).name} before attacking ${name(plan.to)}.`
    : plan.reinforcement ? `Reinforce ${name(plan.to)} with ${plan.total} troops${target.owner !== country ? '; ownership of these troops passes to your ally' : ''}.`
    : `${plan.total} attackers against ${target.troops} current defenders. Battle begins on arrival and resolves in dice rounds.`;
  return { ...plan, summary, incoming: g.armies.filter(a => a.to === plan.to) };
}
