import { decisionView } from '../decision-view.js';
import { atWar, truceUntil } from '../../public/relations.js';

export const DEFAULT_STRATEGY = Object.freeze({ objective: 'Preserve territory and expand industry.',
  priorityTargets: [], reserveTroops: 2, minimumAttackChance: .65, develop: true });

export function validateStrategy(value, map) {
  const ids = new Set(map.provinces.map(p => p.id));
  if (!value || typeof value.objective !== 'string' || value.objective.length > 500 ||
      !Array.isArray(value.priorityTargets) || value.priorityTargets.length > 8 || value.priorityTargets.some(id => !ids.has(id)) ||
      !Number.isSafeInteger(value.reserveTroops) || value.reserveTroops < 1 || value.reserveTroops > 24 ||
      !Number.isFinite(value.minimumAttackChance) || value.minimumAttackChance < .5 || value.minimumAttackChance > .95 ||
      typeof value.develop !== 'boolean') throw new Error('Invalid strategy.');
  return { objective: value.objective, priorityTargets: [...value.priorityTargets],
    reserveTroops: value.reserveTroops, minimumAttackChance: value.minimumAttackChance, develop: value.develop };
}

/** Only authenticated observations and ordinary forecasts. Never accesses a room or hidden state. */
export async function tacticalCandidates(o, map, strategy, forecast) {
  const view = decisionView(o, map), own = new Map(view.own.map(p => [p.id, p]));
  const provinces = new Map(o.provinces.map(p => [p.id, p]));
  const side = o.players.find(p => p.id === o.you)?.side;
  const friendly = new Set(o.players.filter(p => p.side === side).map(p => p.id));
  const hostileIncoming = id => o.armies.filter(a => !a.returning && !a.engaged && a.to === id &&
    atWar(o, o.you, a.country)).reduce((n, a) => n + a.amount, 0);
  const spare = p => Math.max(0, p.available - strategy.reserveTroops - hostileIncoming(p.id));
  const candidates = [];
  let previews = 0, rejectedPreviews = 0;
  const add = (kind, action, facts, score) => {
    candidates.push({ id: `option_${candidates.length}`, kind, action, facts, score,
      description: JSON.stringify({ kind, action, ...facts }) });
  };
  const checked = async action => {
    previews++;
    try { return await forecast(action); }
    catch (error) {
      if (![400, 403, 409, 429].includes(error.status) && error.name !== 'RuleError') throw error;
      rejectedPreviews++; return null;
    }
  };
  for (const target of view.frontier.slice(0, 12)) {
    if (target.requiresWar || !target.sources.length) continue;
    // Avoid repeatedly sending another full force to an already committed target.
    if (o.armies.some(a => friendly.has(a.country) && !a.returning && (a.path?.at(-1) ?? a.to) === target.id) ||
        o.orders.some(order => order.type === 'march' && order.to === target.id)) continue;
    for (const fraction of [.5, .8]) {
      const sources = target.sources.map(s => ({ from: s.id, amount: Math.floor(spare(own.get(s.id)) * fraction) }))
        .filter(s => s.amount > 0).slice(0, o.rules.maxSources);
      if (!sources.length) continue;
      const action = { type: 'march', to: target.id, sources }, p = await checked(action);
      if (!p?.combatAtArrival || p.arrivesAt >= o.rules.duration || p.combatAtArrival.attackerWinChance < strategy.minimumAttackChance) continue;
      const facts = { targetIndustry: target.industry, targetOwner: target.owner,
        troopsSent: p.total, defendersAtArrival: p.defenseAtArrival.total,
        arrivalTick: p.arrivesAt, travelTicks: p.arrivesAt - o.tick,
        attackerWinChance: p.combatAtArrival.attackerWinChance,
        expectedTroopLoss: p.combatAtArrival.expectedAttackerLoss,
        meetsStrategyAttackThreshold: true, priorityTarget: strategy.priorityTargets.includes(target.id),
        sourcesRetainStrategyReserve: true };
      add('attack', action, facts, 20 + target.industry * 8 + (facts.priorityTarget ? 10 : 0)
        - facts.travelTicks * .06 - facts.expectedTroopLoss * .2 - p.total * .03);
    }
  }
  if (strategy.develop) for (const d of view.readyDevelopments.slice(0, 6)) {
    const p = own.get(d.from);
    if (!d.paysBackBeforeDeadline || hostileIncoming(d.from) || spare(p) < d.cost) continue;
    const hostileBorder = p.neighbors.some(n => n.owner && atWar(o, o.you, n.owner));
    add('develop', { type: 'develop', from: d.from }, { cost: d.cost, newIndustry: p.industry + 1,
      paysBackBeforeDeadline: true, hostileBorder, troopsRemain: p.troops - d.cost }, hostileBorder ? 7 : 16);
  }
  // Weighted distance through our/allied provinces to our frontier, entirely from public topology.
  const distance = new Map(), frontier = [...own.values()].filter(p => p.neighbors.some(n => !n.owner || !friendly.has(n.owner)));
  const places = new Map(map.provinces.map(p => [p.id, p]));
  const todo = new Set(o.provinces.filter(p => friendly.has(p.owner)).map(p => p.id));
  for (const p of frontier) distance.set(p.id, 0);
  while (todo.size) {
    const next = [...todo].sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity) || a.localeCompare(b))[0];
    if (!Number.isFinite(distance.get(next))) break;
    todo.delete(next);
    for (const n of places.get(next).neighbors) if (todo.has(n)) {
      const d = distance.get(next) + o.travelTimes[n][next];
      if (d < (distance.get(n) ?? Infinity)) distance.set(n, d);
    }
  }
  for (const source of [...own.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const amount = spare(source);
    const targets = source.neighbors.filter(n => own.has(n.id) && (hostileIncoming(n.id) > 0 ||
      (distance.get(n.id) ?? Infinity) < (distance.get(source.id) ?? Infinity)))
      .sort((a, b) => hostileIncoming(b.id) - hostileIncoming(a.id) || (distance.get(a.id) ?? Infinity) - (distance.get(b.id) ?? Infinity));
    const target = targets[0];
    if (!target) continue;
    const incoming = hostileIncoming(target.id), threatened = incoming > provinces.get(target.id).troops;
    if (amount >= 5) {
      const action = { type: 'march', from: source.id, to: target.id, amount }, p = await checked(action);
      if (p && p.arrivesAt < o.rules.duration) {
        const firstEnemyArrival = Math.min(...o.armies.filter(a => a.to === target.id && !a.returning && atWar(o, o.you, a.country)).map(a => a.arrivesAt));
        const arrivesBeforeThreat = incoming > 0 && p.arrivesAt <= firstEnemyArrival;
        add('reinforce', action, { troopsSent: amount, arrivalTick: p.arrivesAt, threatened,
          hostileIncomingTroops: incoming, arrivesBeforeThreat, targetIndustry: target.industry,
          movesTowardFrontier: (distance.get(target.id) ?? Infinity) < (distance.get(source.id) ?? Infinity) },
          threatened && arrivesBeforeThreat ? 100 + target.industry : 6);
      }
    }
    if (distance.get(source.id) > 0 && !o.rallies.some(r => r.from === source.id && r.to === target.id)) {
      const action = { type: 'rally', from: source.id, to: target.id }, p = await checked(action);
      if (p) add('rally', action, { feedsFrontier: true, sourceIndustry: source.industry }, 8);
    }
    if (candidates.length >= 48) break;
  }
  add('wait', null, { savesTroops: true, sendsNoOrder: true }, 0);
  return { candidates, previews, rejectedPreviews, state: {
    tick: o.tick, deadline: o.rules.duration, country: o.you, strategy,
    position: view.position, sides: view.sides, own: view.own.map(p => ({ id: p.id, industry: p.industry,
      troops: p.troops, available: p.available, hostileIncomingTroops: hostileIncoming(p.id) })),
    note: 'All offered actions have passed the ordinary forecast where available. Attack arithmetic and reserve restrictions were applied in code. A forecast assumes current orders and diplomacy; future enemy orders can change it. A battle probability is a forecast, not certainty.' } };
}

