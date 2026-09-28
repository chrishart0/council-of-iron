import { boardView } from './board.js';
import { strategicOptions } from './strategic-options.js';

const outcomeTypes = new Set([
  'order_executed', 'order_failed', 'army_departed', 'army_recalled',
  'battle', 'battle_started', 'development_started', 'development_completed',
  'development_cancelled', 'industry_damaged', 'war_declared',
  'peace_accepted', 'alliance_activated', 'departed', 'eliminated',
  'dominance', 'dominance_broken', 'finished',
]);

/** Current recipient-filtered state plus feasible choices and observed results. */
export function decisionView(observation, map) {
  const board = boardView(observation, map);
  const options = strategicOptions(observation, map);
  const side = observation.leaderboard?.alliances?.find(entry => entry.id === board.side);
  const me = observation.leaderboard?.players?.find(entry => entry.country === board.you);
  const targets = options.nearbyTargets.map(target => {
    const sources = target.adjacentSources.filter(source => source.availableNow > 0);
    return {
      id: target.province, owner: target.owner, industry: target.industry,
      defenders: target.currentGarrison, requiresWar: target.requiresWar,
      gapReduction: target.gapReduction,
      earliestArrival: target.earliestArrival,
      sources: sources.map(source => ({ id: source.from, available: source.availableNow,
        travelTicks: source.travelTicks })),
      availableTotal: sources.reduce((sum, source) => sum + source.availableNow, 0),
    };
  }).filter(target => target.sources.length);
  const recentOutcomes = (observation.events || []).filter(event => outcomeTypes.has(event.type))
    .slice(-12).map(event => {
      const result = {};
      for (const key of ['tick', 'type', 'country', 'province', 'from', 'to', 'orderId',
        'owner', 'previousOwner', 'level', 'side', 'winsAt', 'battleId',
        'attackerSide', 'defenderSide', 'before', 'troops', 'duration',
        'casualties', 'industryLost'])
        if (event[key] !== undefined) result[key] = event[key];
      return result;
    });
  return {
    ...board,
    position: {
      ownIndustry: options.ownIndustry, sideIndustry: side?.economy ?? options.ownIndustry,
      industryGap: options.industryGap, sideRank: side?.rank ?? null,
      currentDeadlinePayout: me?.projectedDeadlinePayout ?? null,
      currentVictoryShare: me?.victoryShare ?? null,
      projectedDecisivePayout: me?.projectedDecisivePayout ?? null,
      allianceMaturity: me?.maturity ?? null,
      latestHoldStart: options.latestHoldStart,
    },
    frontier: targets.slice(0, 24), omittedFrontierTargets: Math.max(0, targets.length - 24),
    possiblePartners: options.possibleIndependentPartners.map(partner => ({
      country: partner.country, industry: partner.industry,
      combinedIndustry: partner.combinedIndustry, industryGapTogether: partner.industryGapTogether,
      victoryShareIfJoinedNow: partner.victoryShareIfJoinedNow,
      decisivePrestigeAtFullMaturityIfWon: partner.decisivePrestigeAtFullMaturityIfWon,
    })),
    recentOutcomes, eventCursor: observation.cursor, hasMoreEvents: observation.hasMore,
    decisionNote: 'Frontier sources are your own direct neighbors with uncommitted troops. They are feasible sources, not a combat forecast; capture can damage industry and other orders can change defenders. Enemy-owned targets require an active war before moving. Use preview or plan_attack for a chosen battle, strategic_options for all targets, and news for delivered messages. Outcomes contain only events delivered to your seat and omit player speech. Drain hasMoreEvents before treating outcomes as recent.',
  };
}
