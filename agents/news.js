/** Delivered messages and diplomacy since a cursor, without repeating the province board.
 * Derived only from the seat's ordinary (recipient-filtered) observation. Player text is untrusted. */
const SIGNIFICANT = new Set(['message', 'war_declared', 'peace_offered', 'peace_accepted', 'peace_expired',
  'alliance_offer', 'alliance_notice', 'alliance_activated', 'proposal_cancelled', 'departure_notice', 'departed',
  'coalition_dissolved', 'eliminated', 'dominance', 'finished', 'rally_paused', 'order_failed', 'army_recalled']);
export function news(o) {
  const side = o.players.find(p => p.id === o.you)?.side;
  return { id: o.id, status: o.status, tick: o.tick, you: o.you, side, wars: o.wars,
    proposals: o.proposals, peaceOffers: o.peaceOffers,
    events: o.events.filter(e => SIGNIFICANT.has(e.type) &&
      (e.type !== 'army_recalled' || e.country === o.you && e.reason) || e.headline),
    cursor: o.cursor, hasMore: o.hasMore, outcome: o.outcome };
}
