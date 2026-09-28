import { travelTicks, journeyPoint, turnAroundArrival } from '../public/movement.js';
import { feedItems, feedPage, isWorldMessage } from '../public/feed-model.js';
/** Authoritative, deterministic rules. Time is an integer simulation second.
 * No HTTP, random numbers, timers, credentials, or persistence in this module.
 */
export const RULES = Object.freeze({ duration: 1800, recruit: 20,
  notice: 30, hold: 90, economyShare: .6, maturity: 300, orderWindow: 10,
  orderLimit: 3, chatWindow: 10, messageLength: 500, proposalLife: 120,
  diplomacyLife: 60, warRequired: true,
  marchSetup: 15, kmPerTick: 35, maxScheduleDelay: 300, maxAttackSources: 16,
  maxTransitHops: 8, maxTurnArounds: 2,
  maxDevelopment: 3, developmentCosts: [0, 12, 24], developmentTicks: [0, 60, 90] });
export const gameRules = g => g.rules;
export const reservedTroops = (g, country, from) => g.orders
  .filter(o => o.country === country && o.from === from && ['move', 'transit', 'develop'].includes(o.type))
  .reduce((n, o) => n + o.amount, 0);
const journeyTicks = (g, from, to) => g.travelTimes[from][to];

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
const warKey = (a, b) => [a, b].sort().join(':');
export const atWar = (g, a, b) => Boolean(a && b && !allied(g, a, b) &&
  (!gameRules(g).warRequired || (g.wars || []).includes(warKey(a, b))));
function mayEnter(g, country, owner) { return !owner || allied(g, country, owner) || atWar(g, country, owner); }
function sideRoster(g, side) { return members(g, side).map(p => p.id); }
function majority(g, roster) { const active=roster.filter(id=>player(g,id).eliminatedAt===null).length;return Math.floor(active/2)+1; }
function votes(g, roster, approvals) { return roster.filter(id=>player(g,id).eliminatedAt===null && approvals.includes(id)).length; }
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
  g.events.push(e);
  // Battles are classified at the end of their tick, against the settled troop total.
  if (!recipients && type !== 'battle') headline(g, e, { maxDevelopment: gameRules(g).maxDevelopment });
  return e;
}
/** v0.6 public headlines: one deterministic classification per PUBLIC event, shared by every
 * client. Stored beside the adjudication log (not inside events) so historic event hashes and
 * replays stay exact; `observe` and `worldFeed` attach it as `event.headline`. Structured facts
 * only: clients write the prose. Shared-battle casualties stay a total, never per-country kills.
 * Major battle: casualties >= max(20, ceil(3% of all troops on the map at the end of that tick)).
 */
