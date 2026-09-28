import { boardView } from './board.js';

const outcomeTypes = new Set([
  'order_executed', 'order_failed', 'army_departed', 'army_recalled', 'army_turned_around',
  'battle', 'battle_started', 'development_started', 'development_completed',
  'development_cancelled', 'war_declared', 'peace_accepted', 'alliance_activated',
  'departed', 'eliminated', 'dominance', 'dominance_broken', 'finished',
]);

/** Current recipient-filtered state plus feasible choices and observed results. */
export function decisionView(observation, map) {
  const board = boardView(observation, map);
  const industry = new Map(observation.provinces.map(p => [p.id, p.development]));
  const ownIndustry = observation.provinces.filter(p => p.owner === board.you).reduce((n, p) => n + p.development, 0);
  const sides = [...board.sides].sort((a, b) => b.industry - a.industry);
  const side = sides.find(s => s.id === board.side);
  const byTarget = new Map();
  for (const own of board.own) for (const n of own.neighbors) {
    // Frontier = neutral land or another side's province (allied land is for reinforcement, not listed).
    if (n.owner === board.you || !own.available || n.owner && n.attackReady === undefined) continue;
    const entry = byTarget.get(n.id) || { id: n.id, owner: n.owner, industry: n.industry, defenders: n.troops,
      requiresWar: n.attackReady === false, sources: [] };
    entry.sources.push({ id: own.id, available: own.available, travelTicks: observation.travelTimes[own.id][n.id] });
    byTarget.set(n.id, entry);
  }
  const targets = [...byTarget.values()].map(t => ({ ...t, earliestArrival: observation.tick + 1 + Math.min(...t.sources.map(s => s.travelTicks)),
      availableTotal: t.sources.reduce((n, s) => n + s.available, 0) }))
    .sort((a, b) => (industry.get(b.id) - industry.get(a.id)) || a.defenders - b.defenders || a.id.localeCompare(b.id));
  const recentOutcomes = (observation.events || []).filter(event => outcomeTypes.has(event.type))
    .slice(-12).map(event => {
      const result = {};
      for (const key of ['tick', 'type', 'country', 'province', 'from', 'to', 'orderId', 'armyId',
        'owner', 'previousOwner', 'level', 'side', 'winsAt', 'battleId',
        'attackerSide', 'defenderSide', 'before', 'troops', 'duration', 'casualties', 'amount', 'arrivesAt'])
        if (event[key] !== undefined) result[key] = event[key];
      return result;
    });
  return {
    ...board,
    position: {
      ownIndustry, sideIndustry: side?.industry ?? ownIndustry,
      industryGap: Math.max(0, board.victoryRule.targetIndustry - (side?.industry ?? ownIndustry)),
      sideRank: side ? sides.findIndex(s => s.industry === side.industry) + 1 : null,
      allianceSize: side?.members.length ?? 1,
    },
    frontier: targets.slice(0, 24), omittedFrontierTargets: Math.max(0, targets.length - 24),
    possiblePartners: board.sides.filter(s => s.members.length === 1 && s.id !== board.side)
      .map(s => ({ country: s.members[0], industry: s.industry, combinedIndustry: (side?.industry ?? ownIndustry) + s.industry })),
    recentOutcomes, eventCursor: observation.cursor, hasMoreEvents: observation.hasMore,
    decisionNote: 'Frontier targets are direct neighbours of your provinces with free troops; requiresWar means declare war first (or march with declareWar:true). They are feasible sources, not a combat forecast: use preview for a chosen battle. Longer marches through your and allied land are also possible. Outcomes contain only events delivered to your seat and omit player speech; use news for messages. Drain hasMoreEvents before treating outcomes as recent.',
  };
}
