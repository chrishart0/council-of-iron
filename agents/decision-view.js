import { boardView } from './board.js';

const outcomeTypes = new Set([
  'order_executed', 'order_failed', 'army_departed', 'army_recalled', 'army_advancing', 'army_turned_around',
  'battle', 'battle_started', 'development_started', 'development_completed',
  'development_cancelled', 'war_declared', 'peace_accepted', 'alliance_activated',
  'departed', 'eliminated', 'dominance', 'dominance_broken', 'finished',
]);

/** Your provinces grouped by friendly routes: marches and rallies path through own or allied provinces that are
 * not battlefields (friendlyPath in public/movement.js), so a source reaches only targets in or beside its group. */
function connectedGroups(o) {
  const side = new Map(o.players.map(p => [p.id, p.side])), mySide = side.get(o.you);
  const battles = new Set((o.battles || []).map(b => b.province));
  const passable = new Set(o.provinces.filter(p => p.owner && side.get(p.owner) === mySide && !battles.has(p.id)).map(p => p.id));
  const own = new Set(o.provinces.filter(p => p.owner === o.you).map(p => p.id)), seen = new Set(), groups = [];
  for (const start of [...own].sort()) {
    if (seen.has(start)) continue;
    const group = [], queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift();
      if (own.has(id)) group.push(id);
      if (id !== start && !passable.has(id)) continue; // an own battlefield is reachable but not a way through
      for (const next of Object.keys(o.travelTimes[id] || {}))
        if (!seen.has(next) && (passable.has(next) || own.has(next))) { seen.add(next); queue.push(next); }
    }
    groups.push(group.sort());
  }
  return groups;
}
/** Current recipient-filtered state plus feasible choices and observed results. */
export function decisionView(observation, map) {
  const board = boardView(observation, map);
  const industry = new Map(observation.provinces.map(p => [p.id, p.development]));
  const ownIndustry = observation.provinces.filter(p => p.owner === board.you).reduce((n, p) => n + p.development, 0);
  const sides = [...board.sides].sort((a, b) => b.industry - a.industry);
  const side = sides.find(s => s.id === board.side);
  const byTarget = new Map();
  for (const own of board.own) for (const n of own.neighbors) {
    // Frontier = neutral land or another side's province bordering your own (allied land is for reinforcement, not listed).
    if (n.owner === board.you || n.owner && n.attackReady === undefined) continue;
    const entry = byTarget.get(n.id) || { id: n.id, owner: n.owner, industry: n.industry, defenders: n.troops,
      requiresWar: n.attackReady === false, ...(n.truceUntil ? { truceUntil: n.truceUntil } : {}), sources: [] };
    if (own.available) entry.sources.push({ id: own.id, available: own.available, travelTicks: observation.travelTimes[own.id][n.id] });
    byTarget.set(n.id, entry);
  }
  const targets = [...byTarget.values()].map(t => ({ ...t, earliestArrival: t.sources.length ? observation.tick + 1 + Math.min(...t.sources.map(s => s.travelTicks)) : null,
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
  const { inbox, status, tick, you, victoryRule, readyDevelopments, ...boardDetail } = board;
  const groups = connectedGroups(observation);
  return {
    ...(inbox ? { inbox } : {}),
    status, tick, you,
    position: {
      ownIndustry, sideIndustry: side?.industry ?? ownIndustry,
      industryGap: Math.max(0, board.victoryRule.targetIndustry - (side?.industry ?? ownIndustry)),
      sideRank: side ? sides.findIndex(s => s.industry === side.industry) + 1 : null,
      allianceSize: side?.members.length ?? 1,
      // Who wins at the deadline if nothing changes: the side with the most industry (you, when you lead).
      ticksLeft: Math.max(0, (observation.rules?.duration ?? tick) - tick),
      ...(sides[0] && sides[0].id !== board.side && sides[0].industry > (side?.industry ?? ownIndustry)
        ? { leader: { members: sides[0].members, industry: sides[0].industry } } : {}),
    },
    victoryRule, readyDevelopments,
    frontier: targets.slice(0, 24), omittedFrontierTargets: Math.max(0, targets.length - 24),
    ...(groups.length > 1 ? { connectedGroups: groups } : {}),
    possiblePartners: board.sides.filter(s => s.members.length === 1 && s.id !== board.side)
      .map(s => ({ country: s.members[0], industry: s.industry, combinedIndustry: (side?.industry ?? ownIndustry) + s.industry,
        // Borders between your provinces and theirs: a neighbouring ally can reinforce you, a distant one cannot.
        sharedBorderLinks: board.own.reduce((n, p) => n + p.neighbors.filter(x => x.owner === s.members[0]).length, 0) })),
    recentOutcomes, eventCursor: observation.cursor, hasMoreEvents: observation.hasMore,
    ...boardDetail,
    decisionNote: 'position.leader (present only when another side has more industry than yours) is the side that wins at the deadline if nothing changes, even without reaching 60%; ticksLeft counts down to it. Frontier targets are the provinces you can attack: each borders your own territory (an ally\'s border is not enough). sources lists your bordering provinces with free troops; troops may also come from your other provinces (march sources:[...] routes through your and allied land, all arriving together). connectedGroups appears only when your land is split: a march or rally from one group reaches only provinces in that group or bordering it, so choose sources and rally points in the same group. Attack from every bordering province at once with march {to, fromAllBordering:true, percent}. requiresWar means declare war first (or march with declareWar:true); truceUntil means no declaration before that tick. This is not a combat forecast: use preview for a chosen battle. Outcomes contain only events delivered to your seat and omit player speech: inbox (first) lists unread messages and offers waiting on you. Drain hasMoreEvents before treating outcomes as recent.',
  };
}