export const HEADLINES = Object.freeze({ battleFloor: 20, battleShare: .03 });
export const majorBattleThreshold = troops => Math.max(HEADLINES.battleFloor, Math.ceil(HEADLINES.battleShare * troops));
export const worldTroops = g => g.provinces.reduce((n, p) => n + p.troops, 0) + g.armies.reduce((n, a) => n + a.amount, 0);
/** Phased battles record casualties; legacy one-shot battles lose everything above the survivors. */
export const battleCasualties = e => e.casualties ?? Math.max(0, e.before + (e.defenderRecruited || 0) +
  e.arrivals.reduce((n, a) => n + a.amount, 0) - e.troops - (e.withdrawn || 0) - (e.defenderRouted || 0));
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
    case 'industry_damaged': return { kind: 'industry_down', province: e.province, owner: e.owner, level: e.level };
    // Only the top tier: level II builds are routine and would bury the feed.
    case 'development_completed': return Number.isSafeInteger(context.maxDevelopment) && e.level >= context.maxDevelopment
      ? { kind: 'industry_up', province: e.province, country: e.country, level: e.level } : null;
    case 'battle': {
      if (!Number.isSafeInteger(context.worldTroops)) return null;
      const casualties = battleCasualties(e), threshold = majorBattleThreshold(context.worldTroops);
      return casualties >= threshold ? { kind: 'major_battle', province: e.province, casualties,
        worldTroops: context.worldTroops, threshold, captured: e.owner !== e.previousOwner,
        owner: e.owner, previousOwner: e.previousOwner } : null;
    }
    default: return null;
  }
}
function headline(g, e, context) {
  const h = classifyHeadline(e, context);
  if (h) (g.headlines ||= {})[e.id] = h;
}
function identifier(g, prefix) { return `${prefix}${++g.serial}`; }
function alive(g, id) {
  const p = player(g, id); requireRule(p.eliminatedAt === null, 'Eliminated countries cannot do that.'); return p;
}
export function createGame({ id, name, hostId, speed = 1, eligible = false }, map) {
  const rules = { ...RULES, ...map.rules, economyShare: .6 };
  const positions = Object.fromEntries(map.provinces.map(p => [p.id, { x: p.x, y: p.y }]));
  const byId = new Map(map.provinces.map(p => [p.id, p]));
  const travelTimes = Object.fromEntries(map.provinces.map(p => [p.id,
    Object.fromEntries(p.neighbors.map(id => [id, travelTicks(p, byId.get(id), rules)]))]));
  return { version: map.rulesVersion, scenario: map.id, rules, positions, travelTimes,
    economy: { recruited: 0, invested: 0 }, id, name: text(name, 'Room name'), hostId, speed, eligible,
    status: 'lobby', tick: 0, sequence: 0, serial: 0, players: [],
    provinces: map.provinces.map(p => ({ id: p.id, owner: null, troops: 2, nextRecruit: null, route: null, development: 1, developing: null })),
    armies: [], battles: [], orders: [], proposals: [], departures: [], coalitions: [], wars: [], diplomacy: [], events: [], receipts: {},
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
  for (const id of c.start) Object.assign(province(g, id), { owner: country, troops: c.garrisons?.[id] ?? c.startTroops ?? 10, development: c.development?.[id] ?? 1 });
  if (kind === 'bot') g.eligible = false;
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
function military(g, map, p, action) {
  alive(g, p.id);
  if (action.type === 'move') return coordinated(g, map, p, { ...action, sources: moveSources(action) });
  const source = province(g, action.from);
  requireRule(source.owner === p.id, 'You do not own the source province.', 403);
  requireRule(action.to === null && action.type === 'route' || mapProvince(map, source.id).neighbors.includes(action.to),
    'Destination must be connected to the source.');
  p.orderTicks = p.orderTicks.filter(t => t > g.tick - gameRules(g).orderWindow);
  requireRule(p.orderTicks.length < gameRules(g).orderLimit, 'Military command cooldown: three per ten game seconds.', 429);
  if (action.to !== null) {
    requireRule(allied(g, p.id, province(g, action.to).owner), 'Recruitment routes need a friendly destination.');
  }
  const order = { id: identifier(g, 'order-'), country: p.id, type: action.type,
    from: source.id, to: action.to, amount: action.amount ?? null, executeAt: g.tick + 1 };
  p.orderTicks.push(g.tick); g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt };
}
function checkBudget(g, p) {
  const r = gameRules(g);
  requireRule(p.orderTicks.filter(t => t > g.tick - r.orderWindow).length < r.orderLimit,
    'Military command cooldown: three per ten game seconds.', 429);
}
function useBudget(g, p) {
  p.orderTicks = p.orderTicks.filter(t => t > g.tick - gameRules(g).orderWindow);
  p.orderTicks.push(g.tick);
}
/** Validate an entire synchronized attack without mutating state or consuming budget. */
export function attackPlan(g, map, country, action) {
  alive(g, country); const r = gameRules(g);
  const target=province(g, action.to);
  requireRule(mayEnter(g, country, target.owner), 'Declare war before attacking another country.', 409);
  requireRule(Array.isArray(action.sources) && action.sources.length > 0 && action.sources.length <= r.maxAttackSources,
    `Choose 1–${r.maxAttackSources} connected source provinces.`);
  const unique = new Set();
  const sources = action.sources.map(input => {
    requireRule(input && typeof input === 'object' && !Array.isArray(input), 'Invalid attack source.');
    const source = province(g, input.from);
    requireRule(source.owner === country, 'You do not own the source province.', 403);
    requireRule(!unique.has(source.id), 'Each source may appear only once.'); unique.add(source.id);
    requireRule(mapProvince(map, source.id).neighbors.includes(action.to), 'Every source must connect to the destination.');
    const available = Math.max(0, source.troops - reservedTroops(g, country, source.id) - 1);
    requireRule((input.amount !== undefined) !== (input.percent !== undefined), 'Supply exactly one of amount or percent per source.');
    if (input.percent !== undefined) requireRule(Number.isFinite(input.percent) && input.percent > 0 && input.percent <= 100,
      'Percentage must be greater than zero and at most 100.');
    // Percentages select currently uncommitted troops, never future recruitment.
    const amount = input.amount ?? Math.floor(available * input.percent / 100);
    requireRule(Number.isSafeInteger(amount) && amount > 0 && amount <= available,
      'Not enough uncommitted troops; leave one at home. A percentage must select at least one troop.');
    return { from: source.id, amount, available, travel: journeyTicks(g, source.id, action.to) };
  });
  const earliest = g.tick + 1 + Math.max(...sources.map(s => s.travel));
  const arrivesAt = action.arriveAt ?? earliest;
  requireRule(Number.isSafeInteger(arrivesAt) && arrivesAt >= earliest, `Earliest shared arrival is tick ${earliest}.`);
  requireRule(arrivesAt <= earliest + r.maxScheduleDelay, 'Arrival is scheduled too far ahead.');
  return { to: action.to, earliest, arrivesAt, total: sources.reduce((n, s) => n + s.amount, 0),
    sources: sources.map(s => ({ ...s, executeAt: arrivesAt - s.travel })),
    warning: 'Waiting troops remain in their source garrisons and can be attacked. Every component is checked again at departure.' };
}
function coordinated(g, map, p, action) {
  const plan = attackPlan(g, map, p.id, action); checkBudget(g, p);
  const groupId = identifier(g, 'attack-');
  const orders = plan.sources.map(s => ({ id: identifier(g, 'order-'), groupId, country: p.id,
    type: 'move', from: s.from, to: plan.to, amount: s.amount, executeAt: s.executeAt, arrivesAt: plan.arrivesAt }));
  useBudget(g, p); g.orders.push(...orders);
  event(g, 'attack_accepted', { country: p.id, groupId, arrivesAt: plan.arrivesAt, orders }, [p.id]);
  return { groupId, orderId: orders[0].id, executeAt: orders[0].executeAt, arrivesAt: plan.arrivesAt, orders };
}
/** Validate a transit without mutating state or consuming budget. */
function transitPlan(g,map,p,action) {
  alive(g,p.id);const source=province(g,action.from),r=gameRules(g);
  requireRule(source.owner===p.id,'You do not own the source province.',403);
  requireRule(Array.isArray(action.path) && action.path.length>=2 && action.path.length<=r.maxTransitHops,
    `Choose 2–${r.maxTransitHops} connected destinations, including an allied province.`);
  let previous=source.id,travel=0,throughAlly=false;
  for(let i=0;i<action.path.length;i++){
    const id=action.path[i],dest=province(g,id);
    requireRule(mapProvince(map,previous).neighbors.includes(id),'Every transit leg must follow a map connection.');
    if(i<action.path.length-1){requireRule(allied(g,p.id,dest.owner),'Intermediate provinces must belong to your alliance.');
      if(dest.owner!==p.id)throughAlly=true;}
    else requireRule(mayEnter(g,p.id,dest.owner),'Declare war before attacking another country.',409);
    travel+=journeyTicks(g,previous,id);previous=id;
  }
  requireRule(throughAlly,'Transit must pass through another alliance member’s province.');
  const available=source.troops-reservedTroops(g,p.id,source.id)-1;
  requireRule(Number.isSafeInteger(action.amount) && action.amount>0 && action.amount<=available,
    'Not enough uncommitted troops; leave one at home.');
  return {source,travel};
}
function transit(g,map,p,action) {
  const {source,travel}=transitPlan(g,map,p,action);
  checkBudget(g,p);useBudget(g,p);
  const order={id:identifier(g,'order-'),groupId:identifier(g,'transit-'),type:'transit',country:p.id,
    from:source.id,to:action.path[0],path:[...action.path],amount:action.amount,
    executeAt:g.tick+1,ultimateArrivesAt:g.tick+1+travel};
  g.orders.push(order);event(g,'order_accepted',{country:p.id,orderId:order.id,executeAt:order.executeAt},[p.id]);
  return {orderId:order.id,groupId:order.groupId,executeAt:order.executeAt,arrivesAt:order.ultimateArrivesAt};
}
const moveSources = action => [{ from: action.from, ...(action.amount !== undefined ? { amount: action.amount } : {}), ...(action.percent !== undefined ? { percent: action.percent } : {}) }];
/** Optional `declareWar: true` on move/attack/transit: one atomic "declare war and march".
 * Only a solo country may combine them; the march is validated as if the war already existed,
 * then the ordinary solo declaration runs, then the ordinary reservation. Any invalid part
 * rejects the whole action before any state changes. The declaration itself consumes no
 * military command, exactly as a separate `declare_war`; the march consumes its usual one.
 * Where no declaration is needed (neutral/unowned, own or allied target, already at war,
 * or a room without formal war rules) the flag is harmless and the march is unchanged. */
function march(g, map, p, action, commit) {
  if (action.declareWar === undefined) return commit();
  requireRule(typeof action.declareWar === 'boolean', 'declareWar must be true or false.');
  if (!action.declareWar) return commit();
  alive(g, p.id);
  const targetId = action.type === 'transit' ? (Array.isArray(action.path) ? action.path.at(-1) : undefined) : action.to;
  const owner = g.provinces.find(v => v.id === targetId)?.owner;
  if (!owner || !g.players.some(x => x.id === owner) || mayEnter(g, p.id, owner)) return { ...commit(), warDeclared: false };
  requireRule(sideRoster(g, p.side).length === 1, 'Coalition members must call a war vote first; the march is not sent.', 409);
  const target = player(g, owner), pairs = sideRoster(g, target.side).map(b => warKey(p.id, b)).sort();
  // Dry run under the assumed war; restore the war list whatever happens.
  const wars = g.wars;
  g.wars = [...new Set([...wars, ...pairs])].sort();
  try {
    if (action.type === 'transit') transitPlan(g, map, p, action);
    else attackPlan(g, map, p.id, action.type === 'move' ? { ...action, sources: moveSources(action) } : action);
    checkBudget(g, p);
  } finally { g.wars = wars; }
  const war = beginDiplomacy(g, p, { country: owner }, 'war');
  requireRule(war.status === 'enacted', 'War declaration was not enacted; the march is not sent.', 409);
  return { ...commit(), warDeclared: true, war: { motionId: war.motionId, from: p.side, to: target.side, pairs } };
}
function develop(g, p, action) {
  alive(g, p.id);
  const source = province(g, action.from), r = gameRules(g);
  requireRule(source.owner === p.id, 'You do not own this province.', 403);
  requireRule(source.development < r.maxDevelopment, 'Province is fully developed.');
  requireRule(!source.developing && !g.orders.some(o => o.type === 'develop' && o.from === source.id), 'Development is already underway.');
  const amount = r.developmentCosts[source.development];
  requireRule(source.troops - reservedTroops(g, p.id, source.id) > amount, `Development needs ${amount} uncommitted manpower plus one garrison.`);
  checkBudget(g, p); useBudget(g, p);
  const order = { id: identifier(g, 'order-'), type: 'develop', country: p.id, from: source.id, amount,
    level: source.development + 1, executeAt: g.tick + 1 };
  g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt, cost: amount, completesAt: order.executeAt + r.developmentTicks[source.development] };
}
const matchesRecall = (item, id) => item.id === id || item.groupId === id || item.orderId === id;
function recall(g, p, action) {
  alive(g, p.id);
  requireRule(typeof action.id === 'string' && action.id.length <= 80, 'Specify an army, queued order, or attack group ID.');
  const items = [...g.orders.filter(o => ['move','transit'].includes(o.type)), ...g.armies.filter(a => !a.returning)]
    .filter(item => matchesRecall(item, action.id));
  requireRule(items.length > 0, 'This order has already arrived, been cancelled, or is returning.', 409);
  requireRule(items.every(item => item.country === p.id), 'You cannot recall another country’s troops.', 403);
  requireRule(!g.orders.some(o => o.type === 'recall' && o.target === action.id), 'Recall is already queued.', 409);
  requireRule(!g.orders.some(o => o.type === 'turn_around' && o.target === action.id), 'A turn-around is already queued for this army.', 409);
  checkBudget(g, p); useBudget(g, p);
  const order = { id: identifier(g, 'order-'), type: 'recall', country: p.id, target: action.id, executeAt: g.tick + 1 };
  g.orders.push(order);
  event(g, 'order_accepted', { country: p.id, orderId: order.id, executeAt: order.executeAt }, [p.id]);
  return { orderId: order.id, executeAt: order.executeAt };
}
function executeRecall(g, order) {
  const selected = item => item.country === order.country && matchesRecall(item, order.target);
  const waiting = g.orders.filter(o => ['move','transit'].includes(o.type) && selected(o));
  g.orders = g.orders.filter(o => !['move','transit'].includes(o.type) || !selected(o));
  let returned = 0;
  for (const a of g.armies.filter(a => !a.returning && selected(a))) {
    turnArmy(g,a,'manual');
    returned++;
  }
  event(g, waiting.length || returned ? 'recall_executed' : 'order_failed', {
    country: order.country, orderId: order.id, cancelled: waiting.length, returning: returned,
    ...(!waiting.length && !returned ? { reason: 'The selected troops are no longer recallable.' } : {}) }, [order.country]);
}
/** Reverse a marching army from its actual position. `reason` is 'manual' for a player's recall;
 * automatic reasons add `province` (where it was heading) and cause-specific detail. */
