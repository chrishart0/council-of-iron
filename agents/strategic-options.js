/** Explain victory routes using only the ordinary, recipient-filtered observation.
 * These are static board comparisons, not forecasts of combat or diplomacy.
 */
import { developmentForecast } from '../public/insights.js';

export function strategicOptions(state, map) {
  if (!state.you) throw new Error('Join a country to inspect your strategic options.');
  const me = state.players.find(p => p.id === state.you);
  if (!me) throw new Error('Your seat is missing from this observation.');
  const sides = new Map(state.players.map(p => [p.id, p.side]));
  const ownRoster = state.players.filter(p => p.side === me.side).map(p => p.id);
  const ownMembers = new Set(ownRoster);
  const board = new Map(state.provinces.map(p => [p.id, p]));
  const geography = new Map(map.provinces.map(p => [p.id, p]));
  const industry = new Map(state.players.map(p => [p.id, 0]));
  let total = 0;
  for (const p of state.provinces) if (p.owner) {
    total += p.development;
    industry.set(p.owner, (industry.get(p.owner) || 0) + p.development);
  }
  const own = ownRoster.reduce((n, id) => n + (industry.get(id) || 0), 0);
  const share = state.rules.economyShare ?? .6;
  const threshold = Math.ceil(total * share);
  const gap = Math.max(0, threshold - own);
  const hold = state.rules.hold;
  const latestHoldStart = state.rules.duration - hold;
  const ownProvinces = state.provinces.filter(p => p.owner === state.you);
  const reserved = new Map();
  for (const order of state.commandBudget?.reserved || [])
    if (['move', 'develop', 'transit'].includes(order.type) && order.from)
      reserved.set(order.from, (reserved.get(order.from) || 0) + (order.amount || 0));
  const developmentChoices = ownProvinces.map(p => {
    const forecast = developmentForecast(state, p.id);
    if (!forecast) return null;
    const availableNow = Math.max(0, p.troops - 1 - (reserved.get(p.id) || 0));
    return { ...forecast, availableNow,
      manpowerReady: availableNow >= forecast.cost && !forecast.alreadyInvested && !forecast.queued,
      commandReady: (state.commandBudget?.remaining || 0) > 0 };
  }).filter(Boolean);
  const targets = [];
  for (const target of state.provinces) {
    if (target.owner && ownMembers.has(target.owner)) continue;
    const sources = ownProvinces.filter(p => geography.get(p.id)?.neighbors.includes(target.id));
    if (!sources.length) continue;
    const owned = Boolean(target.owner);
    const afterTotal = total + (owned ? 0 : target.development);
    const afterThreshold = Math.ceil(afterTotal * share);
    const afterGap = Math.max(0, afterThreshold - own - target.development);
    const reach = sources.map(p => ({
      from: p.id,
      availableNow: Math.max(0, p.troops - 1 - (reserved.get(p.id) || 0)),
      travelTicks: state.travelTimes?.[p.id]?.[target.id] ?? null
    })).sort((a, b) => (a.travelTicks ?? Infinity) - (b.travelTicks ?? Infinity));
    targets.push({
      province: target.id, owner: target.owner, ownerSide: target.owner ? sides.get(target.owner) : null,
      industry: target.development, currentGarrison: target.troops,
      atWar: owned ? (state.wars || []).includes([state.you, target.owner].sort().join(':')) : false,
      requiresWar: owned && Boolean(state.rules.warRequired) &&
        !(state.wars || []).includes([state.you, target.owner].sort().join(':')),
      industryGapAfterCapture: afterGap, gapReduction: gap - afterGap,
      earliestArrival: reach[0].travelTicks === null ? null : state.tick + 1 + reach[0].travelTicks,
      canArriveBeforeLatestHoldStart: reach[0].travelTicks !== null &&
        state.tick + 1 + reach[0].travelTicks <= latestHoldStart,
      adjacentSources: reach
    });
  }
  targets.sort((a, b) => b.gapReduction - a.gapReduction ||
    Number(Boolean(b.owner)) - Number(Boolean(a.owner)) ||
    (a.earliestArrival ?? Infinity) - (b.earliestArrival ?? Infinity) ||
    a.province.localeCompare(b.province));
  const partners = state.players.filter(p => p.side !== me.side && p.side.startsWith('solo:') && p.eliminatedAt === null)
    .map(p => ({country: p.id, industry: industry.get(p.id) || 0,
      combinedIndustry: own + (industry.get(p.id) || 0),
      industryGapTogether: Math.max(0, threshold - own - (industry.get(p.id) || 0))}))
    .sort((a, b) => a.industryGapTogether - b.industryGapTogether || a.country.localeCompare(b.country));
  return {
    status: state.status, tick: state.tick, country: state.you, side: me.side,
    ownIndustry: own, totalIndustry: total, decisiveThreshold: threshold, industryGap: gap,
    holdTicks: hold, latestHoldStart, ticksUntilLatestStart: Math.max(0, latestHoldStart - state.tick),
    holdStillStartable: state.tick <= latestHoldStart,
    currentDeadlinePayout: state.leaderboard?.players.find(p => p.country === state.you)?.projectedDeadlinePayout ?? null,
    nearbyTargets: targets, developmentChoices, possibleIndependentPartners: partners,
    assumptions: 'Static public board only. Capture comparisons assume the current industry level survives, no other province changes, and your side keeps the target. Adjacent sources are your own uncommitted garrisons; they are not an attack plan. Defenders, recruitment, travel, orders, war votes, alliance notice, tenure, and other players can change before arrival. Use plan_attack or preview for a chosen target.'
  };
}
