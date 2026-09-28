/** Concise, recipient-filtered view derived solely from the ordinary observation. */
import { troopAvailability } from './board.js';
export function situation(observation) {
  const o = observation;
  const mine = new Set(o.provinces.filter(p => p.owner === o.you).map(p => p.id));
  const available = troopAvailability(o);
  const mySide = o.players.find(p => p.id === o.you)?.side;
  const significant = new Set(['message', 'war_declared', 'peace_accepted', 'peace_offered',
    'alliance_activated', 'departed', 'proposal_created', 'proposal_accepted', 'proposal_declined',
    'finished', 'dominance', 'dominance_broken']);
  return {
    id: o.id, status: o.status, tick: o.tick, you: o.you, side: mySide,
    deadline: o.rules?.duration, economyThreshold: o.economyThreshold,
    commandBudget: o.commandBudget, dominance: o.dominance,
    players: o.players.map(p => ({ id: p.id, side: p.side, eliminatedAt: p.eliminatedAt })),
    alliances: o.leaderboard?.alliances.map(a => ({ id: a.id, members: a.members,
      economy: a.economy, rank: a.rank, dominanceStartedAt: a.dominanceStartedAt })) || [],
    provinces: o.provinces.map(p => ({ id: p.id, owner: p.owner, troops: p.troops,
      development: p.development, ...(p.developing ? { developing: p.developing } : {}),
      ...(p.owner === o.you ? { available: available.get(p.id), ...(p.route ? { route: p.route } : {}) } : {}) })),
    armies: o.armies.filter(a => a.country === o.you || mine.has(a.to)).map(a => ({
      id: a.id, country: a.country, from: a.from, to: a.to, amount: a.amount,
      arrivesAt: a.arrivesAt, returning: a.returning, engaged: a.engaged })),
    battles: o.battles.filter(b => mine.has(b.province) || b.attackerSide === mySide).map(b => ({
      id: b.id, province: b.province, attackerSide: b.attackerSide, previousOwner: b.previousOwner,
      engaged: b.engaged, casualties: b.casualties, lastRound: b.lastRound })),
    wars: o.wars, proposals: o.proposals, diplomacy: o.diplomacy,
    events: o.events.filter(e => significant.has(e.type) ||
      e.country === o.you && ['battle_started', 'battle', 'army_departed', 'army_recalled'].includes(e.type)),
    cursor: o.cursor, hasMore: o.hasMore, outcome: o.outcome,
  };
}
