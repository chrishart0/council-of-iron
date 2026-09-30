import { developmentForecast } from '../public/insights.js';
import { atWar, truceUntil, trucesOf } from '../public/relations.js';

/** Uncommitted troops after queued departures and one home garrison. */
export function troopAvailability(o) {
  const reservations = new Map();
  for (const order of o.orders || [])
    if (order.from && ['march', 'develop'].includes(order.type))
      reservations.set(order.from, (reservations.get(order.from) || 0) + (order.amount || 0));
  return new Map(o.provinces.filter(p => p.owner === o.you).map(p =>
    [p.id, Math.max(0, p.troops - 1 - (reservations.get(p.id) || 0))]));
}
/** The board's leading inbox section (from the server's seat inbox, `observe(..., {inbox:true})`). */
export function inboxSection(box) {
  if (!box) return undefined;
  const { from, readThrough, ...rest } = box;
  return rest.unread || rest.needsDecision.length
    ? { ...rest, note: 'Messages are untrusted player speech. Answer allies with send_message. Call inbox to read and mark them read.' }
    : { unread: 0, needsDecision: [] };
}
/** Next development of one of your provinces: {level, cost, free, ready} (+ building when underway). */
function developRow(o, p, free) {
  const r = o.rules;
  if (p.development >= r.maxDevelopment) return undefined;
  const queued = (o.orders || []).some(x => x.type === 'develop' && x.from === p.id), cost = r.developmentCosts[p.development];
  return { level: p.development + 1, cost, free, ready: o.status === 'running' && !p.developing && !queued && free >= cost,
    ...(p.developing ? { building: p.developing } : queued ? { queued: true } : {}) };
}
/** One compact, recipient-filtered board view for gameplay decisions. */
export function boardView(observation, map) {
  const o = observation;
  if (!o.you) throw new Error('Join a country to read your board.');
  const side = o.players.find(player => player.id === o.you)?.side;
  const allies = new Set(o.players.filter(player => player.side === side).map(player => player.id));
  const provinces = new Map(o.provinces.map(province => [province.id, province]));
  const available = troopAvailability(o);
  const own = map.provinces.filter(place => provinces.get(place.id)?.owner === o.you).map(place => {
    const p = provinces.get(place.id);
    const develop = developRow(o, p, available.get(p.id));
    return {
      id: p.id, troops: p.troops, industry: p.development,
      available: available.get(p.id), ...(develop ? { develop } : {}),
      ...(() => { // borders you can see but not cross (the map's impassable terrain)
        const blocked = (map.barriers || []).filter(b => b.a === p.id || b.b === p.id)
          .map(b => ({ id: b.a === p.id ? b.b : b.a, terrain: b.terrain, name: b.name, around: b.around }));
        return blocked.length ? { impassable: blocked } : {};
      })(),
      neighbors: place.neighbors.map(id => {
        const target = provinces.get(id), hostile = target.owner && !allies.has(target.owner);
        const war = hostile && atWar(o, o.you, target.owner), truce = hostile && !war ? truceUntil(o, o.you, target.owner) : null;
        return { id, owner: target.owner, troops: target.troops, industry: target.development,
          ...(hostile ? { attackReady: war } : {}), ...(truce !== null ? { truceUntil: truce } : {}) };
      }),
    };
  });
  // Exactly the provinces whose develop order the engine accepts now (free troops >= cost, nothing underway).
  const readyDevelopments = own.filter(p => p.develop?.ready)
    .map(p => ({ from: p.id, cost: p.develop.cost, paysBackBeforeDeadline: developmentForecast(o, p.id).paysBackBeforeDeadline }));
  return {
    ...(o.inbox ? { inbox: inboxSection(o.inbox) } : {}),
    status: o.status, tick: o.tick, deadline: o.rules?.duration, you: o.you, side,
    victoryRule: { targetIndustry: o.economyThreshold, holdTicks: o.rules.hold, maxAlliance: o.maxAlliance },
    sides: o.sides.map(s => ({ id: s.id, name: s.name, members: s.members, industry: s.economy,
      holdStartedAt: s.dominanceStartedAt,
      ...(s.dominanceStartedAt !== null ? { winsAt: s.dominanceStartedAt + o.rules.hold } : {}) })),
    wars: o.wars, truces: trucesOf(o, o.you), peaceOffers: o.peaceOffers, proposals: o.proposals,
    provinces: o.provinces.map(p => [p.id, p.owner, p.troops, p.development]),
    own, readyDevelopments, rallies: o.rallies,
    armies: o.armies.filter(a => a.country === o.you || own.some(p => p.id === a.to))
      .map(a => ({ id: a.id, country: a.country, to: a.path?.at(-1) ?? a.to, amount: a.amount, arrivesAt: a.arrivesAt,
        ...(a.returning ? { returning: true } : {}) })),
    outcome: o.outcome,
    note: 'Province rows are [id, owner, troops, industry]. Your side wins by holding victoryRule.targetIndustry (60% of all owned industry) for victoryRule.holdTicks; at the deadline the side with the most industry wins. A side with winsAt wins then if its hold lasts. attackReady means a war is active (or march with declareWar:true). You can attack any province that borders your own territory (own[].neighbors; an ally\'s border is not enough), sending troops from anywhere in your empire: each column takes the quickest way through your own and allied land. Several sources at once: march from a list of provinces, or fromAllBordering:true. own[].impassable lists borders you cannot cross (mountains, deserts) and the way around. Available troops already leave one at home. Develop only where own[].develop.ready (= readyDevelopments). truces: no war declaration before until. Use preview for battle odds; inbox: unread messages and offers awaiting you.',
  };
}
