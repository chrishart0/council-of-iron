/** World feed model (v0.6), shared by the engine, browser and agents. Pure: no DOM, clock or I/O.
 * The engine classifies each public event ONCE (`event.headline`); this module only merges
 * already-classified records with public world chat and formats client copy. It never
 * re-derives a headline, so every client sees the same items in the same order.
 */
export const isWorldMessage = e => e.type === 'message' && e.channel === 'world' && !e.recipients;

/** Merge public events (optionally carrying `headline`) and stopped victory holds by `seq`.
 * A stopped hold has no event ID; its `seq` is the last event ID of the tick that stopped it,
 * so it sorts immediately after that tick's events. */
export function feedItems(events, breaks = [], after = 0) {
  const items = [];
  for (const e of events) if (e.id > after && (e.headline || isWorldMessage(e))) items.push({ ...e, seq: e.id });
  for (const b of breaks) if (Number.isSafeInteger(b.seq) && b.seq > after && b.headline)
    items.push({ id: null, seq: b.seq, tick: b.tick, type: 'dominance_broken', side: b.side,
      economy: b.economy, threshold: b.threshold, headline: b.headline });
  return items.sort((a, b) => a.seq - b.seq || (a.id === null) - (b.id === null) ||
    String(a.side ?? '').localeCompare(String(b.side ?? '')));
}

/** Page without splitting records that share one cursor value. */
export function feedPage(items, limit, sequence) {
  if (items.length <= limit) return { items, cursor: sequence, hasMore: false };
  let end = limit;
  while (end < items.length && items[end].seq === items[end - 1].seq) end++;
  const page = items.slice(0, end);
  return end < items.length ? { items: page, cursor: page.at(-1).seq, hasMore: true } : { items: page, cursor: sequence, hasMore: false };
}

const list = (ids, name) => ids.map(name).join(' + ');
/** Plain-text copy for one headline. Callers must still render it as text: an alliance
 * name is player speech. `names` supplies country/province/side labels and a clock format. */
export function headlineCopy(item, names) {
  const h = item.headline, c = names.country, p = names.province, s = names.side;
  switch (h.kind) {
    case 'war': return { tone: 'war', icon: 'war', title: 'War declared',
      detail: `${list(h.from, c)} declared war on ${list(h.to, c)}.`, focus: { country: h.to[0] } };
    case 'peace': return { tone: 'peace', icon: 'treaty', title: 'War ended',
      detail: `${list(h.from, c)} and ${list(h.to, c)} signed peace.`, focus: { country: h.from[0] } };
    case 'alliance': return { tone: 'alliance', icon: 'ribbon', title: 'Alliance formed',
      detail: `${item.name ?? s(h.side)}: ${list(h.countries, c)}.`, focus: { country: h.countries[0] } };
    case 'departure': return { tone: 'broken', icon: 'council', title: 'Alliance changed',
      detail: `${c(h.country)} left ${s(h.side)}.`, focus: { country: h.country } };
    case 'dissolved': return { tone: 'broken', icon: 'council', title: 'Alliance dissolved',
      detail: `${s(h.side)} no longer exists.`, focus: null };
    case 'eliminated': return { tone: 'fallen', icon: 'fallen', title: `${c(h.country)} has fallen`,
      detail: `${c(h.country)} is eliminated: no provinces or armies remain.`, focus: { country: h.country } };
    case 'dominance': return { tone: 'victory', icon: 'laurel', title: 'Victory countdown',
      detail: `${s(h.side)} holds enough of the world's industry to win at ${names.time(h.winsAt)} unless stopped.`, focus: null };
    case 'dominance_broken': return { tone: 'broken', icon: 'laurel', title: 'Countdown stopped',
      detail: `${s(h.side)}${h.cause === 'membership' ? '’s membership changed; the hold restarts.' : ` fell below the threshold (${h.economy}/${h.threshold} industry).`}`, focus: null };
    case 'finished': return { tone: 'victory', icon: 'laurel', title: 'Match concluded',
      detail: h.draw ? 'The match ends in a draw.' : `${s(h.winningSide)} wins.`, focus: null };
    case 'industry_up': return { tone: 'industry', icon: 'gear', title: 'Industry built',
      detail: `${p(h.province)} reaches industrial level ${h.level}${h.country ? ` for ${c(h.country)}` : ''}.`, focus: { province: h.province } };
    case 'major_battle': return { tone: 'battle', icon: 'military', title: `Major battle at ${p(h.province)}`,
      detail: `${h.casualties} troops lost${h.captured ? `; ${h.owner ? c(h.owner) : 'nobody'} takes the province` : '; defenders hold'}.`,
      focus: { province: h.province } };
    default: return { tone: 'broken', icon: 'journal', title: 'Headline', detail: '', focus: null };
  }
}

/** The viewer as the popup/sound policy needs it (public data only). `pastSides` are coalitions the
 * viewer has belonged to this session, so "your alliance dissolved" still counts after the fact. */
