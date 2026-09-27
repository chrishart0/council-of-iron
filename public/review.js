import { icon, insignia } from './presentation.js';
import { Atlas } from './atlas.js';
import { escapeHTML as esc, setHTML } from './ui.js';
import { replayReader } from './replay-model.js';
import { ExpandableMap } from './expand.js';
const clock = n => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
const number = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const signed = n => `${n >= 0 ? '+' : '−'}${number(Math.abs(n))}`;
const tabs = [['overview', 'Overview'], ['replay', 'Map replay'], ['military', 'Military'], ['economy', 'Economy'], ['diplomacy', 'Diplomacy']];

/** A read-only view; it deliberately has no reference to the gameplay command function. */
export class AfterAction {
  constructor(root, state, map) {
    this.root = root; this.id = state.id; this.viewer=state.you; this.map = map; this.tab = 'overview';
    this.controller = new AbortController(); this.position = 0; this.speed = 16; this.playing = false;
    this.root.innerHTML = '<p class="aar-loading" role="status">Preparing the after-action report…</p>';
    const options = { signal: this.controller.signal };
    this.root.addEventListener('click', event => this.click(event), options);
    this.root.addEventListener('change', event => this.change(event), options);
    this.root.addEventListener('input', event => {
      if (event.target.id === 'replay-slider') { this.pause(); this.seek(Number(event.target.value)); }
    }, options);
    this.root.addEventListener('keydown', event => this.keydown(event), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, options);
    this.load(state);
  }
  el(id) { return this.root.querySelector(`#${id}`); }
  country(id) { return this.map.countries.find(c => c.id === id); }
  playerName(id) {
    const player = this.report?.players.find(p => p.country === id);
    return player?.displayName || player?.name || player?.model || 'Unknown player';
  }
  place(id) { return this.map.provinces.find(p => p.id === id)?.name || id; }
  side(id) {
    const name = this.report?.sideNames?.find(s => s.id === id)?.name || this.report?.alliances.find(s => s.id === id)?.name;
    return this.country(name)?.name || name || (id?.startsWith('solo:') ? this.country(id.split(':')[1])?.name : id) || 'Independent';
  }
  async get(path) {
    // Both endpoints publish the same public record to participants and spectators.
    const response = await fetch(path, { signal: this.controller.signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load review.'); return data;
  }
  async load(state) {
    try { this.report = await this.get(`/api/games/${this.id}/review`); this.render(); }
    catch (error) {
      if (this.controller.signal.aborted) return;
      this.root.innerHTML = `<div class="aar-loading"><h2>Match concluded</h2><p role="alert">${esc(error.message)}</p><p>Saved results are unchanged.</p><button data-aar-retry>Retry report</button></div>`;
      this.fallback = state;
    }
  }
  render() {
    const r = this.report, winner = r.outcome.draw ? (r.outcome.reason === 'negotiated_draw' ? 'A negotiated peace.' : 'The council ends in a draw.') : `${this.side(r.outcome.winningSide)} prevails.`;
    const economic = r.rules.economyShare !== undefined;
    const reason = r.outcome.reason === 'domination' ? economic
      ? `Held 60% of active industry for ${r.rules.hold} seconds.` : `Held ${r.rules.threshold} provinces for ${r.rules.hold} seconds.`
      : r.outcome.reason === 'negotiated_draw' ? 'Every original country joined one coalition.'
      : r.outcome.draw ? `Equal ${economic ? 'economic output' : 'territory'} at the deadline.`
      : `Most ${economic ? 'economic output' : 'territory'} at the deadline.`;
    this.root.classList.add('after-action');
    const winners=r.alliances.find(s=>s.won)?.members || [];
    const verdict=r.outcome.draw?'Armistice':this.viewer?(winners.includes(this.viewer)?'Victory':'Defeat'):'Campaign concluded';
    this.root.dataset.verdict=verdict.toLowerCase();
    this.root.innerHTML = `<header class="aar-header"><div class="victory-seals" aria-hidden="true">${(winners.length?winners:[null]).map(id=>insignia(id)).join('')}</div><div class="aar-verdict"><span class="victory-word">${verdict}</span><p class="eyebrow">AFTER-ACTION REPORT · ${esc(r.scenario)} · ${clock(r.duration)}</p><h2>${esc(winner)}</h2><p>${esc(reason)}</p><small>${r.eligible ? 'League result recorded.' : 'Experimental result recorded; not a competitive rating.'}</small></div><div class="aar-header-actions"><button data-aar-tab="replay">Watch the campaign →</button><button class="primary" data-home="true">New council</button></div></header>
      <nav class="aar-tabs" role="tablist" aria-label="After-action reports">${tabs.map(([id, name], i) => `<button id="aar-tab-${id}" role="tab" data-aar-tab="${id}" aria-selected="${i === 0}" aria-controls="aar-${id}" tabindex="${i === 0 ? 0 : -1}">${icon(id)}${name}</button>`).join('')}</nav>
      ${tabs.map(([id]) => `<section id="aar-${id}" class="aar-panel" role="tabpanel" aria-labelledby="aar-tab-${id}" ${id === 'overview' ? '' : 'hidden'}></section>`).join('')}`;
    this.overview();
    if (!r.historyAvailable) {
      for (const id of ['replay', 'military', 'economy', 'diplomacy']) this.el(`aar-${id}`).innerHTML = `<div class="aar-empty"><h3>History unavailable</h3><p>${esc(r.historyError)}</p><p>No estimated or fabricated replay is shown. The Overview still contains the original scores.</p></div>`;
      return;
    }
    this.military(); this.economy(); this.diplomacy(); this.replayLayout();
  }
  overview() {
    const r = this.report;
    const alliances = [...r.alliances].sort((a, b) => Number(b.won) - Number(a.won) || (r.rules.economyShare === undefined ? b.provinces - a.provinces : b.economy - a.economy));
    const players = [...r.players].sort((a, b) => b.prestige - a.prestige || b.land - a.land);
    this.el('aar-overview').innerHTML = `<div class="aar-kpis"><div><span>CAMPAIGN LENGTH</span><b>${clock(r.duration)}</b></div><div><span>BATTLES RESOLVED</span><b>${r.totals?.battles ?? '—'}</b></div><div><span>PRIZE DISTRIBUTED</span><b>${number(r.maximumPrize - r.unawardedPrize)}<small> / ${r.maximumPrize}</small></b></div><div><span>UNEARNED PRIZE</span><b>${number(r.unawardedPrize)}</b></div></div>
      <div class="aar-section-heading"><div><p class="eyebrow">THE FINAL ALLEGIANCES</p><h3>Alliance results</h3></div><p>Alliance Prestige sums the final roster’s individual scores.<br>It is not an additional reward.</p></div>
      <div id="aar-alliances" class="aar-alliances">${alliances.map(s => `<article class="aar-alliance ${s.won ? 'victorious' : ''}"><span class="aar-outcome">${r.outcome.draw ? 'DRAW' : s.won ? 'VICTORIOUS' : 'DEFEATED'}</span><h3>${esc(this.side(s.id))}</h3><div class="aar-roster">${s.members.map(id => `<span>${insignia(id)}${esc(this.country(id).name)} · ${esc(this.playerName(id))}</span>`).join('')}</div><div class="aar-alliance-numbers"><div><small>Alliance Prestige</small><strong>${signed(s.prestige)}</strong></div><div><small>${r.rules.economyShare === undefined ? 'Final territory' : 'Final industry'}</small><strong>${r.rules.economyShare === undefined ? s.provinces : s.economy}</strong></div><div><small>Payout</small><strong>${number(s.payout)}</strong></div></div></article>`).join('')}</div>
      <div class="aar-section-heading"><div><p class="eyebrow">EVERY SEAT, EVERY SHARE</p><h3>Individual results</h3></div><p>Prestige = payout − 100. Draws award zero Prestige.<br>Eliminated allies retain their frozen earned share.</p></div>
      <div class="aar-table-scroll"><table id="aar-player-scores"><caption class="sr-only">All players’ final match results</caption><thead><tr><th>Country / player</th><th>Final allegiance</th><th>Land</th>${r.rules.economyShare === undefined ? '' : '<th>Industry</th>'}<th>Forces</th><th>Share earned</th><th>Payout</th><th>Prestige</th></tr></thead><tbody>${players.map(p => `<tr data-result-country="${p.country}"><td><span class="aar-country">${insignia(p.country)}<b>${esc(this.country(p.country).name)}</b></span><small>${esc(this.playerName(p.country))} · ${esc(p.kind)}${p.eliminatedAt !== null ? ' · eliminated' : ''}</small></td><td>${esc(this.side(p.side))}</td><td>${p.land}</td>${r.rules.economyShare === undefined ? '' : `<td>${p.economy}</td>`}<td>${p.troops}</td><td>${number(p.maturity * 100)}%</td><td>${number(p.payout)}</td><td class="aar-prestige">${signed(p.prestige)}</td></tr>`).join('')}</tbody></table></div>
      <p class="aar-footnote">${esc(r.privacy)} Forces include troops still in transit at the finish. No bonus points for kills or construction.</p>`;
  }
  chartSection(kind, title, choices) {
    return `<div class="aar-section-heading"><div><p class="eyebrow">CAMPAIGN DEVELOPMENT</p><h3 id="${kind}-chart-title">${title}</h3></div><label>Metric<select id="${kind}-metric">${choices.map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label><label>Compare<select id="${kind}-country"><option value="all">All players</option>${this.report.players.map(p => `<option value="${p.country}">${esc(this.country(p.country).name)}</option>`).join('')}</select></label></div><div id="${kind}-chart" class="aar-chart"></div><p class="aar-footnote">Lines sampled every 10 game seconds and at the finish. Peak statistics use every tick.</p>`;
  }
  chart(kind) {
    const key = this.el(`${kind}-metric`).value, focus = this.el(`${kind}-country`).value;
    const players = this.report.players.filter(p => focus === 'all' || p.country === focus);
    const samples = this.report.series, width = 1100, height = 220, left = 60, top = 16, bottom = 35;
    const maximum = Math.max(1, ...samples.flatMap(s => s.countries.filter(p => players.some(v => v.country === p.country)).map(p => p[key])));
    const x = t => left + t / Math.max(1, this.report.duration) * (width - left - 12);
    const y = value => height - bottom - value / maximum * (height - top - bottom);
    const grid = [0, .25, .5, .75, 1].map(f => `<path d="M${left},${y(f * maximum)}H${width}"/><text x="${left - 10}" y="${y(f * maximum) + 4}" text-anchor="end">${number(f * maximum)}</text>`).join('');
    const lines = players.map(p => `<polyline fill="none" stroke="${this.country(p.country).color}" stroke-width="2.5" points="${samples.map(s => `${x(s.tick)},${y(s.countries.find(v => v.country === p.country)[key])}`).join(' ')}"><title>${esc(this.country(p.country).name)}</title></polyline>`).join('');
    this.el(`${kind}-chart`).innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(key)} over game time. Exact final and peak values are in the table below."><g class="chart-grid">${grid}<text x="${left}" y="${height - 8}">00:00</text><text x="${width - 12}" y="${height - 8}" text-anchor="end">${clock(this.report.duration)}</text></g>${lines}</svg><div class="aar-legend">${players.map(p => `<span><i style="--country:${this.country(p.country).color}"></i>${esc(this.country(p.country).name)}</span>`).join('')}</div>`;
  }
  metricsTable(columns) {
    return `<div class="aar-table-scroll"><table><thead><tr><th>Country</th>${columns.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${this.report.metrics.map(p => `<tr><th>${esc(this.country(p.country).name)}</th>${columns.map(([key]) => `<td>${number(p[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  military() {
    this.el('aar-military').innerHTML = this.chartSection('military', 'The balance of force', [['land', 'Territory'], ['troops', 'Forces in play']]) +
      this.metricsTable([['captures', 'Captures'], ['provincesLost', 'Territory losses'], ['battles', 'Battles fought'], ['peakLand', 'Peak territory'], ['peakTroops', 'Peak forces']]) +
      `<div class="aar-section-heading"><h3>Battle ledger</h3><p>${number(this.report.totals.casualties)} total casualties, including rounds still active at the deadline. Shared battles are not attributed as individual kills.</p></div><div class="aar-table-scroll aar-ledger"><table><thead><tr><th>Time</th><th>Province</th><th>Garrison</th><th>Arriving armies</th><th>Result</th><th></th></tr></thead><tbody>${[...this.report.battles].reverse().map(b => `<tr><td>${clock(b.tick)}</td><th>${esc(this.place(b.province))}</th><td>${esc(this.country(b.previousOwner)?.name || 'Neutral')} · ${b.before}</td><td>${b.arrivals.map(a => `${esc(this.country(a.country).name)} ${a.amount}`).join(' + ')}</td><td>${esc(this.country(b.owner)?.name || 'Neutral')} · ${b.troops} survive${b.duration?` · ${b.duration}s battle`:''}${b.industryLost?' · industry damaged':''}</td><td><button data-aar-seek="${b.tick}" data-aar-province="${b.province}" aria-label="Watch ${esc(this.place(b.province))} at ${clock(b.tick)}">Watch</button></td></tr>`).join('')}</tbody></table></div>`;
    this.chart('military');
  }
  economy() {
    const t = this.report.totals;
    this.el('aar-economy').innerHTML = this.chartSection('economy', 'Manpower and industry', [['recruited', 'Total recruited'], ['production', 'Recruitment per minute'], ['invested', 'Manpower invested']]) +
      this.metricsTable([['recruited', 'Recruited'], ['invested', 'Invested'], ['upgrades', 'Upgrades completed']]) +
      `<section class="aar-accounting"><p class="eyebrow">MANPOWER ACCOUNTING</p><h3>Every troop accounted for</h3><p><b>${number(t.initialTroops)}</b> initial + <b>${number(t.recruited)}</b> recruited − <b>${number(t.invested)}</b> invested − <b>${number(t.casualties)}</b> casualties${t.interned?` − <b>${number(t.interned)}</b> interned`:''} = <b>${number(t.remainingTroops)}</b> remaining.</p><small>Includes neutral defenders and troops in transit. Captures and allied gifts transfer troops; they do not create or destroy them. Investment is a cost, not a score.</small></section>`;
    this.chart('economy');
  }
  diplomacy() {
    const history = this.report.events.filter(e => ['alliance_activated', 'departed', 'coalition_dissolved', 'war_declared', 'peace_accepted', 'dominance', 'dominance_broken', 'eliminated', 'finished'].includes(e.type));
    this.el('aar-diplomacy').innerHTML = `<div class="aar-section-heading"><div><p class="eyebrow">LOYALTIES THROUGH THE CAMPAIGN</p><h3>Alliance history</h3></div><p>Only activated membership counts.<br>Private offers and diplomatic messages are not disclosed.</p></div><div class="aar-tenures">${this.report.players.map(p => `<div class="aar-tenure-row"><b>${esc(this.country(p.country).name)}</b><div class="aar-tenure-track">${this.report.tenures.filter(t => t.country === p.country && t.end > t.start).map(t => `<button style="left:${100 * t.start / this.report.duration}%;width:${100 * (t.end - t.start) / this.report.duration}%" class="${t.side.startsWith('solo:') ? 'independent' : ''}" data-aar-seek="${t.start}" title="${esc(this.side(t.side))} · ${clock(t.start)}–${clock(t.end)}" aria-label="${esc(this.side(t.side))}, ${esc(this.country(p.country).name)}, ${clock(t.start)} to ${clock(t.end)}">${esc(this.side(t.side))}</button>`).join('')}</div></div>`).join('')}</div><div class="aar-section-heading"><h3>Turning points</h3><p>Open a moment to inspect the map at that exact tick.</p></div><div class="aar-timeline">${history.map(e => this.eventButton(e)).join('')}</div>`;
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
      case 'eliminated': return `${c(e.country)} is eliminated.`;
      case 'finished': return 'The campaign ends. Final scores are fixed.';
      default: return e.type;
    }
  }
  eventButton(e) {
    return `<button class="aar-event" data-aar-seek="${e.tick}" ${e.province ? `data-aar-province="${e.province}"` : ''}><time>${clock(e.tick)}</time><span>${esc(this.describe(e))}</span></button>`;
  }
  replayLayout() {
    this.el('aar-replay').innerHTML = `<div id="replay-theatre" class="aar-theatre"><div class="aar-replay-toolbar"><div><p class="eyebrow">CAMPAIGN REPLAY</p><p>Read-only history · game time · private diplomacy excluded</p></div><div><button data-aar-map="world">World</button><button data-aar-map="europe">Europe</button><button data-aar-map="out" aria-label="Zoom replay out">−</button><button data-aar-map="in" aria-label="Zoom replay in">+</button></div></div><p id="replay-loading" role="status">Select this tab to load the recorded map.</p><div id="replay-stage" class="aar-replay-stage" hidden><div class="aar-replay-map"><div class="aar-map-frame"><button id="replay-expand" class="expand-button map-expand-corner" type="button" aria-pressed="false">⤢ Expand</button><svg id="review-map" class="replay-map" viewBox="0 0 1280 680" role="group" aria-label="Read-only historical map; select a province to inspect it"></svg></div><div class="aar-legend">${this.report.players.map(p=>`<span><i style="--country:${this.country(p.country).color}"></i>${esc(this.country(p.country).name)} · ${esc(this.playerName(p.country))}</span>`).join('')}</div></div><aside><p class="eyebrow">AT THIS MOMENT</p><div id="replay-sides"></div><div id="replay-inspector"><p>Select a province to inspect its garrison, industry and incoming armies.</p></div></aside></div><div class="aar-replay-controls"><div class="aar-transport"><button data-aar-transport="start" aria-label="Go to opening">|←</button><button data-aar-transport="back" aria-label="Back ten game seconds">−10s</button><button class="primary" id="replay-play" data-aar-transport="play" disabled>Play</button><button data-aar-transport="forward" aria-label="Forward ten game seconds">+10s</button><button data-aar-transport="end" aria-label="Go to final tick">→|</button><label>Speed<select id="replay-speed"><option value="1">1×</option><option value="4">4×</option><option value="16" selected>16×</option><option value="64">64×</option></select></label><output id="replay-clock" aria-live="off">00:00 / ${clock(this.report.duration)}</output></div><label class="sr-only" for="replay-slider">Replay game time</label><input id="replay-slider" type="range" min="0" max="${this.report.duration}" value="0" step="1" disabled aria-valuetext="00:00"><div class="aar-replay-jumps"><button data-aar-event="previous">← Previous event</button><p id="replay-event-label">The opening position</p><button data-aar-event="next">Next event →</button></div></div></div><details class="aar-event-browser"><summary>Browse the public timeline</summary><div class="aar-timeline">${this.report.events.map(e => this.eventButton(e)).join('')}</div></details>`;
  }
  async ensureReplay() {
    if (this.reader || !this.report.historyAvailable) return;
    if (this.replayPromise) return this.replayPromise;
    this.el('replay-loading').textContent = 'Loading exact recorded history…';
    this.replayPromise = (async () => {
      try {
        const replay = await this.get(`/api/games/${this.id}/replay`);
        if (this.controller.signal.aborted) return;
        this.reader = replayReader(replay); this.map = replay.map;
        this.el('replay-stage').hidden = false; this.el('replay-loading').hidden = true;
        this.atlas = new Atlas(this.el('review-map'), this.map, id => { this.inspected = id; this.paint(); });
        // Expand: map, "at this moment" and playback controls fill the screen (works without the Fullscreen API).
        this.expander = new ExpandableMap(this.el('replay-theatre'), this.el('replay-expand'), { label: 'replay map',
          onChange: () => requestAnimationFrame(() => { this.atlas?.layout(); this.atlas?.positions(); }) });
        this.el('replay-play').disabled = false; this.el('replay-slider').disabled = false; this.seek(this.position);
      } catch (error) {
        if (!this.controller.signal.aborted) this.el('replay-loading').innerHTML = `${esc(error.message)} <button data-aar-load>Retry replay</button>`;
      } finally { this.replayPromise = null; }
    })();
    return this.replayPromise;
  }
  async showTab(id) {
    if (!tabs.some(([key]) => key === id)) return;
    this.pause(); this.tab = id;
    for (const [key] of tabs) {
      const active = key === id, button = this.el(`aar-tab-${key}`);
      this.el(`aar-${key}`).hidden = !active; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    }
    if (id === 'replay') { await this.ensureReplay(); this.atlas?.layout(); this.atlas?.positions(); }
  }
  seek(at) {
    this.position = Math.max(0, Math.min(this.report.duration, at));
    if (this.reader) this.paint();
  }
  paint() {
    const tick = Math.floor(this.position);
    if (tick === this.paintedTick && this.inspected === this.paintedProvince) {
      this.atlas.state = { ...this.atlas.state, tick: this.position }; this.atlas.positions(); return;
    }
    this.paintedTick = tick; this.paintedProvince = this.inspected;
    const board = this.reader(tick);
    this.atlas.update(board, null, this.inspected || null);
    // Interpolate marching position only, never ownership, troops or membership.
    this.atlas.state = { ...board, tick: this.position }; this.atlas.positions();
    this.el('replay-slider').value = tick; this.el('replay-slider').setAttribute('aria-valuetext', `${clock(tick)} of ${clock(this.report.duration)}`);
    this.el('replay-clock').textContent = `${clock(tick)} / ${clock(this.report.duration)}`;
    this.el('replay-stage').dataset.tick = tick;
    const leader = [...board.sides].sort((a, b) => this.report.rules.economyShare === undefined ? b.provinces - a.provinces : b.economy - a.economy);
    setHTML(this.el('replay-sides'), leader.map(s => `<div class="aar-replay-side"><b>${esc(this.side(s.id))}</b><span>${this.report.rules.economyShare === undefined ? `${s.provinces}/${this.report.rules.threshold} provinces` : `${s.economy}/${board.economyThreshold} industry`}</span><div class="aar-replay-members">${s.members.map(id => `<span>${esc(this.country(id).name)} · <b>${esc(this.playerName(id))}</b></span>`).join('')}</div>${board.dominance[s.id] !== undefined ? `<small>Victory in ${Math.max(0, this.report.rules.hold - (tick - board.dominance[s.id]))}s</small>` : ''}</div>`).join(''));
    const last = this.report.events.filter(e => e.tick <= tick).at(-1);
    this.el('replay-event-label').textContent = last ? `${clock(last.tick)} · ${this.describe(last)}` : 'The opening position';
    const p = board.provinces.find(p => p.id === this.inspected);
    if (p) {
      const incoming = board.armies.filter(a => a.to === p.id).sort((a, b) => a.arrivesAt - b.arrivesAt);
      const lastBattle = this.report.battles.filter(b => b.province === p.id && b.tick <= tick).at(-1);
      setHTML(this.el('replay-inspector'), `<h3>${esc(this.place(p.id))}</h3><p>${esc(this.country(p.owner)?.name || 'Neutral')}${p.owner ? ` · ${esc(this.playerName(p.owner))}` : ''} · <b>${p.troops}</b> troops · industry ${p.development}</p>${p.route ? `<p>Local recruits → ${esc(this.place(p.route))}</p>` : ''}${lastBattle ? `<small>Last battle ${clock(lastBattle.tick)}: ${lastBattle.troops} survivors.</small>` : ''}<h4>Incoming waves</h4>${incoming.length ? incoming.map(a => `<p class="small">${a.amount} ${esc(this.country(a.country).name)} · ${a.returning ? 'returning' : 'marching'} · ${clock(a.arrivesAt)}${a.arrivesAt > this.report.duration ? ' (after match end)' : ''}</p>`).join('') : '<p class="small muted">None committed at this tick.</p>'}`);
    }
  }
  pause() {
    this.playing = false; cancelAnimationFrame(this.animation); this.animation = null;
    const button = this.el('replay-play'); if (button) { button.textContent = 'Play'; button.setAttribute('aria-label', 'Play replay'); }
  }
  play() {
    if (!this.reader) return;
    if (this.playing) { this.pause(); return; }
    if (this.position >= this.report.duration) this.seek(0);
    this.playing = true; this.el('replay-play').textContent = 'Pause'; this.el('replay-play').setAttribute('aria-label', 'Pause replay');
    let last = performance.now();
    const frame = now => {
      if (!this.playing) return;
      const delta = Math.min(.25, (now - last) / 1000); last = now;
      this.seek(this.position + delta * this.speed);
      if (this.position >= this.report.duration) { this.pause(); return; }
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }
  async click(event) {
    const button = event.target.closest('button'); if (!button || !this.root.contains(button)) return;
    if (button.hasAttribute('data-aar-retry')) { this.load(this.fallback); return; }
    if (button.hasAttribute('data-aar-load')) { await this.ensureReplay(); return; }
    if (button.dataset.aarTab) await this.showTab(button.dataset.aarTab);
    if (button.hasAttribute('data-aar-seek')) {
      await this.showTab('replay'); this.seek(Number(button.dataset.aarSeek));
      if (button.dataset.aarProvince && this.atlas) { this.inspected = button.dataset.aarProvince; this.atlas.focus(this.inspected); this.paint(); }
    }
    if (button.dataset.aarTransport && this.reader) {
      const action = button.dataset.aarTransport;
      if (action === 'play') this.play();
      else { this.pause(); this.seek(action === 'start' ? 0 : action === 'end' ? this.report.duration : this.position + (action === 'back' ? -10 : 10)); }
    }
    if (button.dataset.aarEvent && this.reader) {
      this.pause(); const ticks = [...new Set(this.report.events.map(e => e.tick))];
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
  change(event) {
    if (event.target.id === 'replay-speed') this.speed = Number(event.target.value);
    for (const kind of ['military', 'economy']) if ([`${kind}-metric`, `${kind}-country`].includes(event.target.id)) this.chart(kind);
  }
  keydown(event) {
    if (event.target.closest('.aar-tabs') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const i = tabs.findIndex(([id]) => id === this.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      this.showTab(tabs[next][0]); this.el(`aar-tab-${tabs[next][0]}`).focus();
    }
  }
  destroy() { this.pause(); this.controller.abort(); this.expander?.destroy(); this.atlas?.destroy(); }
}
