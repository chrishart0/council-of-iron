/** Sound cue selection (v0.7). Pure: no DOM, Web Audio, clock or storage, so it is unit-tested.
 * Cues are chosen only from things the viewer can already see: engine headlines (World feed and
 * banners), public world chat (feed row), hostile armies aimed at the viewer's land (threat strip)
 * and the viewer's own committed orders (toast). A sound never carries information alone.
 */
import { isWorldMessage, affectsViewer } from './feed-model.js';
import { threatening } from './relations.js';

/** Base priority. UI = 1; ordinary world news = 2; decisive diplomacy = 3; own defeat = 5.
 * A cue that names the viewer's own country gets +2 (see `mine`). */
export const PRIORITY = {
  click: 1, march: 1, chat: 1,
  battle: 2, industry_up: 2, industry_down: 2, dispatch: 2,
  war: 3, alliance: 3, peace: 3, fallen: 3, countdown: 3, countdown_stop: 3, victory: 3, draw: 3, warning: 3,
  defeat: 5,
};
/** Minimum seconds between two plays of the same cue. */
export const COOLDOWN = {
  click: 0.06, march: 0.3, chat: 6, battle: 6, industry_up: 5, industry_down: 5, dispatch: 4,
  war: 2.5, alliance: 2.5, peace: 2.5, fallen: 2.5, countdown: 5, countdown_stop: 5, warning: 8,
  victory: 0, draw: 0, defeat: 0,
};
export const STINGER_GAP = 2.5;        // seconds before an equal-or-lower priority stinger may follow
export const STINGER_WINDOW = [20, 4]; // at most 4 stingers in 20 s (priority ≥ 5 always passes)
export const isStinger = cue => PRIORITY[cue] >= 2;

const KNOWN = new Set(['war', 'peace', 'alliance', 'departure', 'dissolved', 'eliminated', 'major_battle', 'industry_up', 'industry_down', 'dominance', 'dominance_broken', 'finished']);
const request = (cue, mine = false) => ({ cue, priority: PRIORITY[cue] + (mine ? 2 : 0), mine });

/** Cue for one classified headline. `viewer` = viewerOf(state) (you/side null for spectators).
 * Loud stingers only for headlines that affect the viewer; other people's news is a quiet,
 * rate-limited blip (the `chat` cue), like the rail row it accompanies. */
export function headlineCue(item, viewer = {}) {
  const h = item?.headline, you = viewer.you ?? null;
  if (!h) return null;
  if (!KNOWN.has(h.kind)) return null;
  if (!affectsViewer(item, viewer)) return request('chat');
  const mine = Boolean(you) && [h.from, h.to, h.countries, [h.country, h.owner, h.previousOwner]].flat().includes(you);
  switch (h.kind) {
    case 'war': return request('war', mine);
    case 'peace': return request('peace', mine);
    case 'alliance': return request('alliance', mine);
    case 'departure': case 'dissolved': return request('dispatch', mine);
    case 'eliminated': return h.country === you ? request('defeat') : request('fallen');
    case 'major_battle': return request('battle', mine);
    case 'industry_up': return request('industry_up', mine);
    case 'industry_down': return request('industry_down', mine);
    case 'dominance': return request('countdown', Boolean(viewer.side) && h.side === viewer.side);
    case 'dominance_broken': return request('countdown_stop', Boolean(viewer.side) && h.side === viewer.side);
    case 'finished':
      if (h.draw) return request('draw', Boolean(you));
      if (!you) return request('victory');
      return h.winningSide === viewer.side ? request('victory', true) : request('defeat');
    default: return null;
  }
}

/** Requests for events received after catch-up. The caller must never pass catch-up events. */
export function eventCues(events, viewer = {}) {
  const out = [];
  for (const e of events) {
    if (e.headline) { const r = headlineCue(e, viewer); if (r) out.push(r); }
    else if (isWorldMessage(e) && e.from !== viewer.you) out.push(request('chat'));
  }
  return out;
}

/** Stopped victory holds with `seq` above `after` (they arrive in `dominanceBreaks`, not events). */
export function breakCues(breaks = [], after = 0, viewer = {}) {
  return breaks.filter(b => b.headline && Number.isSafeInteger(b.seq) && b.seq > after)
    .map(b => headlineCue({ headline: b.headline }, viewer)).filter(Boolean);
}

/** IDs of hostile armies marching on the viewer's provinces: the same rule as the threat strip. */
export function threatIds(state) {
  const me = state?.players?.find(p => p.id === state.you);
  if (!me || state.status !== 'running') return new Set();
  return new Set(state.armies.filter(a => threatening(state, a, state.you)).map(a => a.id));
}

/** Tension layer: the viewer is at war, or any victory countdown is running. */
export function tensionActive(state) {
  if (!state || state.status !== 'running') return false;
  if (Object.keys(state.dominance || {}).length) return true;
  return Boolean(state.you) && (state.wars || []).some(pair => pair.split(':').includes(state.you));
}

/** Rate limiter and arbiter. Per call it returns at most one stinger and, only when no stinger
 * was chosen, at most one UI cue; everything else is dropped (the banner/feed still shows it). */
export class CuePolicy {
  constructor() { this.last = new Map(); this.stingers = []; this.lastStinger = null; }
  reset() { this.last.clear(); this.stingers = []; this.lastStinger = null; }
  choose(requests, now, { reduced = false } = {}) {
    const ranked = requests.map((r, i) => [r, i]).sort((a, b) => b[0].priority - a[0].priority || a[1] - b[1]).map(([r]) => r);
    const ready = r => now - (this.last.get(r.cue) ?? -Infinity) >= COOLDOWN[r.cue];
    const [window, budget] = STINGER_WINDOW;
    this.stingers = this.stingers.filter(t => now - t < window);
    const chosen = [];
    for (const r of ranked) {
      if (!isStinger(r.cue) || !ready(r)) continue;
      if (reduced && r.priority < 3) continue;
      const gapOk = !this.lastStinger || now - this.lastStinger.at >= STINGER_GAP || r.priority > this.lastStinger.priority;
      if (!gapOk || (this.stingers.length >= budget && r.priority < 5)) continue;
      chosen.push(r); this.stingers.push(now); this.lastStinger = { at: now, priority: r.priority };
      break;
    }
    if (!chosen.length && !reduced) {
      const ui = ranked.find(r => !isStinger(r.cue) && ready(r));
      if (ui) chosen.push(ui);
    }
    for (const r of chosen) this.last.set(r.cue, now);
    return chosen;
  }
}
