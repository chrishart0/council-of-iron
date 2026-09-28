/** v0.9 comms model (proposal for public/feed-model.js in Phase 2). Pure: no DOM, clock or I/O.
 * One triage for every client: ACTION (needs my decision), PERSONAL (to me, no decision), WORLD (the rest).
 * Input is the viewer's own observation (already recipient-filtered by the server); it never widens visibility.
 */
import { commsItems, affectsViewer, viewerOf, decisionsFor } from '/feed-model.js';
import { atWar } from '/relations.js';
/** Same rule as `threatening()` in public/relations.js on ui-v0.8-simple (fdec5c8), which replaces this copy
 * after the Phase 2 merge: a marching (not returning) army on my province whose country is at war with me
 * (legacy rooms: any non-ally). */
const threatening = (state, army, you) => Boolean(army && !army.returning && you && state.provinces.find(p => p.id === army.to)?.owner === you && atWar(state, army.country, you));

export const TIERS = ['action', 'personal', 'world'];
/** An incoming hostile army is an ACTION when it lands on one of my provinces within this many game seconds. */
export const THREAT_WINDOW = 30;

/** Build the inbox for one seat. `read` / `dismissed`: Sets of item keys (seq, or `threat:<armyId>`). */
export function inbox(state, { read = new Set(), dismissed = new Set() } = {}) {
  const you = state.you, viewer = viewerOf(state), items = commsItems(state.events, state.dominanceBreaks || [], { you });
  const open = new Map((state.proposals || []).map(q => [q.id, q]));
  const decisions = decisionsFor(state), decisionIds = new Set(decisions.map(d => d.id));
  const mySide = state.players.find(p => p.id === you)?.side;
  const rows = items.map(i => {
    const key = String(i.seq), mine = i.from === you || i.country === you && i.system === 'accepted';
    let tier = 'world', status = null;
    if (i.system === 'offer') {
      const q = open.get(i.proposalId);
      status = !q ? 'expired' : q.status === 'open' ? (q.accepted.includes(you) ? 'accepted' : 'open') : ['pending', 'activated'].includes(q.status) ? 'accepted' : q.status === 'cancelled' ? 'closed' : q.status;
      tier = i.candidate === you && status === 'open' && decisionIds.has(q.id) ? 'action' : 'personal';
    } else if (i.system === 'vote' || i.system === 'peace_offer') {
      tier = decisions.some(d => d.motion?.id === i.motionId) ? 'action' : 'personal';
    } else if (i.channel === 'dm' || i.channel === 'alliance' || i.system) tier = 'personal';
    else if (i.headline && affectsViewer(i, viewer)) tier = 'personal';
    return { key, seq: i.seq, tick: i.tick, tier, status, mine, item: i, thread: threadKey(i, mySide) };
  });
  // Incoming attacks arriving soon (public armies aimed at my provinces): synthetic ACTION rows in World.
  // Withdrawn automatically: a row exists only while the army still qualifies (turned back, died or arrived = gone).
  for (const a of state.armies || []) if (threatening(state, a, you) && a.arrivesAt - state.tick <= THREAT_WINDOW && a.arrivesAt >= state.tick)
    rows.push({ key: `threat:${a.id}`, seq: Infinity, tick: state.tick, tier: 'action', status: 'open', mine: false, thread: 'world', item: { type: 'threat', army: a } });
  for (const r of rows) { r.unread = !r.mine && r.tier !== 'world' && !read.has(r.key) && r.status !== 'expired'; r.pending = r.tier === 'action' && r.status === 'open'; r.dismissed = dismissed.has(r.key); }
  return { rows, conversations: conversations(state, rows, mySide), counts: { action: rows.filter(r => r.pending).length, unread: rows.filter(r => r.unread && r.tier === 'personal').length } };
}
function threadKey(i, mySide) {
  const t = i.threads || [];
  const dm = t.find(x => x.startsWith('dm:')); if (dm) return dm;
  const al = t.find(x => x.startsWith('alliance:')); if (al) return 'alliance';
  return 'world';
}
/** Conversations sorted by what needs me: pending decisions, then unread, then latest activity. World last among equals. */
function conversations(state, rows, mySide) {
  const you = state.you, byKey = new Map();
  const add = (key, extra) => { if (!byKey.has(key)) byKey.set(key, { key, rows: [], ...extra }); return byKey.get(key); };
  add('world', { kind: 'world' });
  add('alliance', { kind: 'alliance', side: mySide && !mySide.startsWith('solo:') ? mySide : null });
  for (const p of state.players) if (p.id !== you) add(`dm:${p.id}`, { kind: 'dm', country: p.id });
  for (const r of rows) (byKey.get(r.thread) || add(r.thread, { kind: 'dm', country: r.thread.slice(3) })).rows.push(r);
  const list = [...byKey.values()].map(c => ({ ...c, action: c.rows.filter(r => r.pending).length, unread: c.rows.filter(r => r.unread).length,
    last: c.rows.filter(r => r.item.type !== 'threat').at(-1) || null, active: c.rows.length > 0 }));
  const rank = c => [c.action ? 0 : 1, c.unread ? 0 : 1, c.active ? 0 : 1, -(c.last?.seq ?? -1)];
  return list.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
}

/** What arrived between two observations, as toasts. ACTION: persistent, one visible (+N). PERSONAL: brief,
 * bursts from one sender coalesce. WORLD: no toast, only a pulse on the World conversation. */
export function arrivals(before, after) {
  const seen = new Set(before.rows.map(r => r.key)), fresh = after.rows.filter(r => !seen.has(r.key) && !r.mine);
  const actions = fresh.filter(r => r.pending);
  const personal = []; for (const r of fresh.filter(r => r.tier === 'personal')) {
    const from = r.item.from ?? r.item.country ?? null, last = personal.at(-1);
    if (last && last.from === from) { last.count++; last.rows.push(r); } else personal.push({ from, count: 1, rows: [r] });
  }
  return { actions, personal, worldPulse: fresh.some(r => r.tier === 'world') };
}