export function viewerOf(state, pastSides = []) {
  const you = state?.you || null, me = state?.players?.find(p => p.id === you);
  return { you, side: me?.side || null, allies: me ? state.players.filter(p => p.side === me.side && p.id !== you).map(p => p.id) : [],
    pastSides: [...pastSides] };
}

/** Does this headline DIRECTLY affect the viewer's country? Only these get the big centred banner and
 * a loud sound; everything else is a rail row (plus its small map effect and at most a quiet blip).
 * Spectators: only the end of the match. Wars and peace list whole side rosters, so a war on your
 * coalition names you. Victory countdowns are for or against every seated player. */
export function affectsViewer(item, viewer = {}) {
  const h = item?.headline, you = viewer.you ?? null;
  if (!h) return false;
  if (h.kind === 'finished') return true;
  if (!you) return false;
  const friends = new Set([you, ...(viewer.allies || [])]), touches = ids => (ids || []).some(id => friends.has(id));
  const sides = new Set([viewer.side, ...(viewer.pastSides || [])].filter(Boolean));
  switch (h.kind) {
    case 'war': case 'peace': return touches(h.from) || touches(h.to);
    case 'alliance': return touches(h.countries);
    case 'departure': return friends.has(h.country) || sides.has(h.side);
    case 'dissolved': return sides.has(h.side);
    case 'eliminated': return friends.has(h.country);
    case 'major_battle': return h.owner === you || h.previousOwner === you || (item.arrivals || []).some(a => a.country === you);
    case 'dominance': case 'dominance_broken': return true;
    default: return false; // industry_up and anything new: rail only
  }
}

/** v0.7 unified rail: everything THIS viewer received, as one chronological stream. Input is the
 * viewer's own observed events (already recipient-filtered by the server) plus stopped holds, so it
 * never widens visibility: a private row exists only because that event was delivered to this seat.
 * Each item gets `threads` (filter tokens): 'world', 'alliance:<side>', 'dm', 'dm:<country>'.
 * Chat keeps `untrusted: true`; alliance names and chat are player text for textContent only.
 * Diplomatic system rows (`system`) carry structured facts, never player speech beyond the name. */
export function commsItems(events, breaks = [], { you = null } = {}) {
  const sideOf = new Map(), offers = new Map(), peace = new Map(), items = [];
  const coalitionOf = id => sideOf.get(id) ?? null;
  const own = () => coalitionOf(you);
  const push = (e, threads, extra = {}) => items.push({ ...e, seq: e.id, threads, ...extra });
  const offerThreads = o => !you ? ['world'] : you === o.candidate ? ['dm', `dm:${o.from}`]
    : you === o.from ? ['dm', `dm:${o.candidate}`, ...(own() ? [`alliance:${own()}`] : [])] : own() ? [`alliance:${own()}`] : ['dm', `dm:${o.from}`];
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    // Membership timeline from public events, so an alliance message is filed under the sender's
    // coalition at send time (provable from the log, no private fields needed).
    if (e.type === 'alliance_activated') for (const id of e.roster) sideOf.set(id, e.side);
    if (e.type === 'departed') sideOf.delete(e.country);
    if (e.type === 'coalition_dissolved') for (const [id, s] of [...sideOf]) if (s === e.side) sideOf.delete(id);
    if (e.headline) { push(e, ['world']); continue; }
    if (e.type === 'message') {
      if (e.channel === 'world' && !e.recipients) push(e, ['world'], { channel: 'world' });
      else if (e.channel === 'alliance') { const side = coalitionOf(e.from) ?? own(); push(e, [`alliance:${side ?? 'unknown'}`], { channel: 'alliance', side }); }
      else if (e.channel === 'dm') { const other = e.from === you ? e.to : e.from; push(e, ['dm', `dm:${other}`], { channel: 'dm', with: other }); }
      continue;
    }
    switch (e.type) {
      case 'alliance_offer': {
        const partners = e.roster.filter(id => id !== e.from && coalitionOf(id) && coalitionOf(id) === coalitionOf(e.from));
        const o = { from: e.from, roster: e.roster, name: e.name, candidate: e.roster.find(id => id !== e.from && !partners.includes(id)) ?? null };
        offers.set(e.proposalId, o); push(e, offerThreads(o), { system: 'offer', candidate: o.candidate }); break;
      }
      case 'offer_accepted': case 'proposal_cancelled': {
        const o = offers.get(e.proposalId); push(e, o ? offerThreads(o) : ['dm'], { system: e.type === 'offer_accepted' ? 'accepted' : 'cancelled', name: o?.name ?? null }); break;
      }
      case 'alliance_notice': { const o = offers.get(e.proposalId); push(e, ['world', ...(o && you && e.roster.includes(you) ? offerThreads(o) : [])], { system: 'notice' }); break; }
      case 'departure_notice': push(e, ['world'], { system: 'leaving' }); break;
      // A peace offer between two sides: filed under your alliance chat, or the conversation with the other side.
      case 'peace_offered': {
        const mine = (e.fromRoster || []).includes(you), roster = mine ? e.fromRoster : e.toRoster || [], other = mine ? e.toRoster?.[0] : e.by;
        const threads = roster.length > 1 && own() ? [`alliance:${own()}`] : ['dm', `dm:${other}`];
        peace.set(e.offerId, threads); push(e, threads, { system: 'peace_offer' }); break;
      }
      case 'peace_expired': push(e, peace.get(e.offerId) ?? ['dm'], { system: 'expired' }); break;
      // Your own army turned back automatically (never a recall you ordered yourself: that has no reason).
      case 'army_recalled': if (you && e.country === you && e.reason) push(e, ['mine'], { system: 'turned_back' }); break;
      default: break;
    }
  }
  for (const b of breaks) if (Number.isSafeInteger(b.seq) && b.headline)
    items.push({ id: null, seq: b.seq, tick: b.tick, type: 'dominance_broken', side: b.side, economy: b.economy, threshold: b.threshold, headline: b.headline, threads: ['world'] });
  return items.sort((a, b) => a.seq - b.seq || (a.id === null) - (b.id === null));
}

