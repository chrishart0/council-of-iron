/** One compact, recipient-filtered board view for gameplay decisions. */
export function boardView(observation, map) {
  const o = observation;
  if (!o.you) throw new Error('Join a country to read your board.');
  const side = o.players.find(player => player.id === o.you)?.side;
  const allies = new Set(o.players.filter(player => player.side === side).map(player => player.id));
  const provinces = new Map(o.provinces.map(province => [province.id, province]));
  const reservations = new Map();
  for (const order of o.commandBudget?.reserved || [])
    if (order.from && ['move', 'transit', 'develop'].includes(order.type))
      reservations.set(order.from, (reservations.get(order.from) || 0) + (order.amount || 0));
  const atWar = owner => owner && (o.wars || []).includes([o.you, owner].sort().join(':'));
  const own = map.provinces.filter(place => provinces.get(place.id)?.owner === o.you).map(place => {
    const p = provinces.get(place.id);
    return {
      id: p.id, troops: p.troops, industry: p.development,
      available: Math.max(0, p.troops - 1 - (reservations.get(p.id) || 0)),
      neighbors: place.neighbors.map(id => {
        const target = provinces.get(id);
        return { id, owner: target.owner, troops: target.troops, industry: target.development,
          ...(target.owner && !allies.has(target.owner) ? { attackReady: Boolean(atWar(target.owner)) } : {}) };
      }),
    };
  });
  return {
    status: o.status, tick: o.tick, deadline: o.rules?.duration, you: o.you, side,
    commandBudget: { remaining: o.commandBudget?.remaining ?? 0,
      nextRecoveryAt: o.commandBudget?.nextRecoveryAt ?? null },
    economyThreshold: o.economyThreshold,
    sides: (o.leaderboard?.alliances || []).map(a => ({ members: a.members, industry: a.economy,
      holdStartedAt: a.dominanceStartedAt })),
    wars: o.wars, diplomacy: o.diplomacy, proposals: o.proposals,
    provinces: o.provinces.map(p => [p.id, p.owner, p.troops, p.development]),
    own,
    armies: o.armies.filter(a => a.country === o.you || own.some(p => p.id === a.to))
      .map(a => ({ id: a.id, country: a.country, to: a.to, amount: a.amount, arrivesAt: a.arrivesAt })),
    outcome: o.outcome,
    note: 'Province rows are [id, owner, troops, industry]. Own neighbors are direct legal connections; attackReady means a war is active. Available troops account for current reservations and one home garrison. Check preview for battle odds and situation for delivered messages.',
  };
}
