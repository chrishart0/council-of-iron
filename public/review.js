import { icon, insignia, faction } from './presentation.js';
import { Atlas } from './atlas.js';
import { escapeHTML as esc, setHTML } from './ui.js';
import { replayReader } from './replay-model.js';
import { ExpandableMap } from './expand.js';
import { LeaderboardPanel } from './leaderboard-panel.js';
import { allianceColors } from './relations.js';
/* v0.9 after-action report and replay in the War Room system (plates, plaques, brass). Presentation only:
 * everything comes from the public review and replay endpoints. Player text (names, alliance names,
 * revealed alliance chat) is escaped or set with textContent; SVG fragments are authored constants. */
const clock = n => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
const number = n => Number(n).toLocaleString('en', { maximumFractionDigits: 2 });
const signed = n => `${n >= 0 ? '+' : '−'}${number(Math.abs(n))}`;
const tabs = [['overview', 'Overview'], ['military', 'Military'], ['economy', 'Economy'], ['diplomacy', 'Diplomacy']];
const SPEEDS = [1, 4, 16, 64];
const NEUTRAL = '#a5a28c';
const seatType = p => !p ? '' : p.kind === 'bot' || p.model?.startsWith('heuristic-') ? 'Bot' : p.kind === 'human' ? 'Human' : 'AI';
const TONE = { capture: 'war', war_declared: 'war', dominance_broken: 'war', eliminated: 'war', alliance_activated: 'alliance', peace_accepted: 'peace', departed: 'alliance', coalition_dissolved: 'war', dominance: 'victory', finished: 'victory', development_completed: 'industry', development_started: 'industry' };
const TONE_ICON = { war: 'war', alliance: 'ally', peace: 'seal', victory: 'laurel', industry: 'industry' };
const KEY_EVENTS = ['alliance_activated', 'departed', 'coalition_dissolved', 'war_declared', 'peace_accepted', 'dominance', 'dominance_broken', 'eliminated', 'finished'];