function turnArmy(g,a,reason,detail={}) {
  const battle=(g.battles || []).find(b=>b.province===a.to && a.engaged);
  if(battle)battle.withdrawn+=a.amount;
  const startPoint=journeyPoint(a,g.positions,g.tick);
  // An army that already turned around measures its way back by its distance from home,
  // not by the time since its last turn (unchanged for every army that never turned around).
  const travelBack=a.transit?Math.max(1,g.tick-a.originDepartedAt):
    a.turnArounds?turnAroundArrival(a,g.travelTimes,g.tick)-g.tick:
    Math.max(1,Math.min(a.arrivesAt-a.departedAt,g.tick-a.departedAt));
  const originalFrom=a.transit?a.origin:a.from,heading=a.to;
  Object.assign(a,{from:a.to,to:originalFrom,startPoint,returning:true,engaged:false,departedAt:g.tick,arrivesAt:g.tick+travelBack});
  event(g,'army_recalled',{country:a.country,armyId:a.id,to:a.to,amount:a.amount,arrivesAt:a.arrivesAt,
    ...(reason==='manual'?{}:{reason,province:heading,...detail})});
}
/** Why an arriving, non-allied army that did not join the attack is turned back. */
function refusal(g,army,target,battle,chosen) {
  if(!mayEnter(g,army.country,target.owner))return {reason:'no_war',owner:target.owner};
  if(battle && battle.attackerSide!==player(g,army.country).side)
    return {reason:'battle_in_progress',battleAttackerSide:battle.attackerSide,owner:target.owner};
  // Two sides reached the same province on the same tick; the stronger arrival has first claim.
  return {reason:'rival_arrival',rivalSide:chosen,owner:target.owner};
}
/** Read-only check for turning one of your moving armies around at tick `at` (default: the next
 * tick, when the order executes). An advancing army turning around is a recall; a returning one
 * resumes toward the province it had been heading for, from where it actually is. */
