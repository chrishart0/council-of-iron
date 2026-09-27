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
      detail: `${c(h.country)} is eliminated: no provinces or armies remain. Its earned share is frozen.`, focus: { country: h.country } };
    case 'dominance': return { tone: 'victory', icon: 'prestige', title: 'Victory countdown',
      detail: `${s(h.side)} holds 60% of industry; wins at ${names.time(h.winsAt)} unless stopped.`, focus: null };
    case 'dominance_broken': return { tone: 'broken', icon: 'prestige', title: 'Countdown stopped',
      detail: `${s(h.side)}${h.cause === 'membership' ? '’s membership changed; the hold restarts.' : ` fell below the threshold (${h.economy}/${h.threshold} industry).`}`, focus: null };
    case 'finished': return { tone: 'victory', icon: 'prestige', title: 'Match concluded',
      detail: h.draw ? 'The match ends in a draw.' : `${s(h.winningSide)} wins.`, focus: null };
    case 'industry_up': return { tone: 'industry', icon: 'gear', title: 'Industry built',
      detail: `${p(h.province)} reaches industrial level ${h.level}${h.country ? ` for ${c(h.country)}` : ''}.`, focus: { province: h.province } };
    case 'industry_down': return { tone: 'industry-lost', icon: 'gear', title: 'Factory damaged',
      detail: `${p(h.province)} falls to industrial level ${h.level} after capture.`, focus: { province: h.province } };
    case 'major_battle': return { tone: 'battle', icon: 'military', title: `Major battle at ${p(h.province)}`,
      detail: `${h.casualties} troops lost${h.captured ? `; ${h.owner ? c(h.owner) : 'nobody'} takes the province` : '; defenders hold'}.`,
      focus: { province: h.province } };
    default: return { tone: 'broken', icon: 'journal', title: 'Headline', detail: '', focus: null };
  }
}
