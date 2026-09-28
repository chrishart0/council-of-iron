/** v0.9 concept kit: recorded public data + the real atlas, shared by the three concept directions.
 * Prototype only. Every name and message comes from public/concepts/fixture/*.json (public observations as the
 * API returns them); player text is rendered with textContent/escaping, never into SVG markup.
 */
import { Atlas } from '/atlas.js';
import { leaderboard, warsOf } from '/leaderboard.js';
import { allianceColors, relationsOf } from '/relations.js';
import { faction, insignia, icon } from '/presentation.js';
import { commsItems, headlineCopy, systemCopy, countryThread } from '/feed-model.js';
import { escapeHTML as esc } from '/ui.js';
export { esc, faction, insignia, icon, warsOf };

/** Every screen a direction renders, in review order. Phone-friendly ids for ?s=. */
export const SCREENS = [
  ['tile', 'Style tile'], ['title', 'Title & rooms'], ['faction', 'Choose a country'], ['hud', 'In match · idle'],
  ['province', 'Province · send troops'], ['country', 'Country · war or alliance'], ['offer', 'Incoming alliance offer'],
  ['chat', 'Chat & diplomacy'], ['menu', 'Menu & settings'], ['powers', 'Powers & wars'], ['replay', 'Replay'], ['report', 'After-action report'],
  ['walk', 'Comms walkthrough'],
];
export const screen = () => { const s = new URLSearchParams(location.search).get('s'); return SCREENS.some(([id]) => id === s) ? s : 'hud'; };

export async function load() {
  const get = name => fetch(`/concepts/fixture/${name}.json`).then(r => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); });
  const [live, map, review, replay] = await Promise.all(['live', 'map', 'review', 'replay'].map(get));
  return model({ live, map, review, replay });
}

export const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function model({ live, map, review, replay }) {
  const country = id => map.countries.find(c => c.id === id)?.name ?? live.players.find(p => p.id === id)?.name ?? id;
  const province = id => map.provinces.find(p => p.id === id)?.name ?? id;
  const side = id => live.sides.find(s => s.id === id)?.name ?? review.alliances?.find(a => a.id === id)?.name ?? (String(id).startsWith('solo:') ? country(String(id).split(':')[1]) : id);
  const names = { country, province, side, time: clock, short: id => faction(id).short };
  const you = live.you, colors = allianceColors(live);
  const items = commsItems(live.events, live.dominanceBreaks || [], { you });
  const mine = live.provinces.filter(p => p.owner === you);
  const troops = mine.reduce((n, p) => n + p.troops, 0) + live.armies.filter(a => a.country === you).reduce((n, a) => n + a.amount, 0);
  const offer = (live.proposals || []).find(q => q.status === 'open' && q.roster.includes(you) && !q.accepted.includes(you)) || null;
  return {
    live, map, review, replay, you, names, colors, items,
    stats: { troops, land: mine.length, provinces: live.provinces.length, industry: mine.reduce((n, p) => n + p.development, 0), threshold: live.economyThreshold,
      clock: `${clock(live.tick)} / ${clock(live.rules.duration)}`, left: clock(live.rules.duration - live.tick), tick: live.tick, duration: live.rules.duration },
    relations: relationsOf(live, you), offer,
    /** Teams leaderboard (the same pure ranking the browser, CLI and MCP use) + war fronts. */
    powers: (state = live, viewer = you) => ({ ...leaderboard(state, { mode: 'teams', you: viewer }), fronts: warsOf(state), colors: allianceColors(state) }),
    world: items.filter(i => i.threads.includes('world')).map(i => row(i, names, live.players.length)),
    dm: other => countryThread(items, other).map(i => row(i, names, live.players.length)),
    /** A plausible first move for the viewer: the recorded arrow from England to the Low Countries. */
    order: { from: 'england', to: 'low-countries', free: live.provinces.find(p => p.id === 'england').troops, eta: live.travelTimes?.england?.['low-countries'] ?? null },
  };
}
/** A feed/thread row as plain data: { kind: 'chat'|'headline'|'system', from, text, title, tone, tick, ... }.
 * `text` is untrusted player speech for chat rows; render it with esc() or textContent only. */