export function turnAroundPlan(g, country, armyId, at = g.tick + 1) {
  alive(g, country);
  requireRule(typeof armyId === 'string' && armyId.length > 0 && armyId.length <= 80, 'Specify an army ID.');
  const army = g.armies.find(a => a.id === armyId);
  requireRule(army, 'That army has already arrived or no longer exists.', 409);
  requireRule(army.country === country, 'You cannot turn another country’s troops around.', 403);
  requireRule(!army.engaged, 'That army is fighting; recall it to withdraw.', 409);
  if (!army.returning) return { armyId, mode: 'recall', to: army.transit ? army.origin : army.from,
    arrivesAt: army.transit ? at + Math.max(1, at - army.originDepartedAt) :
      army.turnArounds ? turnAroundArrival(army, g.travelTimes, at) :
      at + Math.max(1, Math.min(army.arrivesAt - army.departedAt, at - army.departedAt)) };
  requireRule(!army.transit, 'A transit column cannot turn around; let it return home, then send a new order.', 409);
  const limit = gameRules(g).maxTurnArounds ?? RULES.maxTurnArounds;
  requireRule((army.turnArounds || 0) < limit, `An army can turn back toward its target at most ${limit} times.`, 409);
  const target = province(g, army.from);
  requireRule(mayEnter(g, country, target.owner), 'Declare war before attacking another country.', 409);
  const arrivesAt = turnAroundArrival(army, g.travelTimes, at);
  requireRule(arrivesAt !== null, 'This army cannot turn around.', 409);
  requireRule(arrivesAt <= gameRules(g).duration, 'The army would arrive after the match deadline.');
  const battle = (g.battles || []).find(b => b.province === target.id);
  return { armyId, mode: 'resume', to: target.id, owner: target.owner, amount: army.amount, arrivesAt,
    turnArounds: (army.turnArounds || 0) + 1, limit,
    ...(battle && !allied(g, country, target.owner) ? { battleInProgress: { attackerSide: battle.attackerSide,
      joins: battle.attackerSide === player(g, country).side } } : {}),
    warning: 'Checked again when the order executes next tick. Ownership, wars and battles can change before arrival.' };
}
function turnAround(g, p, action) {
  const plan = turnAroundPlan(g, p.id, action.armyId);
  if (plan.mode === 'recall') return { mode: 'recall', ...recall(g, p, { id: action.armyId }) };
  requireRule(!g.orders.some(o => ['recall', 'turn_around'].includes(o.type) && o.target === action.armyId),
    'A turn-around or recall is already queued for this army.', 409);
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
  const a = g.armies.find(x => x.id === order.target);
  if (plan.mode !== 'resume') {
    event(g, 'order_failed', { country: order.country, orderId: order.id, reason: 'The army is already heading for its target.' }, [order.country]); return;
  }
  const startPoint = journeyPoint(a, g.positions, g.tick), origin = a.to;
  delete a.returning;
  Object.assign(a, { from: origin, to: plan.to, startPoint, departedAt: g.tick, arrivesAt: plan.arrivesAt, turnArounds: plan.turnArounds });
  event(g, 'army_turned_around', { country: a.country, armyId: a.id, from: origin, to: a.to, amount: a.amount, arrivesAt: a.arrivesAt });
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
  requireRule(candidate.side.startsWith('solo:'), 'The candidate must first leave their current coalition.');
  requireRule(!locked(g, candidate.id) && !locked(g, p.id), 'Membership change already pending.', 409);
  requireRule(g.proposals.filter(q => q.status === 'open' && q.creator === p.id).length < 3,
    'At most three outstanding offers per country.', 429);
  const coalition = p.side.startsWith('solo:') ? null : p.side;
  const roster = [...members(g, p.side).map(m => m.id), candidate.id];
  const q = { id: identifier(g, 'offer-'), creator: p.id, candidate: candidate.id, coalition, roster,
    name: coalition ? g.coalitions.find(c => c.id === coalition).name : text(a.name || 'The Accord', 'Coalition name', 40),
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
  requireRule(!troopsInsideAlly(g,p.side),'An alliance cannot break while a member’s troops are inside an ally’s borders.',409);
  // Departure is unilateral, including during an admission notice. Invalidate that consent.
  for (const q of g.proposals) if (['open', 'pending'].includes(q.status) && q.roster.includes(p.id))
    cancel(g, q, 'A participant filed a departure.');
  const departure = { country: p.id, side: p.side, activateAt: g.tick + gameRules(g).notice };
  g.departures.push(departure); event(g, 'departure_notice', departure);
  return departure;
}
function troopsInsideAlly(g,side) {
  return g.armies.some(a=>a.transit && !a.returning && !a.engaged && player(g,a.country).side===side &&
    [a.from,a.to].some(id=>{const owner=province(g,id).owner;return owner && owner!==a.country && allied(g,a.country,owner);}));
}
function normalizeWars(g) {
  if (!gameRules(g).warRequired) return;
  const pairs=new Set(g.wars || []), teams=[...new Set(g.players.map(p=>p.side))];
  const expanded=new Set();
  for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++) {
    const left=sideRoster(g,teams[i]),right=sideRoster(g,teams[j]);
    if(left.some(a=>right.some(b=>pairs.has(warKey(a,b)))))
      for(const a of left)for(const b of right)expanded.add(warKey(a,b));
  }
  g.wars=[...expanded].sort();
}
function sameMotionRoster(g, motion) {
  return same(sideRoster(g,motion.fromSide),motion.fromRoster) &&
    same(sideRoster(g,motion.toSide),motion.toRoster);
}
function activeMotion(g, kind, fromSide, toSide) {
  return (g.diplomacy || []).find(m=>m.kind===kind && ['voting','offered'].includes(m.status) &&
    (m.fromSide===fromSide && m.toSide===toSide || m.fromSide===toSide && m.toSide===fromSide));
}
function declareWar(g, motion) {
  for(const a of motion.fromRoster)for(const b of motion.toRoster)g.wars.push(warKey(a,b));
  g.wars=[...new Set(g.wars)].sort();motion.status='enacted';
  event(g,'war_declared',{from:motion.fromSide,to:motion.toSide,fromRoster:motion.fromRoster,toRoster:motion.toRoster});
}
function peaceAccepted(g, motion) {
  const left=new Set(motion.fromRoster),right=new Set(motion.toRoster);
  g.wars=g.wars.filter(pair=>{const [a,b]=pair.split(':');return !(left.has(a)&&right.has(b) || left.has(b)&&right.has(a));});
  motion.status='enacted';
  const cancelled=g.orders.filter(o=>['move','transit'].includes(o.type) &&
    ((left.has(o.country)&&right.has(province(g,o.path?.at(-1)||o.to).owner)) ||
      (right.has(o.country)&&left.has(province(g,o.path?.at(-1)||o.to).owner))));
  const cancelledIds=new Set(cancelled.map(o=>o.id));g.orders=g.orders.filter(o=>!cancelledIds.has(o.id));
  for(const o of cancelled)event(g,'order_cancelled',{country:o.country,orderId:o.id,reason:'Peace treaty.'},[o.country]);
  let recalled=0;
  for(const army of g.armies)if(!army.returning &&
    ((left.has(army.country)&&right.has(province(g,army.path?.at(-1)||army.to).owner)) ||
      (right.has(army.country)&&left.has(province(g,army.path?.at(-1)||army.to).owner)))) {
    turnArmy(g,army,'peace',{owner:province(g,army.path?.at(-1)||army.to).owner});recalled++;
  }
  event(g,'peace_accepted',{from:motion.fromSide,to:motion.toSide,fromRoster:motion.fromRoster,toRoster:motion.toRoster,
    cancelled:cancelled.length,recalled});
}
function advanceMotion(g,motion) {
  if(motion.kind==='war' && votes(g,motion.fromRoster,motion.fromYes)>=majority(g,motion.fromRoster))declareWar(g,motion);
  if(motion.kind==='peace' && motion.status==='voting' && votes(g,motion.fromRoster,motion.fromYes)>=majority(g,motion.fromRoster)) {
    motion.status='offered';motion.expiresAt=g.tick+gameRules(g).diplomacyLife;
    event(g,'peace_offered',{motionId:motion.id,from:motion.fromSide,to:motion.toSide,
      fromRoster:motion.fromRoster,toRoster:motion.toRoster,expiresAt:motion.expiresAt},motion.toRoster);
  }
  if(motion.kind==='peace' && motion.status==='offered' && votes(g,motion.toRoster,motion.toYes)>=majority(g,motion.toRoster))peaceAccepted(g,motion);
}
function beginDiplomacy(g,p,a,kind) {
  alive(g,p.id);const target=alive(g,a.country);
  requireRule(!allied(g,p.id,target.id),'Choose a country outside your alliance.');
  requireRule(kind==='war' ? !atWar(g,p.id,target.id) : atWar(g,p.id,target.id),
    kind==='war'?'These sides are already at war.':'These sides are not at war.',409);
  requireRule(!activeMotion(g,kind,p.side,target.side),'A vote or offer between these sides is already open.',409);
  const motion={id:identifier(g,kind==='war'?'war-vote-':'peace-offer-'),kind,status:'voting',
    fromSide:p.side,toSide:target.side,fromRoster:sideRoster(g,p.side),toRoster:sideRoster(g,target.side),
    fromYes:[p.id],toYes:[],expiresAt:g.tick+gameRules(g).diplomacyLife};
  g.diplomacy.push(motion);
  if(motion.fromRoster.length>1)event(g,kind==='war'?'war_vote':'peace_vote',{
    motionId:motion.id,from:motion.fromSide,to:motion.toSide,expiresAt:motion.expiresAt},motion.fromRoster);
  advanceMotion(g,motion);
  return {motionId:motion.id,status:motion.status,expiresAt:motion.expiresAt};
}
function approveDiplomacy(g,p,a,kind) {
  alive(g,p.id);const motion=(g.diplomacy || []).find(m=>m.id===a.motionId && m.kind===kind);
  requireRule(motion && ['voting','offered'].includes(motion.status) && g.tick<motion.expiresAt,'Vote or offer is no longer open.',409);
  requireRule(sameMotionRoster(g,motion),'Alliance membership changed; start a new vote.',409);
  const source=motion.status==='voting' && p.side===motion.fromSide;
  const target=motion.kind==='peace' && motion.status==='offered' && p.side===motion.toSide;
  requireRule(source || target,'Your side cannot vote on this motion.',403);
  const approvals=source?motion.fromYes:motion.toYes;
  requireRule(!approvals.includes(p.id),'You have already approved this motion.',409);
  approvals.push(p.id);
  event(g,'diplomacy_approved',{motionId:motion.id,country:p.id},source?motion.fromRoster:motion.toRoster);
  advanceMotion(g,motion);
  return {motionId:motion.id,status:motion.status,expiresAt:motion.expiresAt};
}
function chat(g, p, a) {
  const message = text(a.text, 'Message', gameRules(g).messageLength);
  requireRule(p.lastChat === null || g.tick - p.lastChat >= gameRules(g).chatWindow, 'Chat cooldown: ten game seconds across all channels.', 429);
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
    case 'move': result = march(g, map, p, action, () => military(g, map, p, action)); break;
    case 'route': result = military(g, map, p, action); break;
    case 'attack': result = march(g, map, p, action, () => coordinated(g, map, p, action)); break;
    case 'transit': result = march(g, map, p, action, () => transit(g,map,p,action)); break;
    case 'recall': result = recall(g, p, action); break;
    case 'turn_around': result = turnAround(g, p, action); break;
    case 'develop': result = develop(g, p, action); break;
    case 'propose': result = propose(g, p, action); break;
    case 'accept': result = accept(g, p, action); break;
    case 'decline': result = decline(g, p, action); break;
    case 'leave': result = leave(g, p); break;
    case 'declare_war': result = beginDiplomacy(g,p,action,'war'); break;
    case 'offer_peace': result = beginDiplomacy(g,p,action,'peace'); break;
    case 'vote_war': result = approveDiplomacy(g,p,action,'war'); break;
    case 'vote_peace': result = approveDiplomacy(g,p,action,'peace'); break;
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
    if(troopsInsideAlly(g,d.side)){d.activateAt=g.tick+1;continue;}
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
function expireDiplomacy(g) {
  for(const motion of g.diplomacy || [])if(['voting','offered'].includes(motion.status)) {
    const reason=!sameMotionRoster(g,motion)?'Alliance membership changed.':
      g.tick>=motion.expiresAt?'The 60-second vote or offer expired.':null;
    if(reason){const recipients=motion.status==='offered'?[...new Set([...motion.fromRoster,...motion.toRoster])]:motion.fromRoster;
      motion.status='expired';event(g,'diplomacy_expired',{motionId:motion.id,kind:motion.kind,reason},recipients);}
  }
}
function departArmy(g, country, from, to, amount, automatic = false, order = null) {
  const arrivesAt = order?.transit ? g.tick+journeyTicks(g,from,to) : order?.arrivesAt ?? g.tick + journeyTicks(g, from, to);
  g.armies.push({ id: identifier(g, 'army-'), country, from, to, amount, departedAt: g.tick,
    arrivesAt, ...(order ? { orderId: order.id, groupId: order.groupId } : {}),
    ...(order?.transit?{transit:true,path:[...order.path],pathIndex:0,origin:from,originDepartedAt:g.tick}:{}) });
  if (!automatic) event(g, 'army_departed', { country, from, to, amount, arrivesAt });
}
function executeOrders(g) {
  // Cancellation received before the arrival/departure tick wins that boundary.
  // No troop is refunded instantly if it has already left its garrison.
  // Recalls and turn-arounds run in submission order before any departure or arrival.
  for (const o of g.orders.filter(o => ['recall', 'turn_around'].includes(o.type) && o.executeAt <= g.tick))
    if (o.type === 'recall') executeRecall(g, o); else executeTurnAround(g, o);
  for (const o of g.orders.filter(o => !['recall', 'turn_around'].includes(o.type) && o.executeAt <= g.tick)) {
    const source = province(g, o.from);
    let error = source.owner !== o.country ? 'Source is no longer yours.' : null;
    if (['move', 'transit', 'develop'].includes(o.type) && o.amount >= source.troops) error = 'Not enough troops remain.';
    if (o.type === 'route' && o.to !== null && !allied(g, o.country, province(g, o.to).owner)) error = 'Destination is no longer friendly.';
    if (o.type === 'move' && !mayEnter(g,o.country,province(g,o.to).owner)) error = 'War ended before departure.';
    if(o.type==='transit' && (o.path.slice(0,-1).some(id=>!allied(g,o.country,province(g,id).owner)) ||
      !mayEnter(g,o.country,province(g,o.path.at(-1)).owner)))error='Transit route or war status changed.';
    if (o.type === 'develop' && (source.developing || source.development !== o.level - 1)) error = 'Development state changed.';
    if (error) { event(g, 'order_failed', { country: o.country, orderId: o.id, reason: error }, [o.country]); continue; }
    if (o.type === 'route') source.route = o.to;
    else if (o.type === 'develop') {
      source.troops -= o.amount; g.economy.invested += o.amount;
      source.developing = { level: o.level, completesAt: g.tick + gameRules(g).developmentTicks[source.development] };
      event(g, 'development_started', { country: o.country, province: source.id, cost: o.amount, ...source.developing });
    } else { source.troops -= o.amount; departArmy(g, o.country, o.from, o.to, o.amount, false,
      o.type==='transit'?{...o,transit:true}:o); }
    event(g, 'order_executed', { country: o.country, orderId: o.id }, [o.country]);
  }
  g.orders = g.orders.filter(o => o.executeAt > g.tick);
}
function resolveArrivalsOld(g) {
  const due = g.armies.filter(a => a.arrivesAt <= g.tick);
  g.armies = g.armies.filter(a => a.arrivesAt > g.tick);
  const dueByTarget=new Map();
  for(const army of due){const list=dueByTarget.get(army.to) || [];list.push(army);dueByTarget.set(army.to,list);}
  const ids = g.players.map(p => p.id).sort();
  const rotated = [...ids.slice(g.tick % ids.length), ...ids.slice(0, g.tick % ids.length)];
  for (const target of g.provinces) {
    let arrivals = dueByTarget.get(target.id) || [];
    if (!arrivals.length) continue;
    if(gameRules(g).warRequired) {
      const rejected=[];
      arrivals=arrivals.filter(a=>{
        if(mayEnter(g,a.country,target.owner))return true;
        rejected.push(a);return false;
      });
      // Independent armies reaching vacant land together do not acquire a
      // license to fight one another. Give the stronger arrival first claim.
      const rivalSides=[...new Set(arrivals.filter(a=>!allied(g,a.country,target.owner)).map(a=>player(g,a.country).side))];
      rivalSides.sort((a,b)=>{
        const strength=s=>arrivals.filter(x=>player(g,x.country).side===s).reduce((n,x)=>n+x.amount,0);
        return strength(b)-strength(a) || a.localeCompare(b);
      });
      const admitted=[];
      for(const side of rivalSides) {
        if(admitted.every(other=>atWar(g,sideRoster(g,side)[0],sideRoster(g,other)[0])))admitted.push(side);
        else {const separated=arrivals.filter(a=>player(g,a.country).side===side);rejected.push(...separated);
          arrivals=arrivals.filter(a=>player(g,a.country).side!==side);}
      }
      for(const a of rejected) {
        if(a.returning)event(g,'army_interned',{country:a.country,armyId:a.id,province:target.id,amount:a.amount});
        else {turnArmy(g,a,'no_war');g.armies.push(a);}
      }
      if(!arrivals.length)continue;
    }
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
      target.nextRecruit = g.tick + gameRules(g).recruit; target.route = null;
      if (target.developing) {
        event(g, 'development_cancelled', { province: target.id, reason: 'Captured; unfinished investment is lost.' });
        target.developing = null;
      }
    }
    event(g, strengths.size > 1 ? 'battle' : 'reinforced', {
      province: target.id, previousOwner, owner: target.owner, before, troops: target.troops,
      arrivals: arrivals.map(a => ({ country: a.country, amount: a.amount })),
      strengths: Object.fromEntries(strengths) });
  }
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
  if(!gameRules(g).warRequired){resolveArrivalsOld(g);return;}
  const due=g.armies.filter(a=>!a.engaged && a.arrivesAt<=g.tick);
  g.armies=g.armies.filter(a=>a.engaged || a.arrivesAt>g.tick);
  const byTarget=new Map();
  for(const army of due){const list=byTarget.get(army.to)||[];list.push(army);byTarget.set(army.to,list);}
  for(const target of g.provinces) {
    const arriving=[];
    for(const army of byTarget.get(target.id)||[]) {
      if(army.transit && !army.returning && army.pathIndex<army.path.length-1) {
        if(allied(g,army.country,target.owner) && !(g.battles||[]).some(b=>b.province===target.id)) {
          army.from=target.id;army.pathIndex++;army.to=army.path[army.pathIndex];
          army.departedAt=g.tick;army.arrivesAt=g.tick+journeyTicks(g,army.from,army.to);
          g.armies.push(army);event(g,'army_transited',{country:army.country,province:target.id,to:army.to,amount:army.amount});
        } else {turnArmy(g,army,'transit_blocked',{owner:target.owner,
          ...(allied(g,army.country,target.owner)?{battleAttackerSide:g.battles.find(b=>b.province===target.id).attackerSide}:{})});g.armies.push(army);}
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
  if(!gameRules(g).warRequired)return;
  for(const battle of [...g.battles]) {
    if(battle.startedAt>=g.tick)continue;
    const target=province(g,battle.province);
    const attackers=g.armies.filter(a=>a.engaged && a.to===target.id);
    for(const army of attackers)if(target.owner && !atWar(g,army.country,target.owner))
      turnArmy(g,army,'no_war',{owner:target.owner,...(allied(g,army.country,target.owner)?{allied:true}:{})});
    const fighting=attackers.filter(a=>a.engaged),strength=()=>fighting.reduce((n,a)=>n+a.amount,0);
    let attackerLoss=0,defenderLoss=0,attackDice=[],defendDice=[];
    if(strength()>0 && target.troops>0) {
      attackDice=Array.from({length:Math.min(3,strength())},(_,i)=>die(g,battle,i)).sort((a,b)=>b-a);
      defendDice=Array.from({length:Math.min(2,target.troops)},(_,i)=>die(g,battle,3+i)).sort((a,b)=>b-a);
      for(let i=0;i<Math.min(attackDice.length,defendDice.length);i++){
        if(attackDice[i]>defendDice[i])defenderLoss++;else attackerLoss++;
      }
      target.troops-=defenderLoss;
      for(const army of fighting.sort((a,b)=>b.amount-a.amount || a.id.localeCompare(b.id))){
        const lost=Math.min(army.amount,attackerLoss);army.amount-=lost;attackerLoss-=lost;if(!attackerLoss)break;
      }
      const casualties=defenderLoss+Math.min(attackDice.length,defendDice.length)-defenderLoss;
      battle.casualties+=casualties;g.economy.casualties=(g.economy.casualties||0)+casualties;
      g.armies=g.armies.filter(a=>a.amount>0);
    }
    battle.lastRound={tick:g.tick,attackDice,defendDice,attackerLoss:Math.min(attackDice.length,defendDice.length)-defenderLoss,defenderLoss};
    const survivors=g.armies.filter(a=>a.engaged && a.to===target.id);
    if(survivors.length && target.troops>0)continue;
    let industryLost=0;
    if(survivors.length && target.troops===0) {
      const rotated=g.players.map(p=>p.id).sort(),n=g.tick%rotated.length;
      const priority=[...rotated.slice(n),...rotated.slice(0,n)];
      const byCountry=new Map();for(const a of survivors)byCountry.set(a.country,(byCountry.get(a.country)||0)+a.amount);
      target.owner=[...byCountry].sort((a,b)=>b[1]-a[1] || priority.indexOf(a[0])-priority.indexOf(b[0]))[0][0];
      target.troops=survivors.reduce((n,a)=>n+a.amount,0);
      g.armies=g.armies.filter(a=>!survivors.includes(a));
      target.nextRecruit=g.tick+gameRules(g).recruit;target.route=null;
      if(target.developing){event(g,'development_cancelled',{province:target.id,reason:'Captured; unfinished investment is lost.'});target.developing=null;}
      const chance=Math.min(.95,Math.max(0,(battle.engaged+battle.before-24)/90));
      if(target.development>1 && hashChance(`${g.id}:${battle.id}:industry`)<chance){target.development--;industryLost=1;
        event(g,'industry_damaged',{province:target.id,owner:target.owner,level:target.development,chance});}
    }
    g.battles=g.battles.filter(b=>b!==battle);
    event(g,'battle',{province:target.id,previousOwner:battle.previousOwner,owner:target.owner,before:battle.before,
      defenderRecruited:battle.defenderRecruited,defenderRouted:battle.defenderRouted,withdrawn:battle.withdrawn,troops:target.troops,
      arrivals:battle.arrivals,duration:g.tick-battle.startedAt,industryLost,casualties:battle.casualties});
  }
}
function recruit(g) {
  for (const p of g.provinces) {
    if (p.developing?.completesAt <= g.tick) {
      p.development = p.developing.level; p.developing = null;
      event(g, 'development_completed', { province: p.id, country: p.owner, level: p.development });
    }
    if (p.route && !allied(g, p.owner, province(g, p.route).owner)) p.route = null;
    if (!p.owner || p.nextRecruit > g.tick) continue;
    const born = p.development;
    p.troops += born; p.nextRecruit = g.tick + gameRules(g).recruit;
    const battle=(g.battles || []).find(b=>b.province===p.id);
    if(battle)battle.defenderRecruited+=born;
    if (g.economy) g.economy.recruited += born;
    const send = Math.min(born, p.troops - 1);
    if (p.route && send > 0) { p.troops -= send; if(battle)battle.defenderRouted+=send; departArmy(g, p.owner, p.id, p.route, send, true); }
  }
}
export function sides(g) {
  return [...new Set(g.players.map(p => p.side))].map(id => ({ id,
    name: g.coalitions.find(c => c.id === id)?.name || members(g, id)[0]?.id,
    members: members(g, id).map(p => p.id),
    provinces: g.provinces.filter(v => v.owner && player(g, v.owner).side === id).length,
    economy: g.provinces.filter(v => v.owner && player(g, v.owner).side === id)
      .reduce((n, v) => n + v.development, 0) }));
}
export const economyThreshold = g => Math.ceil(g.provinces.filter(p => p.owner)
  .reduce((n, p) => n + p.development, 0) * (gameRules(g).economyShare ?? .6));
export function score(g, winningSide = null, draw = false) {
  const duration = Math.max(1, Math.min(gameRules(g).maturity, g.tick));
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
  const threshold = economyThreshold(g);
  if (teams.some(t => t.members.length === g.players.length)) { finish(g, null, 'negotiated_draw'); return; }
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
  applyMembership(g); expireDiplomacy(g); executeOrders(g); resolveArrivals(g); resolveBattleRounds(g); recruit(g); victory(g);
  const battles = g.events.slice(firstEvent).filter(e => e.type === 'battle' && !e.recipients);
  if (battles.length) { const troops = worldTroops(g); for (const e of battles) headline(g, e, { worldTroops: troops }); }
  // Public feedback, separate from adjudication/event IDs so existing replays stay exact.
  for (const [side, since] of Object.entries(before)) if (g.dominance[side] !== since) {
    const changed = g.players.some(p => (affiliations.get(p.id) === side) !== (p.side === side));
    (g.dominanceBreaks ||= []).push({ tick: g.tick, side, provinces: sides(g).find(s => s.id === side)?.provinces ?? 0,
      economy: sides(g).find(s => s.id === side)?.economy ?? 0, threshold: economyThreshold(g),
      reason: changed ? 'Membership changed; the hold restarts.' : 'Economy fell below 60%.',
      // Feed position: directly after this tick's last event. Structured headline for every client.
      seq: g.sequence, headline: { kind: 'dominance_broken', side, cause: changed ? 'membership' : 'economy',
        economy: sides(g).find(s => s.id === side)?.economy ?? 0, threshold: economyThreshold(g) } });
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
  const headlines = g.headlines || {};
  const events = visible.slice(0, limit).map(({ recipients, ...e }) => headlines[e.id] ? { ...e, headline: headlines[e.id] } : e);
  const p = country ? player(g, country) : null;
  return { id: g.id, name: g.name, status: g.status, tick: g.tick, speed: g.speed, rules: gameRules(g), scenario: g.scenario, travelTimes: g.travelTimes,
    eligible: g.eligible, you: country, players: g.players.map(({ profileId, orderTicks, lastChat, ...p }) => p),
    provinces: g.provinces, armies: g.armies, battles: g.battles || [], sides: sides(g), wars: g.wars || [], economyThreshold: economyThreshold(g), projections: score(g),
    dominanceBreaks: g.dominanceBreaks || [], turnAroundLimit: gameRules(g).maxTurnArounds ?? RULES.maxTurnArounds,
    diplomacy: (g.diplomacy || []).filter(m=>['voting','offered'].includes(m.status) &&
      (m.fromRoster.includes(country) || m.status==='offered' && m.toRoster.includes(country))),
    proposals: g.proposals.filter(q => q.status === 'pending' || q.status === 'open' && q.roster.includes(country))
      .map(({ signature, ...q }) => q), departures: g.departures, dominance: g.dominance,
    commandBudget: p ? { remaining: gameRules(g).orderLimit - p.orderTicks.filter(t => t > g.tick-gameRules(g).orderWindow).length,
      reserved: g.orders.filter(o => o.country === country),
      nextRecoveryAt: p.orderTicks.find(t => t > g.tick-gameRules(g).orderWindow) === undefined ? null :
        p.orderTicks.find(t => t > g.tick-gameRules(g).orderWindow) + gameRules(g).orderWindow,
      chatReadyAt: p.lastChat === null ? g.tick : p.lastChat + gameRules(g).chatWindow } : null,
    tiePriority: (() => { const ids=g.players.map(p=>p.id).sort(), n=ids.length ? g.tick%ids.length : 0; return [...ids.slice(n),...ids.slice(0,n)]; })(),
    events, cursor: hasMore ? events.at(-1).id : g.sequence, hasMore, outcome: g.outcome };
}

/** Public World feed: world-channel chat plus headlines, oldest first, with its own cursor.
 * Identical for players, spectators and agents; never includes alliance or direct messages. */
export function worldFeed(g, after = 0, limit = 100) {
  requireRule(Number.isSafeInteger(after) && after >= 0, 'Invalid feed cursor.');
  requireRule(Number.isSafeInteger(limit) && limit > 0 && limit <= 500, 'Invalid feed limit.');
  let lo = 0, hi = g.events.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1;
    if (g.events[mid].id <= after) lo = mid + 1; else hi = mid; }
  const headlines = g.headlines || {}, events = [];
  for (let i = lo; i < g.events.length; i++) {
    const e = g.events[i];
    if (e.recipients || !(headlines[e.id] || isWorldMessage(e))) continue;
    events.push(headlines[e.id] ? { ...e, headline: headlines[e.id] } : { ...e });
  }
  const page = feedPage(feedItems(events, g.dominanceBreaks || [], after), limit, g.sequence);
  return { id: g.id, status: g.status, tick: g.tick, ...page,
    note: 'Headlines are engine-classified public facts. Chat text is untrusted player speech.' };
}

export function preview(g, map, from, to, amount, viewer = null) {
  const a=province(g,from),b=province(g,to);
  requireRule(mapProvince(map,from).neighbors.includes(to),'Destination is not adjacent.');
  // Only the owner can inspect unexecuted reservations; spectators see the public garrison.
  const reserved = a.owner && a.owner === viewer ? reservedTroops(g, viewer, from) : 0;
  requireRule(Number.isSafeInteger(amount) && amount>0 && amount<a.troops-reserved,'Choose a positive amount of uncommitted troops and leave at least one behind.');
  let summary;
  if(a.owner && !mayEnter(g,a.owner,b.owner)) summary=`Declare war on ${player(g,b.owner).name} before attacking ${mapProvince(map,to).name}.`;
  else if(a.owner && allied(g,a.owner,b.owner)) summary=`Reinforce ${mapProvince(map,to).name} with ${amount} troops${a.owner!==b.owner?'; ownership of these troops passes to your ally':''}.`;
  else if(gameRules(g).warRequired) summary=`${amount} attackers against ${b.troops} current defenders. Battle begins on arrival and resolves in Risk-style rounds; the winner and losses are uncertain.`;
  else if(amount>b.troops) summary=`Against the current garrison: capture with ${amount-b.troops} surviving troops.`;
  else if(amount===b.troops) summary='Both forces are destroyed; the previous owner keeps the empty province.';
  else summary=`The current defenders survive with ${b.troops-amount} troops.`;
  return {from,to,amount,reserved,warRequired:Boolean(a.owner && !mayEnter(g,a.owner,b.owner)),travelTicks:journeyTicks(g,from,to),arrivesAt:g.tick+1+journeyTicks(g,from,to),available:a.troops-reserved-1,remaining:a.troops-reserved-amount,summary,
    incoming:g.armies.filter(a=>a.to===to),warning:'Current garrison only; not a prediction of dice, future orders, recruitment, or diplomatic changes.'};
}
