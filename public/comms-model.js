/** v0.9 comms model: one triage for notifications and messages. Pure: no DOM, clock or I/O.
 * Tiers: ACTION (a decision that is mine, or an attack about to land on me), PERSONAL (to me, no decision),
 * WORLD (everything else). Input is the viewer's own observation (already recipient-filtered by the server),
 * so it never widens visibility. Rows are keyed by event seq (as a string) or `threat:<armyId>`.
 */
import { commsItems, affectsViewer, viewerOf, decisionsFor } from './feed-model.js';
import { threatening } from './relations.js';

export const TIERS = Object.freeze(['action', 'personal', 'world']);
/** An incoming attack is an ACTION when it lands on one of my provinces within this many game seconds. */
export const THREAT_WINDOW = 30;

/** The inbox of one seat (or a spectator: `you` null → World only). `read`/`dismissed`: Sets of row keys.
 * `items` may be passed when the caller already built commsItems for the same events. */
export function inbox(state, { read = new Set(), dismissed = new Set(), items = null, history = state.events || [] } = {}) {
  const you = state.you || null, viewer = viewerOf(state);
  items ??= commsItems(history, state.dominanceBreaks || [], { you });
  const proposals = new Map((state.proposals || []).map(q => [q.id, q]));
  const decisions = decisionsFor(state), decided = new Set(decisions.map(d => d.id));
  const rows = [];
  for (const i of items) {
    const key = i.id === null ? `b${i.seq}:${i.side}` : String(i.seq);
    const mine = Boolean(you) && (i.from === you || i.system === 'accepted' && i.country === you);
    let tier = 'world', status = null, decision = null;
    if (i.system === 'offer') {
      const q = proposals.get(i.proposalId);
      status = !q ? 'closed' : q.status === 'open' ? (you && q.accepted.includes(you) ? 'accepted' : 'open')
        : ['pending', 'activated'].includes(q.status) ? 'accepted' : q.status === 'cancelled' ? 'closed' : q.status;
      // A decision for me: the offer to join, or (as a member) approving a new member of my coalition.
      tier = you && q && decided.has(q.id) ? 'action' : you ? 'personal' : 'world';
      if (tier === 'action') decision = decisions.find(d => d.id === q.id);
    } else if (i.system === 'vote' || i.system === 'peace_offer') {
      decision = decisions.find(d => d.id === i.motionId) || null;
      const m = (state.diplomacy || []).find(m => m.id === i.motionId);
      status = decision ? 'open' : !m ? 'closed' : ['voting', 'offered'].includes(m.status) ? 'waiting' : m.status === 'enacted' ? 'accepted' : 'closed';
      tier = decision ? 'action' : you ? 'personal' : 'world';
    } else if (you && (i.channel === 'dm' || i.channel === 'alliance' || i.system)) tier = 'personal';
    else if (you && i.headline && affectsViewer(i, viewer)) tier = 'personal';
    rows.push({ key, seq: i.seq, tick: i.tick, tier, status, decision, mine, item: i, thread: threadKey(i) });
  }
  // Incoming attacks landing soon: synthetic ACTION rows in World, withdrawn as soon as the army no longer qualifies.
  if (you && state.status === 'running') for (const a of state.armies || [])
    if (threatening(state, a, you) && a.arrivesAt - state.tick <= THREAT_WINDOW && a.arrivesAt >= state.tick)
      rows.push({ key: `threat:${a.id}`, seq: Number.MAX_SAFE_INTEGER, tick: state.tick, tier: 'action', status: 'open', decision: null, mine: false, thread: 'world', item: { type: 'threat', army: a } });
  for (const r of rows) {
    r.pending = r.tier === 'action' && r.status === 'open';
    r.unread = !r.mine && r.tier !== 'world' && !read.has(r.key) && !['closed', 'expired'].includes(r.status);
    r.dismissed = dismissed.has(r.key);
  }
  return { rows, conversations: conversations(state, rows), counts: { action: rows.filter(r => r.pending).length, unread: rows.filter(r => r.unread && !r.pending).length } };
}
const threadKey = i => { const t = i.threads || []; const dm = t.find(x => x.startsWith('dm:')); if (dm) return dm; return t.some(x => x.startsWith('alliance:')) ? 'alliance' : 'world'; };
/** Conversations sorted by what needs me: a pending decision, then unread, then the latest activity. */
function conversations(state, rows) {
  const you = state.you || null, me = state.players?.find(p => p.id === you), side = me && !String(me.side).startsWith('solo:') ? me.side : null;
  const list = new Map([['world', { key: 'world', kind: 'world' }]]);
  if (you) {
    list.set('alliance', { key: 'alliance', kind: 'alliance', side });
    for (const p of state.players || []) if (p.id !== you) list.set(`dm:${p.id}`, { key: `dm:${p.id}`, kind: 'dm', country: p.id, eliminated: p.eliminatedAt !== null && p.eliminatedAt !== undefined });
  }
  for (const c of list.values()) c.rows = [];
  for (const r of rows) (list.get(r.thread) || list.get('world')).rows.push(r);
  const out = [...list.values()].map(c => ({ ...c, action: c.rows.filter(r => r.pending).length, unread: c.rows.filter(r => r.unread).length,
    last: c.rows.filter(r => r.item.type !== 'threat').at(-1) || null, active: c.rows.length > 0 }));
  const rank = c => [c.action ? 0 : 1, c.unread ? 0 : 1, c.active ? 0 : 1, -(c.last?.seq ?? -1)];
  return out.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
}

/** What arrived between two inboxes, as toasts: ACTION rows (persistent, one visible, "+N"); PERSONAL groups
 * (brief; a burst from one sender coalesces); WORLD only pulses the World conversation. Own rows never toast. */
export function arrivals(before, after) {
  const seen = new Set(before.rows.map(r => r.key)), fresh = after.rows.filter(r => !seen.has(r.key) && !r.mine);
  const actions = fresh.filter(r => r.pending);
  const personal = [];
  // Turned-back armies get their own notice from the client (with Turn around); no second toast here.
  for (const r of fresh.filter(r => r.tier === 'personal' && !r.pending && r.item.system !== 'turned_back')) {
    const from = r.item.from ?? r.item.country ?? null, last = personal.at(-1);
    if (last && last.from === from && last.thread === r.thread) { last.count++; last.rows.push(r); }
    else personal.push({ from, thread: r.thread, count: 1, rows: [r] });
  }
  return { actions, personal, worldPulse: fresh.some(r => r.tier === 'world') };
}