/** Why one of your armies was turned back, in game voice (from the engine's `reason` and detail). */
export function turnedBackReason(item, names) {
  const c = names.country, s = names.side;
  switch (item.reason) {
    case 'battle_in_progress': return `${s(item.battleAttackerSide)}’s battle there was already under way`;
    case 'no_war': return item.allied ? `${c(item.owner)} is now your ally` : item.owner ? `you are not at war with ${c(item.owner)}` : 'they could not attack there';
    case 'rival_arrival': return `${s(item.rivalSide)} arrived at the same moment with a larger force`;
    case 'transit_blocked': return item.battleAttackerSide ? 'a battle blocked the route' : 'the route was blocked';
    case 'rally_blocked': return 'the rally province is no longer friendly';
    case 'peace': return item.owner ? `peace was signed with ${c(item.owner)}` : 'peace was signed';
    default: return 'they could not attack there';
  }
}
/** Plain-text copy for a diplomatic system row. `names` as for headlineCopy. */
export function systemCopy(item, names) {
  const c = names.country, s = names.side, t = names.time, list = ids => (ids || []).map(c).join(' + ');
  switch (item.system) {
    case 'offer': return { tone: 'alliance', icon: 'ribbon', title: 'Alliance offer',
      detail: `${c(item.from)} invites ${item.candidate ? c(item.candidate) : 'a new member'} into ${item.name}: ${list(item.roster)}.` };
    case 'accepted': return { tone: 'alliance', icon: 'ribbon', title: 'Offer accepted', detail: `${c(item.country)} accepted${item.name ? ` ${item.name}` : ''}.` };
    case 'cancelled': return { tone: 'broken', icon: 'council', title: 'Offer closed', detail: `${item.name ?? 'The offer'} was withdrawn, declined or expired${item.reason ? ` (${item.reason})` : ''}.` };
    case 'notice': return { tone: 'alliance', icon: 'ribbon', title: 'Alliance forming', detail: `${item.name}: ${list(item.roster)} · active at ${t(item.activateAt)}.` };
    case 'leaving': return { tone: 'broken', icon: 'council', title: 'Leaving a coalition', detail: `${c(item.country)} leaves at ${t(item.activateAt)}.` };
    case 'peace_offer': return { tone: 'peace', icon: 'treaty', title: 'Peace offered', detail: `${list(item.fromRoster)} offer peace to ${list(item.toRoster)} · open until ${t(item.expiresAt)}.` };
    case 'turned_back': return { tone: 'war', icon: 'military', title: 'Troops turned back',
      detail: `Your ${item.amount} troops turned back${item.province ? ` from ${names.province(item.province)}` : ''}: ${turnedBackReason(item, names)}. They reach ${names.province(item.to)} at ${t(item.arrivesAt)}.` };
    case 'expired': return { tone: 'broken', icon: 'council', title: 'Peace offer closed', detail: item.reason ?? 'The peace offer expired.' };
    default: return { tone: 'broken', icon: 'journal', title: 'Council', detail: '' };
  }
}

/** Decisions waiting for this seat: open alliance offers it is a party to and has not accepted (not its own),
 * and peace offered to its side. */
export function decisionsFor(state) {
  const you = state?.you; if (!you) return [];
  const offers = (state.proposals || []).filter(q => q.status === 'open' && q.roster.includes(you) && !q.accepted.includes(you))
    .map(q => ({ kind: 'offer', id: q.id, country: q.creator, proposal: q }));
  const peace = (state.peaceOffers || []).filter(o => o.status === 'offered' && o.toRoster.includes(you))
    .map(o => ({ kind: 'peace_offer', id: o.id, country: o.by, offer: o }));
  return [...offers, ...peace];
}