/** A view of the public record; it deliberately has no reference to the gameplay command function. */
export class AfterAction {
  constructor(root, state, map) {
    this.root = root; this.id = state.id; this.viewer = state.you; this.map = map; this.tab = 'overview';
    this.controller = new AbortController(); this.position = 0; this.speed = 16; this.playing = false;
    this.chartState = { military: { metric: 'land', compare: 'all' }, economy: { metric: 'recruited', compare: 'all' } };
    this.root.classList.add('after-action'); this.root.dataset.view = 'report';
    this.root.innerHTML = '<p class="aar-loading" role="status">Preparing the after-action report…</p>';
    const options = { signal: this.controller.signal };
    this.root.addEventListener('click', event => this.click(event), options);
    this.root.addEventListener('input', event => {
      if (event.target.id === 'replay-slider') { this.pause(); this.seek(Number(event.target.value)); }
      if (event.target.id === 'wire-search') { this.wireQuery = event.target.value; this.renderWire(); }
    }, options);
    this.wireThread = 'all'; this.wireQuery = '';
    this.root.addEventListener('keydown', event => this.keydown(event), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, options);
    this.load(state);
  }
  el(id) { return this.root.querySelector(`#${id}`); }
  country(id) { return this.map.countries.find(c => c.id === id); }
  player(id) { return this.report?.players.find(p => p.country === id); }
  playerName(id) {
    const p = this.player(id); if (!p) return '';
    return p.displayName || p.name || p.model || '';
  }
  seat(id) { const p = this.player(id); return [seatType(p), this.playerName(id)].filter(Boolean).join(' · '); }
  place(id) { return this.map.provinces.find(p => p.id === id)?.name || id; }
  side(id) {
    const name = this.report?.sideNames?.find(s => s.id === id)?.name || this.report?.alliances.find(s => s.id === id)?.name;
    return this.country(name)?.name || name || (id?.startsWith('solo:') ? this.country(id.split(':')[1])?.name : id) || 'Independent';
  }
  async get(path) {
    const response = await fetch(path, { signal: this.controller.signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load the report.'); return data;
  }
  async load(state) {
    try { this.report = await this.get(`/api/games/${this.id}/review`); this.render(); }
    catch (error) {
      if (this.controller.signal.aborted) return;
      this.root.innerHTML = `<div class="aar-loading plate" data-region="report"><h2>Match concluded</h2><p role="alert">${esc(error.message)}</p><p>Saved results are unchanged.</p><button class="btn" data-aar-retry>Try again</button> <button class="btn btn-ghost" data-home="true">Back to rooms</button></div>`;
      this.fallback = state;
    }
  }
  /** Alliance colours for the final rosters (the same palette the live map uses). */
  colors() {
    const r = this.report;
    return allianceColors({ players: r.players.map(p => ({ id: p.country, side: p.side })), sides: r.alliances.map(a => ({ id: a.id, name: a.name, members: a.members })) });
  }
  render() {
    this.report.events ||= []; this.report.series ||= [];
    const r = this.report, economic = r.rules.economyShare !== undefined;
    const winner = r.alliances.find(s => s.won) || null, solo = !winner && r.outcome.winningSide ? r.players.find(p => p.side === r.outcome.winningSide) : null;
    const headline = r.outcome.draw ? (r.outcome.reason === 'negotiated_draw' ? 'A negotiated peace' : 'The council ends in a draw')
      : winner ? `Victory for the ${this.side(winner.id)}` : `${this.side(r.outcome.winningSide)} prevails`;
    const reason = r.outcome.reason === 'domination' ? (economic ? `Held 60% of active industry for ${r.rules.hold} seconds` : `Held ${r.rules.threshold} provinces for ${r.rules.hold} seconds`)
      : r.outcome.reason === 'negotiated_draw' ? 'Every remaining country joined one alliance'
      : r.outcome.draw ? `Equal ${economic ? 'industry' : 'territory'} at the deadline` : `Most ${economic ? 'industry' : 'territory'} at the deadline; first place takes half the prize, second and third a quarter each`;
    const winners = winner?.members || (solo ? [solo.country] : []);
    const mineSide = this.viewer ? r.alliances.find(s => s.members.includes(this.viewer)) : null;
    const viewerRank = mineSide ? 1 + r.alliances.filter(s => s.economy > mineSide.economy).length : Infinity;
    const verdict = r.outcome.draw ? 'Armistice' : this.viewer ? (winners.includes(this.viewer) ? 'Victory' : r.outcome.reason === 'deadline' && viewerRank <= 3 ? 'Placed' : 'Defeat') : 'After-action report';
    this.root.dataset.verdict = verdict.toLowerCase();
    const mine = this.viewer ? r.alliances.find(a => a.members.includes(this.viewer)) : null;
    const medal = mine ? { value: mine.prestige, label: 'your alliance' } : winner ? { value: winner.prestige, label: 'alliance Prestige' } : this.viewer && this.player(this.viewer) ? { value: this.player(this.viewer).prestige, label: 'your Prestige' } : null;
    const standards = (winners.length ? winners : r.alliances.find(a => a.members.length)?.members || []).slice(0, 4);
    this.root.innerHTML = `<section class="plate aar-report" data-region="report" aria-labelledby="aar-title">
<header class="victory-band"><div class="v-standards" aria-hidden="true">${standards.map(id => `<figure>${insignia(id)}<figcaption>${esc(faction(id).short)}</figcaption></figure>`).join('')}</div>
<div class="v-title"><small><span class="v-verdict">${verdict}</span> · ${esc(r.name || 'After-action report')} · ${clock(r.duration)}</small><h1 id="aar-title">${esc(headline)}</h1><p>${esc(reason)}${r.eligible ? ' · League result recorded' : ''}</p></div>
${medal ? `<div class="v-medal">${icon('laurel')}<b>${signed(medal.value)}</b><small>${medal.label}</small></div>` : ''}</header>
<nav class="aar-tabs tabs dark" role="tablist" aria-label="After-action report">${tabs.map(([id, name], i) => `<button id="aar-tab-${id}" role="tab" data-aar-tab="${id}" aria-selected="${i === 0}" aria-controls="aar-${id}" tabindex="${i === 0 ? 0 : -1}" data-sfx="press">${name}</button>`).join('')}</nav>
<div class="aar-panels">${tabs.map(([id]) => `<section id="aar-${id}" class="aar-panel aar-${id}" role="tabpanel" aria-labelledby="aar-tab-${id}" ${id === 'overview' ? '' : 'hidden'}></section>`).join('')}</div>
<footer class="card-foot report-foot"><button type="button" id="aar-back" class="btn btn-ghost" data-home="true" data-sfx="press">${icon('door')}<span>Back to rooms</span></button><button type="button" class="btn btn-ghost" data-aar-copy data-sfx="press">${icon('link')}<span>Copy report link</span></button><button type="button" id="aar-tab-replay" class="btn btn-primary" data-aar-tab="replay" data-sfx="confirm">${icon('play')}<span>Watch the replay</span></button></footer>
</section>
<section id="aar-replay" class="aar-replay" aria-label="Replay" hidden></section>`;
    this.overview();
    if (!r.historyAvailable) {
      const note = `<div class="aar-empty"><h3>History unavailable</h3><p>${esc(r.historyError || 'This older match cannot be replayed exactly.')}</p><p>No estimated replay is shown. The Overview keeps the original scores.</p></div>`;
      for (const id of ['military', 'economy', 'diplomacy']) this.el(`aar-${id}`).innerHTML = note;
      this.el('aar-replay').innerHTML = `<header class="topbar replay-bar" data-region="replay-top"><button type="button" class="bezel-btn" id="replay-exit" data-aar-tab="overview" aria-label="Back to the report" data-sfx="press">${icon('back')}</button><div class="lobby-title"><b>Replay</b><small>${esc(r.name || '')}</small></div></header><div class="replay-unavailable plate" data-region="replay-note">${note}</div>`;
      return;
    }
    this.military(); this.economy(); this.diplomacy(); this.replayLayout();
  }
  overview() {
    const r = this.report, colors = this.colors(), economic = r.rules.economyShare !== undefined;
    const alliances = [...r.alliances].sort((a, b) => Number(b.won) - Number(a.won) || b.prestige - a.prestige);
    const grouped = new Set(alliances.flatMap(a => a.members));
    const independents = [...r.players].filter(p => !grouped.has(p.country)).sort((a, b) => b.prestige - a.prestige);
    const memberRow = p => `<tr class="mem" data-result-country="${p.country}"><th scope="row">${insignia(p.country)}<span><b>${esc(this.country(p.country).name)}</b><small>${esc(this.seat(p.country))}${p.eliminatedAt !== null ? ' · fallen' : ''}</small></span></th><td>${p.land}</td>${economic ? `<td>${p.economy}</td>` : ''}<td class="c-forces">${p.troops}</td><td class="c-share">${p.victoryShare === undefined ? '—' : `${number(100 * p.victoryShare)}%`}</td><td class="c-earned">${number(p.maturity * 100)}%</td><td class="pr${p.prestige < 0 ? ' neg' : ''}">${signed(p.prestige)}</td></tr>`;
    const rank = a => 1 + r.alliances.filter(s => s.economy > a.economy).length;
    const placeTag = a => r.outcome.reason !== 'deadline' || r.outcome.draw || a.won || rank(a) > 3 ? '' : `<span class="tag">${rank(a) === 2 ? 'Second' : 'Third'}</span>`;
    const body = alliances.map(a => `<tbody style="--c:${colors[a.id] || NEUTRAL}"><tr class="grp${a.won ? ' won' : ''}" data-result-alliance="${esc(a.id)}"><th scope="rowgroup"><i class="sw"></i><span class="grp-name">${esc(this.side(a.id))}</span>${a.won ? `<span class="tag">${icon('laurel')}Victor</span>` : r.outcome.draw ? '<span class="tag draw">Draw</span>' : placeTag(a)}</th><td>${a.provinces}</td>${economic ? `<td>${a.economy}</td>` : ''}<td class="c-forces">${a.members.reduce((n, id) => n + (this.player(id)?.troops || 0), 0)}</td><td class="c-share"></td><td class="c-earned"></td><td class="pr${a.prestige < 0 ? ' neg' : ''}">${signed(a.prestige)}</td></tr>${a.members.map(id => this.player(id)).filter(Boolean).sort((x, y) => y.prestige - x.prestige).map(memberRow).join('')}</tbody>`).join('')
      + (independents.length ? `<tbody class="solo"><tr class="grp solo-head"><th scope="rowgroup" colspan="${economic ? 7 : 6}">Independent</th></tr>${independents.map(memberRow).join('')}</tbody>` : '');
    const W = 520, H = 150, total = this.map.provinces.length || 1, scale = .7;
    const series = r.series || [];
    const lines = alliances.map(a => `<polyline points="${series.map(s => { const n = s.countries.filter(c => a.members.includes(c.country)).reduce((x, c) => x + c.land, 0); return `${(s.tick / Math.max(1, r.duration) * W).toFixed(1)},${(H - Math.min(1, n / total / scale) * H).toFixed(1)}`; }).join(' ')}" style="--c:${colors[a.id] || NEUTRAL}"><title>${esc(this.side(a.id))}</title></polyline>`).join('');
    const turning = (r.events || []).filter(e => KEY_EVENTS.includes(e.type));
    const totals = r.totals || {};
    this.el('aar-overview').innerHTML = `<div class="report-body">
<section class="r-table"><h2 class="r-head">Final standings</h2><div class="r-scroll"><table id="aar-standings"><caption class="sr-only">Final standings by alliance: provinces, ${economic ? 'industry, ' : ''}forces, prize share, share earned and Prestige</caption><thead><tr><th scope="col">Alliance / country</th><th scope="col">Land</th>${economic ? '<th scope="col">Industry</th>' : ''}<th scope="col" class="c-forces">Forces</th><th scope="col" class="c-share">Share</th><th scope="col" class="c-earned">Earned</th><th scope="col">Prestige</th></tr></thead>${body}</table></div>
<p class="fine">Alliance Prestige is the total of its members' Prestige. Prestige = payout − 100; a draw awards none. Share: each member's part of the alliance prize, by final industry. Earned: time held in the final allegiance. Forces include troops still marching at the finish.</p>
<dl class="aar-facts"><div><dt>Length</dt><dd>${clock(r.duration)}</dd></div><div><dt>Battles</dt><dd>${totals.battles ?? '—'}</dd></div><div><dt>Prize awarded</dt><dd>${number(r.maximumPrize - r.unawardedPrize)}<small> / ${r.maximumPrize}</small></dd></div><div><dt>Unearned</dt><dd>${number(r.unawardedPrize)}</dd></div></dl></section>
<section class="r-side"><h2 class="r-head">Share of the map</h2><figure class="chart land-chart"><svg viewBox="-4 -6 ${W + 8} ${H + 12}" preserveAspectRatio="none" role="img" aria-label="Provinces held by each alliance over the match"><line x1="0" x2="${W}" y1="0" y2="0" class="grid"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="grid"/><line x1="0" x2="${W}" y1="${H}" y2="${H}" class="grid"/>${lines}</svg>
<figcaption><span class="axis">Top line ${Math.round(scale * 100)}% of the map · 00:00 → ${clock(r.duration)}</span>${alliances.map(a => `<span style="--c:${colors[a.id] || NEUTRAL}"><i></i>${esc(this.side(a.id))}</span>`).join('')}</figcaption></figure>
<h2 class="r-head">Turning points</h2><ol class="turning">${turning.map(e => { const tone = TONE[e.type] || 'neutral'; return `<li class="tone-${tone}"><button type="button" data-aar-seek="${e.tick}"${e.province ? ` data-aar-province="${e.province}"` : ''}><time>${clock(e.tick)}</time>${icon(TONE_ICON[tone] || 'dispatches')}<span>${esc(this.describe(e))}</span></button></li>`; }).join('')}</ol></section></div>`;
  }
  /** Chart panel: metric and comparison are brass chips (no browser form controls). */
  chartSection(kind, title, choices) {
    const s = this.chartState[kind];
    return `<div class="aar-controls"><h2 class="r-head" id="${kind}-chart-title">${title}</h2><div class="seg" role="radiogroup" aria-label="Metric">${choices.map(([value, name]) => `<button type="button" role="radio" data-chart="${kind}" data-metric="${value}" aria-checked="${s.metric === value}" data-sfx="press">${name}</button>`).join('')}</div>
<div class="compare" role="radiogroup" aria-label="Compare"><button type="button" role="radio" class="chip" data-chart="${kind}" data-compare="all" aria-pressed="${s.compare === 'all'}" aria-checked="${s.compare === 'all'}">All</button>${this.report.players.map(p => `<button type="button" role="radio" class="chip" data-chart="${kind}" data-compare="${p.country}" aria-pressed="${s.compare === p.country}" aria-checked="${s.compare === p.country}" title="${esc(this.country(p.country).name)}">${insignia(p.country)}<span>${esc(faction(p.country).short)}</span></button>`).join('')}</div></div>
<div id="${kind}-chart" class="aar-chart"></div><p class="fine">Sampled every 10 game seconds and at the finish; peaks use every tick.</p>`;
  }
  chart(kind) {
    const { metric: key, compare: focus } = this.chartState[kind];
    for (const b of this.root.querySelectorAll(`[data-chart="${kind}"]`)) { const on = b.dataset.metric ? b.dataset.metric === key : b.dataset.compare === focus; b.setAttribute('aria-checked', String(on)); if (b.classList.contains('chip')) b.setAttribute('aria-pressed', String(on)); }
    const players = this.report.players.filter(p => focus === 'all' || p.country === focus);
    const samples = this.report.series, width = 1100, height = 240, left = 60, top = 16, bottom = 35;
    const maximum = Math.max(1, ...samples.flatMap(s => s.countries.filter(p => players.some(v => v.country === p.country)).map(p => p[key])));
    const x = t => left + t / Math.max(1, this.report.duration) * (width - left - 12);
    const y = value => height - bottom - value / maximum * (height - top - bottom);
    const grid = [0, .25, .5, .75, 1].map(f => `<path d="M${left},${y(f * maximum)}H${width}"/><text x="${left - 10}" y="${y(f * maximum) + 4}" text-anchor="end">${number(f * maximum)}</text>`).join('');
    const lines = players.map(p => `<polyline fill="none" stroke="${this.country(p.country).color}" stroke-width="2.5" points="${samples.map(s => `${x(s.tick)},${y(s.countries.find(v => v.country === p.country)[key])}`).join(' ')}"><title>${esc(this.country(p.country).name)}</title></polyline>`).join('');
    this.el(`${kind}-chart`).innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(key)} over game time. Exact final and peak values are in the table below."><g class="chart-grid">${grid}<text x="${left}" y="${height - 8}">00:00</text><text x="${width - 12}" y="${height - 8}" text-anchor="end">${clock(this.report.duration)}</text></g>${lines}</svg><div class="aar-legend">${players.map(p => `<span><i style="--country:${this.country(p.country).color}"></i>${esc(this.country(p.country).name)}</span>`).join('')}</div>`;
  }
  metricsTable(columns) {
    return `<div class="r-scroll"><table class="aar-metrics"><thead><tr><th scope="col">Country</th>${columns.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${this.report.metrics.map(p => `<tr><th scope="row">${insignia(p.country)}${esc(this.country(p.country).name)}</th>${columns.map(([key]) => `<td>${number(p[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  military() {
    this.el('aar-military').innerHTML = this.chartSection('military', 'The balance of force', [['land', 'Territory'], ['troops', 'Forces in play']]) +
      this.metricsTable([['captures', 'Captures'], ['provincesLost', 'Losses'], ['battles', 'Battles'], ['peakLand', 'Peak land'], ['peakTroops', 'Peak forces']]) +
      `<h2 class="r-head">Battle ledger</h2><p class="fine">${number(this.report.totals.casualties)} casualties in all, including rounds still running at the deadline. Shared battles are not split into individual kills.</p><div class="r-scroll aar-ledger"><table><thead><tr><th scope="col">Time</th><th scope="col">Province</th><th scope="col">Garrison</th><th scope="col">Arriving armies</th><th scope="col">Result</th><th scope="col"><span class="sr-only">Watch</span></th></tr></thead><tbody>${[...this.report.battles].reverse().map(b => `<tr><td>${clock(b.tick)}</td><th scope="row">${esc(this.place(b.province))}</th><td>${esc(this.country(b.previousOwner)?.name || 'Neutral')} · ${b.before}</td><td>${b.arrivals.map(a => `${esc(this.country(a.country).name)} ${a.amount}`).join(' + ')}</td><td>${esc(this.country(b.owner)?.name || 'Neutral')} · ${b.troops} survive${b.duration ? ` · ${b.duration}s battle` : ''}${b.industryLost ? ' · industry damaged' : ''}</td><td><button type="button" class="chip" data-aar-seek="${b.tick}" data-aar-province="${b.province}" aria-label="Watch ${esc(this.place(b.province))} at ${clock(b.tick)}">Watch</button></td></tr>`).join('')}</tbody></table></div>`;
    this.chart('military');
  }
  economy() {
    const t = this.report.totals;
    this.el('aar-economy').innerHTML = this.chartSection('economy', 'Manpower and industry', [['recruited', 'Recruited'], ['production', 'Per minute'], ['invested', 'Invested']]) +
      this.metricsTable([['recruited', 'Recruited'], ['invested', 'Invested'], ['upgrades', 'Upgrades']]) +
      `<section class="aar-accounting"><h2 class="r-head">Every troop accounted for</h2><p><b>${number(t.initialTroops)}</b> at the start + <b>${number(t.recruited)}</b> recruited − <b>${number(t.invested)}</b> invested − <b>${number(t.casualties)}</b> casualties${t.interned ? ` − <b>${number(t.interned)}</b> interned` : ''} = <b>${number(t.remainingTroops)}</b> remaining.</p><p class="fine">Includes neutral defenders and troops on the march. Captures and gifts to allies move troops; they never create or destroy them.</p></section>`;
    this.chart('economy');
  }
  diplomacy() {
    const history = this.report.events.filter(e => KEY_EVENTS.includes(e.type));
    const wire = (this.report.messages || []).length ? `<h2 class="r-head">What they said</h2><p class="fine">Public AI seats disclose their world messages, their messages to other public AI seats, and chat in alliances where every member was a public AI seat. Everyone else stays private.</p><div class="wire-shell"><nav id="wire-thread-list" class="wire-thread-list" aria-label="Disclosed conversations"></nav><section class="wire-reader" aria-label="Conversation"><div class="wire-reader-head"><h3 id="wire-heading"></h3><label class="field">Find<span class="slot"><input id="wire-search" type="search" placeholder="Words or countries" autocomplete="off"></span></label></div><ol id="wire-messages" class="wire-messages" aria-live="polite"></ol></section></div>` : '';
    this.el('aar-diplomacy').innerHTML = `${wire}<h2 class="r-head">Alliances through the match</h2><p class="fine">Only active membership counts. Private offers stay private.</p><div class="aar-tenures">${this.report.players.map(p => `<div class="aar-tenure-row"><b>${insignia(p.country)}${esc(faction(p.country).short)}</b><div class="aar-tenure-track">${this.report.tenures.filter(t => t.country === p.country && t.end > t.start).map(t => `<button type="button" style="left:${100 * t.start / this.report.duration}%;width:${100 * (t.end - t.start) / this.report.duration}%" class="${t.side.startsWith('solo:') ? 'independent' : ''}" data-aar-seek="${t.start}" title="${esc(this.side(t.side))} · ${clock(t.start)}–${clock(t.end)}" aria-label="${esc(this.side(t.side))}, ${esc(this.country(p.country).name)}, ${clock(t.start)} to ${clock(t.end)}">${esc(this.side(t.side))}</button>`).join('')}</div></div>`).join('')}</div><h2 class="r-head">Turning points</h2><p class="fine">Open a moment to see the map at that exact time.</p><div class="aar-timeline">${history.map(e => this.eventButton(e)).join('')}</div>`;
    if (wire) { if (this.el('wire-search')) this.el('wire-search').value = this.wireQuery; this.renderWire(); }
  }
  wireKey(m) { return m.channel === 'world' ? 'world' : m.channel === 'alliance' ? `alliance:${m.side}` : `dm:${[m.from, m.to].sort().join(':')}`; }
  wireThreads() {
    const messages = this.report.messages || [], groups = new Map();
    for (const m of messages) { const key = this.wireKey(m), g = groups.get(key) || { key, messages: [], last: 0 }; g.messages.push(m); g.last = m.tick; groups.set(key, g); }
    const label = key => key === 'world' ? 'World' : key.startsWith('alliance:') ? this.side(key.slice(9)) : key.slice(3).split(':').map(id => this.country(id)?.name || id).join(' ↔ ');
    return [{ key: 'all', label: 'Everything disclosed', messages, last: messages.at(-1)?.tick || 0 },
      ...[...groups.values()].sort((a, b) => b.last - a.last).map(g => ({ ...g, label: label(g.key) }))];
  }
  /** Disclosed messages: player text only through textContent. */
  renderWire() {
    const list = this.el('wire-thread-list'), body = this.el('wire-messages'); if (!list || !body) return;
    const threads = this.wireThreads(), selected = threads.find(t => t.key === this.wireThread) || threads[0];
    list.replaceChildren(...threads.map(t => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'wire-thread'; b.dataset.wireThread = t.key; b.setAttribute('aria-pressed', String(t.key === selected.key));
      const name = document.createElement('b'); name.textContent = t.label;
      const meta = document.createElement('small'); meta.textContent = `${t.messages.length} ${t.messages.length === 1 ? 'message' : 'messages'} · last ${clock(t.last)}`;
      b.append(name, meta); return b;
    }));
    const query = this.wireQuery.trim().toLocaleLowerCase();
    const shown = selected.messages.filter(m => !query || [m.text, m.leaderName, this.country(m.from)?.name, this.country(m.to)?.name, m.side && this.side(m.side)].some(v => String(v || '').toLocaleLowerCase().includes(query)));
    this.el('wire-heading').textContent = `${selected.label} · ${shown.length} ${shown.length === 1 ? 'message' : 'messages'}`;
    if (!shown.length) { const empty = document.createElement('li'); empty.className = 'wire-empty'; empty.textContent = 'No disclosed messages match this view.'; body.replaceChildren(empty); return; }
    body.replaceChildren(...shown.map(m => {
      const li = document.createElement('li'); li.className = 'wire-letter'; li.dataset.channel = m.channel;
      const head = document.createElement('header'), who = document.createElement('b'), to = document.createElement('small');
      who.textContent = `${this.country(m.from)?.name || m.from}${m.leaderName ? ` · ${m.leaderName}` : ''}`;
      to.textContent = `${m.channel === 'dm' ? `To ${this.country(m.to)?.name || m.to}` : m.channel === 'alliance' ? this.side(m.side) : 'To the world'} · ${clock(m.tick)}`;
      head.append(who, to);
      const text = document.createElement('p'); text.textContent = m.text;
      const seek = document.createElement('button'); seek.type = 'button'; seek.className = 'chip'; seek.dataset.aarSeek = String(m.tick); seek.textContent = 'Watch this moment';
      li.append(head, text, seek); return li;
    }));
  }
  describe(e) {
    const c = id => this.country(id)?.name || 'Neutral';
    switch (e.type) {
      case 'capture': return `${c(e.owner)} takes ${this.place(e.province)} from ${c(e.previousOwner)}.`;
      case 'alliance_activated': return `${e.name} becomes active: ${e.roster.map(c).join(', ')}.`;
      case 'departed': return `${c(e.country)} leaves ${this.side(e.formerSide)}.`;
      case 'coalition_dissolved': return `${this.side(e.side)} dissolves.`;
      case 'war_declared': return `${e.fromRoster.map(c).join(' + ')} declares war on ${e.toRoster.map(c).join(' + ')}.`;
      case 'peace_accepted': return `${e.fromRoster.map(c).join(' + ')} and ${e.toRoster.map(c).join(' + ')} agree to peace.`;
      case 'army_interned': return `${e.amount} troops from ${c(e.country)} are interned at ${this.place(e.province)}.`;
      case 'dominance': return `${this.side(e.side)} starts a victory countdown.`;
      case 'dominance_broken': return `${this.side(e.side)}’s countdown stops. ${e.reason}`;
      case 'development_started': return `${c(e.country)} invests ${e.cost} in ${this.place(e.province)}.`;
      case 'development_completed': return `${this.place(e.province)} reaches industry ${e.level}.`;
      case 'army_recalled': return `${c(e.country)} recalls ${e.amount} toward ${this.place(e.to)}.`;
      case 'army_turned_around': return `${c(e.country)} turns ${e.amount} troops back toward ${this.place(e.to)}.`;
      case 'eliminated': return `${c(e.country)} is eliminated.`;
      case 'finished': return 'The match ends. Final scores are fixed.';
      case 'dispatch': return `${c(e.from)} sends a disclosed message.`;
      default: return e.type.replaceAll('_', ' ');
    }
  }
  eventButton(e) {
    const tone = TONE[e.type] || 'neutral';
    return `<button type="button" class="aar-event tone-${tone}" data-aar-seek="${e.tick}" ${e.province ? `data-aar-province="${e.province}"` : ''}><time>${clock(e.tick)}</time>${icon(TONE_ICON[tone] || 'dispatches')}<span>${esc(this.describe(e))}</span></button>`;
  }
  replayLayout() {
    const r = this.report, winner = r.alliances.find(a => a.won);
    const marks = r.events.filter(e => ['alliance_activated', 'war_declared', 'peace_accepted', 'dominance', 'dominance_broken', 'finished', 'capture', 'eliminated'].includes(e.type))
      .map(e => `<i class="mark m-${e.type}" style="--x:${e.tick / Math.max(1, r.duration)}"></i>`).join('');
    const allianceChat = r.allianceChatRevealed && r.allianceChat?.length, chat = allianceChat || r.messages?.length;
    this.el('aar-replay').innerHTML = `<header class="topbar replay-bar" data-region="replay-top"><button type="button" class="bezel-btn" id="replay-exit" data-aar-tab="overview" aria-label="Back to the after-action report" title="After-action report" data-sfx="press">${icon('back')}</button>
<div class="lobby-title"><b>Replay · ${esc(r.name || '')}</b><small>${esc(r.outcome.draw ? 'Ended in a draw' : winner ? `${this.side(winner.id)} won` : `${this.side(r.outcome.winningSide)} won`)}</small></div>
<div class="clock-plaque"><div class="clock-face">${icon('clock')}<b id="replay-clock-now">00:00</b><small>/ ${clock(r.duration)}</small></div><output id="replay-clock" class="sr-only" aria-live="off">00:00 / ${clock(r.duration)}</output><span class="victory">Drag the timeline or press play</span></div>
<button id="replay-expand" class="bezel-btn expand-button" type="button" aria-pressed="false" data-sfx="press"></button></header>
<p id="replay-loading" class="replay-loading" role="status" data-region="replay-loading">Open the replay to load the recorded map.</p>
<div id="replay-stage" class="replay-stage" data-tick="0" hidden>
<svg id="review-map" class="replay-map" viewBox="0 0 1280 680" role="group" aria-label="Replay map; select a province to inspect it"></svg>
<div class="replay-overlay"><div class="replay-left"><div id="replay-key" class="replay-key" data-region="replay-key"></div><section id="replay-inspector" class="plate replay-inspector" data-region="replay-inspector" aria-live="polite" hidden></section></div><div class="camera replay-camera" data-region="replay-camera" role="group" aria-label="Replay map view"><button type="button" class="bezel-btn zoom-button" data-aar-map="in" aria-label="Zoom replay in" data-sfx="press">${icon('plus')}</button><button type="button" class="bezel-btn zoom-button" data-aar-map="out" aria-label="Zoom replay out" data-sfx="press">${icon('minus')}</button><button type="button" class="bezel-btn" data-aar-map="europe" aria-label="Europe" title="Europe" data-sfx="press">${icon('land')}</button><button type="button" class="bezel-btn" data-aar-map="world" aria-label="World view" title="World view" data-sfx="press">${icon('globe')}</button></div></div></div>
<aside class="replay-side" aria-label="Standings and history at this moment">
<section class="replay-leaderboard" data-region="replay-standings" aria-label="Standings at this moment"><header class="plaque"><h2><button class="lb-toggle" type="button" aria-expanded="true"><span id="replay-standings-title">Standings at 00:00</span></button></h2><span class="lb-summary plaque-note"></span><div class="tabs lb-modes" role="group" aria-label="Rank"><button type="button" data-lb-mode="teams" aria-pressed="true">Teams</button><button type="button" data-lb-mode="players" aria-pressed="false">Players</button></div></header>
<div class="lb-body"><div class="lb-columns" aria-hidden="true"><span>#</span><span>Power</span><span>Land</span><span>Troops</span></div><ol class="lb-rows"></ol><h3 class="lb-fronts-title">${icon('war')}War fronts <small class="lb-front-count"></small></h3><ul class="lb-fronts" aria-label="Wars between blocs"></ul></div></section>
<section class="replay-history" data-region="replay-history" aria-label="History up to this moment"><header class="plaque"><h2 id="replay-history-title">History to 00:00</h2><div class="tabs replay-filters" role="group" aria-label="Show"><button type="button" data-replay-filter="all" aria-pressed="true">All</button><button type="button" data-replay-filter="events" aria-pressed="false">Headlines</button>${chat ? `<button type="button" data-replay-filter="chat" aria-pressed="false">${allianceChat && !r.messages?.length ? 'Alliance chat' : 'Messages'}</button>` : ''}</div></header>
<ol id="replay-feed" class="replay-feed cx-rows"></ol><p class="replay-feed-note">${allianceChat ? 'Alliance chat was announced as public after the match. ' : ''}${r.messages?.length ? 'Public AI seats disclose their messages. ' : ''}Select a row to jump there.</p></section>
<div class="replay-side-tabs tabs dark" role="tablist" aria-label="Standings or history"><button type="button" role="tab" aria-selected="true" data-replay-pane="standings">Standings</button><button type="button" role="tab" aria-selected="false" data-replay-pane="history">History</button></div>
</aside>
<section class="plate timeline" data-region="replay-timeline" aria-label="Replay controls">
<div class="transport"><button type="button" class="bezel-btn" data-aar-transport="start" aria-label="Go to the opening" data-sfx="press">${icon('first')}</button><button type="button" class="bezel-btn" data-aar-transport="back" aria-label="Back ten game seconds" data-sfx="press">${icon('rewind')}</button><button type="button" class="play" id="replay-play" data-aar-transport="play" aria-label="Play replay" disabled data-sfx="press">${icon('play')}<span class="sr-only play-word">Play</span></button><button type="button" class="bezel-btn" data-aar-transport="forward" aria-label="Forward ten game seconds" data-sfx="press">${icon('forward')}</button><button type="button" class="bezel-btn" data-aar-transport="end" aria-label="Go to the final moment" data-sfx="press">${icon('last')}</button>
<div class="seg speed" id="replay-speed" role="radiogroup" aria-label="Replay speed">${SPEEDS.map(s => `<button type="button" role="radio" data-speed="${s}" aria-checked="${s === this.speed}" data-sfx="press">${s}×</button>`).join('')}</div></div>
<div class="scrub"><div class="track" style="--p:0">${marks}<i class="done"></i><b class="head"><span id="replay-head">00:00</span></b><label class="sr-only" for="replay-slider">Replay game time</label><input id="replay-slider" type="range" min="0" max="${r.duration}" value="0" step="1" disabled aria-valuetext="00:00"></div><div class="scale"><span>00:00</span><span>${clock(r.duration / 2)}</span><span>${clock(r.duration)}</span></div></div>
<div class="next"><button type="button" class="chip" data-aar-event="previous" aria-label="Previous event" data-sfx="press">${icon('rewind')}</button><p id="replay-event-label">The opening position</p><button type="button" class="chip" data-aar-event="next" aria-label="Next event" data-sfx="press">${icon('forward')}</button></div>
</section>`;
    this.el('aar-replay').dataset.pane = 'standings';
    this.buildHistory();
  }
  /** The replay's history thread: public events plus (only when the room announced it) revealed alliance chat,
   * shown up to the scrubbed tick; a row seeks there. Chat is player text: textContent only. */
  buildHistory() {
    const list = this.el('replay-feed'); if (!list) return;
    const revealed = this.report.allianceChatRevealed ? this.report.allianceChat || [] : [];
    const disclosed = (this.report.messages || []).filter(m => !(revealed.length && m.channel === 'alliance'))
      .map(m => ({ tick: m.tick, from: m.from, sideName: m.channel === 'alliance' ? this.side(m.side) : m.channel === 'dm' ? `to ${this.country(m.to)?.name || m.to}` : 'World', text: m.text }));
    const rows = [...this.report.events.filter(e => e.type !== 'dispatch').map(e => ({ tick: e.tick, kind: 'event', e })),
      ...[...revealed, ...disclosed].map(m => ({ tick: m.tick, kind: 'chat', m }))]
      .sort((a, b) => a.tick - b.tick || (a.kind === 'chat') - (b.kind === 'chat'));
    this.historyRows = rows.map(row => {
      const tone = row.kind === 'chat' ? 'chat' : TONE[row.e.type] || 'neutral', marker = row.kind === 'event' && KEY_EVENTS.includes(row.e.type);
      const li = document.createElement('li'); li.className = `replay-row replay-${row.kind} ${row.kind === 'chat' ? 'cx-msg' : marker ? 'cx-marker' : 'cx-headline'}`; li.dataset.tick = String(row.tick); li.dataset.tone = tone;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.aarSeek = String(row.tick);
      if (row.e?.province) button.dataset.aarProvince = row.e.province;
      const when = document.createElement('time'); when.textContent = clock(row.tick);
      const text = document.createElement('span');
      if (row.kind === 'chat') {
        const who = document.createElement('b'); who.textContent = `${this.country(row.m.from)?.name || row.m.from} · ${row.m.sideName || 'Alliance'}: `;
        text.append(who, document.createTextNode(row.m.text)); // revealed player speech, text only
      } else text.textContent = this.describe(row.e);
      button.append(text, when); li.append(button); list.append(li);
      return { ...row, li };
    });
    this.filterHistory('all');
  }
  filterHistory(filter) {
    this.historyFilter = filter;
    for (const b of this.root.querySelectorAll('[data-replay-filter]')) b.setAttribute('aria-pressed', String(b.dataset.replayFilter === filter));
    this.paintHistory(true);
  }
  paintHistory(force = false) {
    if (!this.historyRows) return;
    const tick = Math.floor(this.position), list = this.el('replay-feed');
    if (!force && tick === this.historyTick) return; this.historyTick = tick;
    let current = null;
    for (const row of this.historyRows) {
      const shown = row.tick <= tick && (this.historyFilter === 'all' || (this.historyFilter === 'chat') === (row.kind === 'chat'));
      row.li.hidden = !shown; row.li.classList.remove('current');
      if (shown) current = row;
    }
    current?.li.classList.add('current');
    if (current) list.scrollTop = Math.max(0, current.li.offsetTop - list.clientHeight + current.li.offsetHeight + 8);
  }
  /** Map effects for events crossed while playing forward only (never when scrubbing or jumping). */
  forwardEffects(from, to) {
    if (!this.atlas || to <= from) return;
    for (const e of this.report.events) {
      if (e.tick <= from || e.tick > to) continue;
      const plan = e.type === 'war_declared' ? ['war', { from: e.fromRoster, to: e.toRoster }] : e.type === 'peace_accepted' ? ['peace', { from: e.fromRoster, to: e.toRoster }]
        : e.type === 'alliance_activated' ? ['alliance', { countries: e.roster }] : e.type === 'eliminated' ? ['eliminated', { country: e.country }]
        : e.type === 'capture' && e.owner ? ['captured', { province: e.province, owner: e.owner }] : null;
      if (plan) { try { this.atlas.effect(...plan); this.effectsPlayed = (this.effectsPlayed || 0) + 1; } catch { /* decorative */ } }
    }
  }
  async ensureReplay() {
    if (this.reader || !this.report.historyAvailable) return;
    if (this.replayPromise) return this.replayPromise;
    this.el('replay-loading').textContent = 'Loading the recorded match…';
    this.replayPromise = (async () => {
      try {
        const replay = await this.get(`/api/games/${this.id}/replay`);
        if (this.controller.signal.aborted) return;
        this.reader = replayReader(replay); this.map = replay.map;
        this.el('replay-stage').hidden = false; this.el('replay-loading').hidden = true;
        this.atlas = new Atlas(this.el('review-map'), this.map, id => { this.inspected = id; this.paint(); }, { legend: { placement: 'top-left', container: this.el('replay-key'), collapsed: true } });
        // The same team leaderboard as the live match, fed the board at the scrubbed tick (public data only).
        const box = this.root.querySelector('.replay-leaderboard');
        this.standings = new LeaderboardPanel({ root: box, rows: box.querySelector('.lb-rows'), toggle: box.querySelector('.lb-toggle'), summary: box.querySelector('.lb-summary'),
          modes: [...box.querySelectorAll('[data-lb-mode]')], fronts: box.querySelector('.lb-fronts'), frontCount: box.querySelector('.lb-front-count'),
          onFocus: id => this.atlas?.setRelationFocus(id), onSelect: id => this.atlas?.setRelationFocus(id) },
          { country: id => this.country(id)?.name || id, short: id => faction(id).short });
        for (const b of box.querySelectorAll('[data-lb-mode]')) b.addEventListener('click', () => { this.standings.setMode(b.dataset.lbMode); this.paintedTick = null; this.paint(); });
        box.querySelector('.lb-toggle').addEventListener('click', () => this.standings.setOpen(!this.standings.open));
        // Expand: the replay fills the screen (works without the Fullscreen API).
        this.expander = new ExpandableMap(this.el('aar-replay'), this.el('replay-expand'), { label: 'replay', iconOnly: true,
          onChange: () => requestAnimationFrame(() => { this.atlas?.layout(); this.atlas?.positions(); }) });
        this.el('replay-play').disabled = false; this.el('replay-slider').disabled = false; this.seek(this.position);
        requestAnimationFrame(() => { this.atlas?.world(); this.atlas?.positions(); });
      } catch (error) {
        if (!this.controller.signal.aborted) this.el('replay-loading').innerHTML = `${esc(error.message)} <button type="button" class="btn small" data-aar-load>Try again</button>`;
      } finally { this.replayPromise = null; }
    })();
    return this.replayPromise;
  }
  async showTab(id) {
    this.pause();
    if (id === 'replay') {
      this.root.dataset.view = 'replay'; this.el('aar-replay').hidden = false; this.root.querySelector('.aar-report').hidden = true;
      await this.ensureReplay(); this.atlas?.layout(); this.atlas?.positions(); return;
    }
    if (!tabs.some(([key]) => key === id)) return;
    this.expander?.set(false, { fromBrowser: true });
    this.root.dataset.view = 'report'; this.el('aar-replay').hidden = true; this.root.querySelector('.aar-report').hidden = false;
    this.tab = id;
    for (const [key] of tabs) {
      const active = key === id, button = this.el(`aar-tab-${key}`);
      this.el(`aar-${key}`).hidden = !active; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    }
  }
  seek(at) {
    this.position = Math.max(0, Math.min(this.report.duration, at));
    if (this.reader) this.paint();
  }
  paint() {
    const tick = Math.floor(this.position), duration = this.report.duration;
    this.el('aar-replay').querySelector('.track').style.setProperty('--p', String(this.position / Math.max(1, duration)));
    if (tick === this.paintedTick && this.inspected === this.paintedProvince) {
      this.atlas.state = { ...this.atlas.state, tick: this.position }; this.atlas.positions(); return;
    }
    this.paintedTick = tick; this.paintedProvince = this.inspected;
    const board = this.reader(tick);
    this.atlas.update(board, null, this.inspected || null);
    // Interpolate marching position only, never ownership, troops or membership.
    this.atlas.state = { ...board, tick: this.position }; this.atlas.positions();
    const slider = this.el('replay-slider');
    slider.value = tick; slider.setAttribute('aria-valuetext', `${clock(tick)} of ${clock(duration)}`);
    this.el('replay-clock').textContent = `${clock(tick)} / ${clock(duration)}`;
    this.el('replay-clock-now').textContent = clock(tick); this.el('replay-head').textContent = clock(tick);
    this.el('replay-standings-title').textContent = `Standings at ${clock(tick)}`; this.el('replay-history-title').textContent = `History to ${clock(tick)}`;
    this.el('replay-stage').dataset.tick = tick;
    const kinds = new Map(this.report.players.map(p => [p.country, p]));
    this.standings?.update({ ...board, players: board.players.map(p => ({ ...p, kind: kinds.get(p.id)?.kind, model: kinds.get(p.id)?.model })) }, 8);
    this.paintHistory();
    const last = this.report.events.filter(e => e.tick <= tick).at(-1);
    this.el('replay-event-label').textContent = last ? `${clock(last.tick)} · ${this.describe(last)}` : 'The opening position';
    const p = board.provinces.find(p => p.id === this.inspected), box = this.el('replay-inspector');
    box.hidden = !p;
    if (p) {
      const incoming = board.armies.filter(a => a.to === p.id).sort((a, b) => a.arrivesAt - b.arrivesAt);
      const lastBattle = this.report.battles.filter(b => b.province === p.id && b.tick <= tick).at(-1);
      setHTML(box, `<header class="plaque"><h2>${esc(this.place(p.id))}</h2><button type="button" class="bezel-btn mini" data-aar-inspect-close aria-label="Close" data-sfx="press">${icon('close')}</button></header><div class="inspector-body"><p>${p.owner ? insignia(p.owner) : ''}<span>${esc(this.country(p.owner)?.name || 'Neutral')}${p.owner ? ` · ${esc(this.seat(p.owner))}` : ''}</span></p><p><b>${p.troops}</b> troops · industry ${p.development}${p.route ? ` · recruits walk to ${esc(this.place(p.route))}` : ''}</p>${lastBattle ? `<p class="fine">Last battle ${clock(lastBattle.tick)}: ${lastBattle.troops} survived.</p>` : ''}<h3>Incoming waves</h3>${incoming.length ? incoming.slice(0, 4).map(a => `<p class="fine">${a.amount} ${esc(this.country(a.country).name)} · ${a.returning ? 'returning' : 'marching'} · ${clock(a.arrivesAt)}${a.arrivesAt > duration ? ' (after the finish)' : ''}</p>`).join('') : '<p class="fine">None on the way at this moment.</p>'}</div>`);
    }
  }
  pause() {
    this.playing = false; cancelAnimationFrame(this.animation); this.animation = null;
    const button = this.el('replay-play'); if (button) { button.innerHTML = `${icon('play')}<span class="sr-only play-word">Play</span>`; button.setAttribute('aria-label', 'Play replay'); button.setAttribute('aria-pressed', 'false'); }
  }
  play() {
    if (!this.reader) return;
    if (this.playing) { this.pause(); return; }
    if (this.position >= this.report.duration) this.seek(0);
    this.playing = true; const button = this.el('replay-play');
    button.innerHTML = `${icon('pause')}<span class="sr-only play-word">Pause</span>`; button.setAttribute('aria-label', 'Pause replay'); button.setAttribute('aria-pressed', 'true');
    let last = performance.now();
    const frame = now => {
      if (!this.playing) return;
      const delta = Math.min(.25, (now - last) / 1000); last = now;
      const before = Math.floor(this.position);
      this.seek(this.position + delta * this.speed);
      this.forwardEffects(before, Math.floor(this.position));
      if (this.position >= this.report.duration) { this.pause(); return; }
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }
  async click(event) {
    const button = event.target.closest('button'); if (!button || !this.root.contains(button)) return;
    if (button.hasAttribute('data-aar-retry')) { this.load(this.fallback); return; }
    if (button.hasAttribute('data-aar-load')) { await this.ensureReplay(); return; }
    if (button.hasAttribute('data-aar-copy')) {
      try { await navigator.clipboard.writeText(location.href); button.querySelector('span').textContent = 'Link copied'; }
      catch { prompt('Copy this report link:', location.href); }
      return;
    }
    if (button.hasAttribute('data-aar-inspect-close')) { this.inspected = null; this.paintedTick = null; this.paint(); return; }
    if (button.dataset.replayPane) {
      this.el('aar-replay').dataset.pane = button.dataset.replayPane;
      for (const b of this.root.querySelectorAll('[data-replay-pane]')) b.setAttribute('aria-selected', String(b === button));
      if (button.dataset.replayPane === 'history') this.paintHistory(true);
      return;
    }
    if (button.dataset.aarTab) await this.showTab(button.dataset.aarTab);
    if (button.dataset.replayFilter) this.filterHistory(button.dataset.replayFilter);
    if (button.dataset.wireThread) { this.wireThread = button.dataset.wireThread; this.renderWire(); return; }
    if (button.dataset.chart) {
      const s = this.chartState[button.dataset.chart];
      if (button.dataset.metric) s.metric = button.dataset.metric; else s.compare = button.dataset.compare;
      this.chart(button.dataset.chart); return;
    }
    if (button.dataset.speed) {
      this.speed = Number(button.dataset.speed);
      for (const b of this.root.querySelectorAll('[data-speed]')) b.setAttribute('aria-checked', String(b === button));
      return;
    }
    if (button.hasAttribute('data-aar-seek')) {
      await this.showTab('replay'); this.seek(Number(button.dataset.aarSeek));
      if (button.dataset.aarProvince && this.atlas) { this.inspected = button.dataset.aarProvince; this.atlas.focus(this.inspected); this.paintedTick = null; this.paint(); }
    }
    if (button.dataset.aarTransport && this.reader) {
      const action = button.dataset.aarTransport;
      if (action === 'play') this.play();
      else { this.pause(); this.seek(action === 'start' ? 0 : action === 'end' ? this.report.duration : this.position + (action === 'back' ? -10 : 10)); }
    }
    if (button.dataset.aarEvent && this.reader) {
      this.pause(); const ticks = [...new Set(this.report.events.filter(e => e.type !== 'dispatch').map(e => e.tick))];
      const at = button.dataset.aarEvent === 'next' ? ticks.find(t => t > this.position) ?? this.report.duration
        : ticks.filter(t => t < this.position).at(-1) ?? 0;
      this.seek(at);
    }
    if (button.dataset.aarMap && this.atlas) {
      const key = button.dataset.aarMap;
      if (key === 'world') this.atlas.world(); else if (key === 'europe') this.atlas.europe(); else this.atlas.zoom(key === 'in' ? .7 : 1.4);
      this.atlas.positions();
    }
  }
  keydown(event) {
    if (event.target.closest('.aar-tabs') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const i = tabs.findIndex(([id]) => id === this.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      this.showTab(tabs[next][0]); this.el(`aar-tab-${tabs[next][0]}`).focus(); return;
    }
    if (this.root.dataset.view !== 'replay' || !this.reader) return;
    const typing = event.target.closest('input:not([type=range]),textarea,select');
    if (typing) return;
    if (event.key === ' ' && !event.target.closest('button')) { event.preventDefault(); this.play(); }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.id !== 'replay-slider' && !event.target.closest('[role=tablist],.tabs,.seg')) {
      event.preventDefault(); this.pause(); this.seek(this.position + (event.key === 'ArrowRight' ? 10 : -10));
    }
  }
  destroy() { this.pause(); this.controller.abort(); this.expander?.destroy(); this.atlas?.destroy(); }
}
