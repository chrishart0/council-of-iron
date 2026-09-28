import { developmentForecast } from '../public/insights.js';

/** Uncommitted troops after queued departures and one home garrison. */
export function troopAvailability(o) {
  const reservations = new Map();
  for (const order of o.orders || [])
    if (order.from && ['march', 'develop'].includes(order.type))
      reservations.set(order.from, (reservations.get(order.from) || 0) + (order.amount || 0));
  return new Map(o.provinces.filter(p => p.owner === o.you).map(p =>
    [p.id, Math.max(0, p.troops - 1 - (reservations.get(p.id) || 0))]));
}
/** One compact, recipient-filtered board view for gameplay decisions. */
export function boardView(observation, map) {
  const o = observation;
  if (!o.you) throw new Error('Join a country to read your board.');
  const side = o.players.find(player => player.id === o.you)?.side;
  const allies = new Set(o.players.filter(player => player.side === side).map(player => player.id));
  const provinces = new Map(o.provinces.map(province => [province.id, province]));
  const available = troopAvailability(o);
  const atWar = owner => owner && o.wars.includes([o.you, owner].sort().join(':'));
  const own = map.provinces.filter(place => provinces.get(place.id)?.owner === o.you).map(place => {
    const p = provinces.get(place.id);
    return {
      id: p.id, troops: p.troops, industry: p.development,
      available: available.get(p.id),
      neighbors: place.neighbors.map(id => {
        const target = provinces.get(id);
        return { id, owner: target.owner, troops: target.troops, industry: target.development,
          ...(target.owner && !allies.has(target.owner) ? { attackReady: Boolean(atWar(target.owner)) } : {}) };
      }),
    };
  });
  const readyDevelopments = o.status === 'running'
    ? own.flatMap(p => {
      const forecast = developmentForecast(o, p.id);
      return forecast && !forecast.alreadyInvested && !forecast.queued && p.available >= forecast.cost
        ? [{ from: p.id, cost: forecast.cost, paysBackBeforeDeadline: forecast.paysBackBeforeDeadline }] : [];
    }) : [];
  return {
    status: o.status, tick: o.tick, deadline: o.rules?.duration, you: o.you, side,
    victoryRule: { targetIndustry: o.economyThreshold, holdTicks: o.rules.hold, maxAlliance: o.maxAlliance },
    sides: o.sides.map(s => ({ id: s.id, name: s.name, members: s.members, industry: s.economy,
      holdStartedAt: s.dominanceStartedAt,
      ...(s.dominanceStartedAt !== null ? { winsAt: s.dominanceStartedAt + o.rules.hold } : {}) })),
    wars: o.wars, peaceOffers: o.peaceOffers, proposals: o.proposals,
    provinces: o.provinces.map(p => [p.id, p.owner, p.troops, p.development]),
    own, readyDevelopments, rallies: o.rallies,
    armies: o.armies.filter(a => a.country === o.you || own.some(p => p.id === a.to))
      .map(a => ({ id: a.id, country: a.country, to: a.path?.at(-1) ?? a.to, amount: a.amount, arrivesAt: a.arrivesAt,
        ...(a.returning ? { returning: true } : {}) })),
    outcome: o.outcome,
    note: 'Province rows are [id, owner, troops, industry]. Your side wins by holding victoryRule.targetIndustry (60% of all owned industry) for victoryRule.holdTicks; at the deadline the side with the most industry wins. A side with winsAt wins then if its hold lasts. attackReady means a war is active (or march with declareWar:true). March to any neighbor, or through your own/allied land to anything beyond it. Available troops already leave one at home. Develop only from readyDevelopments. Use preview for battle odds and news for messages.',
  };
}