function row(i, names, players) {
  if (i.type === 'message') return { kind: 'chat', id: i.seq, tick: i.tick, from: i.from, channel: i.channel, text: i.text };
  if (i.system) { const c = systemCopy(i, { ...names, players }); return { kind: 'system', id: i.seq, tick: i.tick, from: i.from, system: i.system, name: i.name, roster: i.roster, ...c }; }
  const c = headlineCopy(i, names); return { kind: 'headline', id: i.seq, tick: i.tick, ...c, type: i.type };
}

/** Mount the unchanged atlas. `insets()` returns the px covered by the HUD on each edge; the camera
 * always frames targets inside the uncovered rectangle (never under the frame). */
export function mountAtlas(svg, m, { state = m.live, selected = null, target = null, draft = null, focus = 'home', insets = () => ({}), width, mode } = {}) {
  const key = document.createElement('div'); key.hidden = true; document.body.append(key);
  const atlas = new Atlas(svg, m.map, () => {}, { legend: { placement: 'bottom-left', container: key, collapsed: true } });
  atlas.update(state, selected, target);
  if (draft) atlas.setDraft(draft);
  if (mode) atlas.setMapMode(mode);
  const frame = () => {
    const opts = { insets: insets(), ...(width ? { width } : {}) };
    if (focus === 'world') worldFit(atlas, svg, opts.insets);
    else if (focus === 'home') atlas.home(state.you || 'britain', opts);
    else atlas.focus(focus, opts);
  };
  requestAnimationFrame(frame); addEventListener('resize', () => requestAnimationFrame(frame));
  return atlas;
}
/** World view inside the uncovered rectangle: the whole 1280-unit world fits between the side insets. */
function worldFit(atlas, svg, { top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  const r = svg.getBoundingClientRect(), freeW = Math.max(1, r.width - left - right), freeH = Math.max(1, r.height - top - bottom);
  const px = Math.max(freeW / 1280, freeH / 680) * .98, w = r.width / px;
  atlas.view = { x: 640 - (left + freeW / 2) / px, y: 330 - (top + freeH / 2) / px, w, h: r.height / px };
  atlas.applyView();
}
/** Decoded replay frame nearest to `tick` (public board at that time). */
export const frameAt = (m, tick) => m.replay.frames.reduce((best, f) => Math.abs(f.tick - tick) < Math.abs(best.tick - tick) ? f : best, m.replay.frames[0]);
export const replayState = (m, tick) => { const f = frameAt(m, tick); return { ...f, status: 'replay', speed: 0, rules: m.replay.rules, scenario: m.replay.scenario, you: null, proposals: [], diplomacy: [] }; };
/** Public headlines up to `tick` from the after-action report (military history + alliance changes). */
export function historyTo(m, tick) {
  const names = { ...m.names, side: id => m.review.alliances.find(a => a.id === id)?.name ?? m.names.side(id) };
  return m.review.events.filter(e => e.tick <= tick).map(e => ({ tick: e.tick, type: e.type, ...reviewCopy(e, names) }));
}
function reviewCopy(e, n) {
  switch (e.type) {
    case 'capture': return { tone: 'war', title: `${n.province(e.province)} taken`, detail: `${e.owner ? n.country(e.owner) : 'Rebels'} took it${e.previousOwner ? ` from ${n.country(e.previousOwner)}` : ''}.` };
    case 'alliance_activated': return { tone: 'alliance', title: 'Alliance formed', detail: `${e.name ?? n.side(e.side)}: ${(e.roster || []).map(n.country).join(' + ')}.` };
    case 'war_declared': return { tone: 'war', title: 'War declared', detail: `${(e.fromRoster || []).map(n.country).join(' + ')} on ${(e.toRoster || []).map(n.country).join(' + ')}.` };
    case 'eliminated': return { tone: 'war', title: 'Power fallen', detail: `${n.country(e.country)} has no provinces left.` };
    case 'development_completed': return { tone: 'industry', title: 'Industry raised', detail: `${n.province(e.province)} reaches industry ${e.level ?? ''}.`.replace(' .', '.') };
    case 'development_started': return { tone: 'industry', title: 'Development begun', detail: `${n.province(e.province)}.` };
    case 'army_recalled': return { tone: 'neutral', title: 'Army recalled', detail: `${n.country(e.country)} recalls ${e.amount} to ${n.province(e.to)}.` };
    case 'dominance': return { tone: 'victory', title: 'Victory countdown', detail: `${n.side(e.side)} holds 60% of industry.` };
    case 'dominance_broken': return { tone: 'war', title: 'Countdown stopped', detail: `${n.side(e.side)} fell below the threshold.` };
    case 'finished': return { tone: 'victory', title: 'Match over', detail: e.winningSide ? `${n.side(e.winningSide)} wins.` : 'Draw.' };
    default: return { tone: 'neutral', title: e.type.replaceAll('_', ' '), detail: e.province ? n.province(e.province) : '' };
  }
}

/** Screen switcher for reviewers: hidden when ?clean=1 (screenshots). Lives outside the design, bottom-centre, collapsible. */
export function reviewerNav(direction, label) {
  if (new URLSearchParams(location.search).get('clean') === '1') return;
  const s = screen(), i = SCREENS.findIndex(([id]) => id === s);
  const go = d => { const n = SCREENS[(i + d + SCREENS.length) % SCREENS.length][0]; location.search = `?s=${n}`; };
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/concepts/kit/nav.css'; document.head.append(css);
  const nav = document.createElement('nav'); nav.className = 'concept-nav'; nav.setAttribute('aria-label', 'Concept screens');
  nav.innerHTML = `<a href="/concepts/" title="All concepts">${esc(direction)}</a><button type="button" data-d="-1" aria-label="Previous screen">‹</button><select aria-label="Screen">${SCREENS.map(([id, name]) => `<option value="${id}"${id === s ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select><button type="button" data-d="1" aria-label="Next screen">›</button><span>${esc(label)}</span>`;
  nav.addEventListener('click', e => { const d = e.target.closest('[data-d]')?.dataset.d; if (d) go(Number(d)); });
  nav.querySelector('select').addEventListener('change', e => { location.search = `?s=${e.target.value}`; });
  addEventListener('keydown', e => { if (e.target.closest?.('input,textarea,select')) return; if (e.key === ']') go(1); if (e.key === '[') go(-1); });
  document.body.append(nav);
}

/** Mount the shared comms model (kit/comms.js) on a direction's elements for the current screen.
 * els: { button, toasts, panel, docked?: () => boolean } — the direction places them in its own fixed regions and skins `cx-*`;
 * `docked()` true (e.g. desktop right column) makes the inbox list the resting state instead of a hidden panel.
 * Screens: 'walk' = the scripted walkthrough (recorded observations comms-0…4); 'offer' = France's offer arriving
 * as an ACTION toast; 'chat' = Messages open on the France thread; anything else = the live position at rest. */
export async function mountComms(m, els, s = screen()) {
  const { Comms } = await import('/concepts/kit/comms.js');
  const get = name => fetch(`/concepts/fixture/${name}.json`).then(r => r.json());
  const live = m.live, offerEvent = live.events.find(e => e.type === 'alliance_offer'), dmFrance = live.events.find(e => e.type === 'message' && e.from === 'france' && e.channel === 'dm');
  if (s === 'walk') {
    const snaps = await Promise.all(['0-before', '1-dm', '2-offer', '3-accepted', '4-replied'].map(n => get(`comms-${n}`)));
    const comms = new Comms({ ...els, m, state: snaps[0], readUpTo: snaps[0].events.at(-1).id, voiceScript: 'Agreed. Hold the Pacific and we will hold the Channel.',
      onAct: async a => a.type === 'accept' && a.proposalId && snaps[2].proposals.some(q => q.id === a.proposalId && q.creator === 'japan') ? snaps[3]
        : a.type === 'chat' && a.to === 'japan' && comms.state === snaps[3] ? snaps[4] : null });
    // Test-only stepping (like tests/ui-browser-server.js' private stdin): deliver the next recorded observation.
    let stage = 0; window.__walk = { arrive: () => { stage = Math.min(2, stage + 1); comms.receive(snaps[stage]); return stage; } };
    return comms;
  }
  if (s === 'offer') {
    const before = { ...live, events: live.events.filter(e => e.id < offerEvent.id), proposals: [] };
    const comms = new Comms({ ...els, m, state: before, readUpTo: dmFrance.id });
    requestAnimationFrame(() => comms.receive(live)); return comms;
  }
  const comms = new Comms({ ...els, m, state: live, readUpTo: s === 'chat' ? dmFrance.id - 1 : dmFrance.id - 1 });
  if (s === 'chat') requestAnimationFrame(() => comms.openThread('dm:france'));
  return comms;
}