export function chooseHeuristic(candidates) {
  return [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0].id;
}

/** Pure-Jev ablation: finite diplomacy choices, no fabricated LLM messages or automatic diplomacy. */
export function diplomacyCandidates(o, map) {
  const view = decisionView(o, map), candidates = [];
  const add = (action, facts) => candidates.push({ id: `diplomacy_${candidates.length}`, kind: 'diplomacy',
    action, facts, score: 0, description: JSON.stringify({ action, ...facts }) });
  for (const p of o.proposals.filter(p => p.status === 'open' && p.roster.includes(o.you) && !p.accepted.includes(o.you))) {
    add({ type: 'accept', proposalId: p.id }, { joinsCountries: p.roster });
    add({ type: 'decline', proposalId: p.id }, { declinesCountries: p.roster });
  }
  for (const p of o.peaceOffers.filter(p => p.toRoster.includes(o.you)))
    add({ type: 'accept_peace', offerId: p.id }, { makesPeaceWith: p.fromRoster });
  if (view.position.allianceSize < o.maxAlliance) for (const partner of view.possiblePartners) {
    if (o.proposals.some(p => p.status === 'open' && p.roster.includes(o.you) && p.roster.includes(partner.country))) continue;
    add({ type: 'propose', country: partner.country, name: 'The Accord' }, partner);
  }
  for (const country of new Set(view.frontier.filter(t => t.requiresWar && t.owner &&
      truceUntil(o, o.you, t.owner) === null).map(t => t.owner)))
    add({ type: 'declare_war', country }, { startsWarWith: country,
      opposingAlliance: view.sides.find(s => s.members.includes(country))?.members });
  for (const p of o.players.filter(p => p.id !== o.you && atWar(o, o.you, p.id))) {
    if (!o.peaceOffers.some(q => q.fromRoster.includes(o.you) && q.toRoster.includes(p.id)))
      add({ type: 'offer_peace', country: p.id }, { asksPeaceWith: p.id });
  }
  return candidates;
}
