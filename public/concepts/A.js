/** Concept A — "War Room / Imperial HUD". Prototype over the real atlas and recorded public data.
 * One anchored-region shell (CSS grid) per screen; every panel is a [data-region]. Player text (chat,
 * alliance names) goes through esc() only. Icons are original inline SVG line drawings.
 */
import { load, mountAtlas, screen, reviewerNav, clock, esc, insignia, faction, replayState, historyTo } from '/concepts/kit/concept.js';

const m = await load();
const S = screen(), phone = innerWidth < 700, you = m.you;
const shell = document.getElementById('shell'), svg = document.getElementById('map');
document.body.dataset.screen = S; document.body.classList.toggle('phone', phone);

/* ── Icons: engraved line drawings, 24-unit grid, stroke 1.6 ── */
const P = {
  troops: 'M5 15a7 7 0 0 1 14 0v1H5zM3 16h18M12 8V4m-2 0h4M8 19l-1 2m9-2 1 2',
  land: 'M6 21V4m0 0h11l-2.5 3.5L17 11H6M3 21h18',
  industry: 'M3 21h18M4 21v-9l5 3v-3l5 3V5h4v16M15 3h2',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zm4 4a2 2 0 0 0 4 0',
  seal: 'M12 2.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 6l1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3zM8 15.5 6 21.5l3-1.2 1.6 2.4 1.4-5.2m4-2 2 6-3-1.2-1.6 2.4-1.4-5.2',
  war: 'M5 4l12 12M19 4 7 16m7 2 4-4m-8 4-4-4m10 2 3 3M8 16l-3 3',
  ally: 'M9 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6 0a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  gear: 'M18.6 9.5 21.4 10.1 21.4 13.9 18.6 14.5 18.4 14.9 20.0 17.3 17.3 20.0 14.9 18.4 14.5 18.6 13.9 21.4 10.1 21.4 9.5 18.6 9.1 18.4 6.7 20.0 4.0 17.3 5.6 14.9 5.4 14.5 2.6 13.9 2.6 10.1 5.4 9.5 5.6 9.1 4.0 6.7 6.7 4.0 9.1 5.6 9.5 5.4 10.1 2.6 13.9 2.6 14.5 5.4 14.9 5.6 17.3 4.0 20.0 6.7 18.4 9.1zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3.5 9h17M3.5 15h17',
  home: 'M4 11l8-7 8 7M6 10v10h12V10m-8 10v-5h4v5',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  dispatch: 'M3 6h18v12H3zm0 0 9 7 9-7',
  powers: 'M4 20h16M6 20v-6h4v6m0 0V9h4v11m0 0v-8h4v8',
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zm-4 6a7 7 0 0 0 14 0m-7 7v3m-3 0h6',
  send: 'M4 12 20 4l-5 16-3-6zm8 2 8-10',
  play: 'M8 5v14l11-7z', pause: 'M8 5v14m8-14v14',
  back: 'M11 7l-5 5 5 5m7-10-5 5 5 5', fwd: 'M13 7l5 5-5 5M6 7l5 5-5 5',
  first: 'M6 5v14m12-14-9 7 9 7z', last: 'M18 5v14M6 5l9 7-9 7z',
  close: 'M6 6l12 12M18 6 6 18', down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6', right: 'M9 6l6 6-6 6',
  laurel: 'M12 21v-9m0 0C8 12 6 9 6 5c3 0 6 2 6 7zm0 0c4 0 6-3 6-7-3 0-6 2-6 7zM8 21h8',
  speaker: 'M4 9h4l5-4v14l-5-4H4zm12 0a4 4 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11',
  door: 'M14 4H5v16h9m-4-8h11m-4-4 4 4-4 4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  march: 'M3 12h14m-4-5 5 5-5 5', develop: 'M12 20V8m-4 4 4-4 4 4M5 20h14',
  key: 'M8 10a4 4 0 1 0 0 .1zM12 10h9m-3 0v3m-3-3v2',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-2.5 6.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7m0 3v.01',
  battle: 'M12 3l1.8 5 5-2.2-2.2 5 5 1.8-5 1.8 2.2 5-5-2.2-1.8 5-1.8-5-5 2.2 2.2-5-5-1.8 5-1.8-2.2-5 5 2.2z',
  crown: 'M4 18h16M5 18 4 8l5 4 3-6 3 6 5-4-1 10',
  book: 'M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zm16 0c-3-1-6-1-8 1v14c2-2 5-2 8-1z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name]}"/></svg>`;
const EMBLEM = (() => { // Original: a toothed iron ring around a compass star (no borrowed heraldry).
  const teeth = Array.from({ length: 24 }, (_, i) => `<rect x="-3" y="-47" width="6" height="8" transform="rotate(${i * 15})"/>`).join('');
  return `<svg class="emblem" viewBox="-50 -50 100 100" aria-hidden="true"><g class="em-teeth">${teeth}</g><circle r="40" class="em-ring"/><circle r="33" class="em-inner"/><path class="em-star" d="M0-30 6-6 30 0 6 6 0 30-6 6-30 0-6-6z"/><path class="em-star2" d="M0-30 6-6 0 0zM30 0 6 6 0 0zM0 30-6 6 0 0zM-30 0-6-6 0 0z"/><circle r="4" class="em-hub"/></svg>`;
})();

/* ── Shared vocabulary ── */
const short = id => faction(id).short, full = id => m.names.country(id), prov = id => m.names.province(id);
const pct = n => `${(n * 100).toFixed(1)}%`;
const btn = (label, { kind = 'secondary', icon, sfx = 'press', attrs = '', cls = '' } = {}) =>
  `<button type="button" class="btn btn-${kind} ${cls}" data-sfx="${sfx}" ${attrs}>${icon ? ic(icon) : ''}<span>${label}</span></button>`;
const bezel = (icon, label, { attrs = '', cls = '', badge = '' } = {}) =>
  `<button type="button" class="bezel-btn ${cls}" data-sfx="press" aria-label="${label}" title="${label}" ${attrs}>${ic(icon)}${badge ? `<b class="badge">${badge}</b>` : ''}</button>`;
const plaque = (title, extra = '') => `<header class="plaque"><h2>${title}</h2>${extra}</header>`;
const tabs = (items, active) => `<div class="tabs" role="tablist">${items.map(([id, label, n]) => `<button type="button" role="tab" data-sfx="press" aria-selected="${id === active}">${label}${n ? `<b class="count">${n}</b>` : ''}</button>`).join('')}</div>`;
const stat = (icon, value, label, extra = '') => `<div class="stat" title="${label}">${ic(icon)}<span><b>${value}</b><small>${label}</small></span>${extra}</div>`;
const relIcon = rel => rel === 'enemy' ? `<i class="rel rel-enemy" title="At war with you">${ic('war')}</i>` : rel === 'ally' ? `<i class="rel rel-ally" title="Allied with you">${ic('ally')}</i>` : rel === 'you' ? '<i class="rel rel-you">You</i>' : '<i class="rel"></i>';
const slider = (value, max, label) => `<div class="slider" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="1" aria-valuemax="${max}" aria-valuenow="${value}" style="--v:${(value - 1) / Math.max(1, max - 1)}"><i class="track"></i><i class="fill"></i><i class="notches"></i><b class="knob"></b></div>`;
const toggle = (on, label) => `<button type="button" class="toggle" role="switch" aria-checked="${on}" data-sfx="press"><i></i><span>${label}</span></button>`;

/* ── Live data ── */
const L = m.live, st = m.stats, rel = m.relations;
const lead = [...L.sides].sort((a, b) => b.economy - a.economy);
const leaderName = s => s.members.length > 1 ? s.name : full(s.members[0]);
const victoryLine = L.dominance && Object.keys(L.dominance).length ? 'Victory countdown running' : `Win at ${st.threshold} industry · leader ${leaderName(lead[0])} ${lead[0].economy}`;
const board = m.powers();

function topbar() {
  const status = rel.allies?.length ? `Allied · ${rel.allies.map(short).join(', ')}` : `Independent · at war with ${rel.enemies.length}`;
  const gauge = `<div class="gauge" title="Your industry toward the ${st.threshold} needed to win"><i style="width:${Math.min(100, st.industry / st.threshold * 100)}%"></i></div>`;
  if (phone) return `<header class="topbar" data-region="topbar" data-inset="top">
    <button type="button" class="nation" data-sfx="press" aria-label="Your country: ${esc(full(you))}">${insignia(you)}<span><b>${esc(short(you))}</b><small>${rel.enemies.length} wars</small></span></button>
    <div class="clock-plaque"><b>${clock(st.tick)}</b><small>of ${clock(st.duration)}</small></div>
    <div class="stats">${stat('troops', st.troops, 'troops')}${stat('land', st.land, 'provinces')}</div>
    ${bezel('gear', 'Menu', { cls: S === 'menu' ? 'on' : '' })}</header>`;
  return `<header class="topbar" data-region="topbar" data-inset="top">
    <button type="button" class="nation" data-sfx="press" title="Your country and alliance">${insignia(you)}<span><b>${esc(full(you))}</b><small>${esc(status)}</small></span></button>
    <div class="stats">${stat('troops', st.troops, 'troops')}${stat('land', `${st.land}<em>/${st.provinces}</em>`, 'provinces')}${stat('industry', `${st.industry}<em>/${st.threshold}</em>`, 'industry to win', gauge)}</div>
    <div class="clock-plaque"><span class="clock-face">${ic('clock')}<b>${clock(st.tick)}</b><small>/ ${clock(st.duration)}</small></span><small class="victory">${esc(victoryLine)}</small></div>
    <div class="alert-row" role="group" aria-label="Needs your attention">
      ${bezel('seal', 'Alliance offer from France', { cls: `alert-offer ${S === 'offer' ? 'on' : ''}`, badge: '1' })}
      ${bezel('battle', '2 battles in progress', { cls: 'alert-battle', badge: '2' })}
      ${bezel('dispatch', 'Unread dispatch from France', { cls: 'alert-mail', badge: '1' })}
    </div>
    ${bezel('gear', 'Menu (Esc)', { cls: `menu-btn ${S === 'menu' ? 'on' : ''}` })}</header>`;
}

/* Powers: teams leaderboard (nested totals) + war fronts. */
function powersList(b, { detailed = false, viewer = you } = {}) {
  const rows = b.rows.map(r => {
    const color = b.colors[r.id];
    if (r.kind === 'alliance') {
      const head = `<li class="pw pw-group${r.relation ? ` is-${r.relation}` : ''}${r.forming ? ' forming' : ''}" style="--c:${color || '#a5a28c'}"><span class="rk">${r.rank}</span><i class="sw"></i><b class="nm">${esc(r.name)}</b>${relIcon(r.relation)}<span class="sh">${pct(r.share)}</span><span class="tp">${r.troops}</span></li>`;
      const members = r.members.map(x => `<li class="pw pw-member${x.id === viewer ? ' is-you' : ''}${x.relation ? ` is-${x.relation}` : ''}" style="--c:${color}"><span class="rk"></span>${insignia(x.id)}<span class="nm">${esc(short(x.id))}</span><span class="bar" title="${Math.round(x.shareOfAlliance * 100)}% of the alliance's troops"><i style="width:${x.shareOfAlliance * 100}%"></i></span>${detailed ? `<span class="sh">${pct(x.share)}</span>` : '<span class="sh"></span>'}<span class="tp">${x.troops}</span></li>`).join('');
      return head + members;
    }
    return `<li class="pw pw-country${r.relation ? ` is-${r.relation}` : ''}"><span class="rk">${r.rank}</span>${insignia(r.id)}<b class="nm">${esc(detailed ? full(r.id) : short(r.id))}</b>${relIcon(r.relation)}<span class="sh">${pct(r.share)}</span><span class="tp">${r.troops}</span></li>`;
  }).join('');
  const label = s => s.name ? esc(s.name) : esc(s.countries.map(short).join(' + '));
  const fronts = b.fronts.map(f => `<li class="front${f.sides.some(s => s.countries.includes(viewer)) ? ' mine' : ''}"><span>${label(f.sides[0])}</span>${ic('war')}<span>${label(f.sides[1])}</span><small>${f.pairs.length}</small></li>`).join('');
  return `<div class="pw-cols" aria-hidden="true"><span>#</span><span>Power</span><span>Land</span><span>Troops</span></div><ol class="pw-list">${rows}</ol>
    <h3 class="sub">${ic('war')}War fronts<small>${b.fronts.length}</small></h3><ul class="fronts">${fronts || '<li class="empty">No wars.</li>'}</ul>`;
}

/* Dispatches: history + chat rows. */
const toneIcon = { war: 'war', alliance: 'ally', peace: 'seal', broken: 'close', industry: 'industry', victory: 'laurel', neutral: 'dispatch' };
function dispatchRow(r) {
  const t = `<time>${clock(r.tick)}</time>`;
  if (r.kind === 'chat') return `<li class="dp dp-chat${r.from === you ? ' mine' : ''}"><header>${insignia(r.from)}<b>${esc(short(r.from))}</b><span class="ch">${r.channel === 'dm' ? 'Private' : r.channel === 'alliance' ? 'Alliance' : 'World'}</span>${t}</header><p>${esc(r.text)}</p></li>`;
  if (r.kind === 'system' && r.system === 'offer') return `<li class="dp dp-offer">${ic('seal', 'wax')}<div><header><b>${esc(r.title)}</b>${t}</header><p>${esc(r.detail.replace(/Maximum share ([\d.]+) points each/, (_, n) => `Up to ${+(+n).toFixed(1)} Prestige each`))}</p><div class="row">${btn('Accept', { kind: 'primary', sfx: 'seal', icon: 'seal' })}${btn('Decline')}</div></div></li>`;
  return `<li class="dp dp-news tone-${r.tone}">${ic(toneIcon[r.tone] || 'dispatch')}<div><header><b>${esc(r.title)}</b>${t}</header><p>${esc(r.detail || '')}</p></div></li>`;
}
function composer(placeholder) {
  return `<form class="composer" onsubmit="return false"><label class="slot"><span class="sr">${placeholder}</span><input maxlength="500" placeholder="${placeholder}" autocomplete="off"></label>${bezel('mic', 'Hold to speak', { cls: 'mic' })}${btn('Send', { kind: 'primary', icon: 'send', cls: 'send' })}</form>`;
}
function outliner({ powersOpen = true, dispatchOpen = true, tab = 'world', detailed = false } = {}) {
  const dm = m.dm('france');
  const list = tab === 'dm' ? dm : m.world;
  const threadHead = tab === 'dm' ? `<div class="thread-head">${insignia('france')}<b>${esc(full('france'))}</b><small>Neutral · offered an alliance</small>${bezel('right', 'Open France', {})}</div>` : '';
  return `<aside class="outliner" data-region="outliner" data-inset="right">
    <section class="ol ol-powers ${powersOpen ? '' : 'shut'}">${plaque('Powers', `${tabs([['teams', 'Teams'], ['players', 'Players']], 'teams')}<button type="button" class="fold" data-sfx="press" aria-expanded="${powersOpen}" aria-label="Fold">${ic(powersOpen ? 'up' : 'down')}</button>`)}
      ${powersOpen ? `<div class="ol-body">${powersList(board, { detailed })}</div>` : `<p class="folded">${board.rows.length} blocs · ${board.fronts.length} war fronts</p>`}</section>
    <section class="ol ol-dispatch ${dispatchOpen ? '' : 'shut'}">${plaque('Dispatches', `${tabs([['world', 'World'], ['dm', 'Direct', dm.length], ['alliance', 'Alliance']], tab)}<button type="button" class="fold" data-sfx="press" aria-expanded="${dispatchOpen}" aria-label="Fold">${ic(dispatchOpen ? 'up' : 'down')}</button>`)}
      ${dispatchOpen ? `${threadHead}<ol class="dp-list" data-scroll-end>${list.map(dispatchRow).join('')}</ol>${composer(tab === 'dm' ? 'Write to France…' : 'Address the world…')}` : `<p class="folded">${m.world.length} dispatches · 1 unread</p>`}</section>
  </aside>`;
}

/* Context cards (left column on desktop, bottom plate on phones). One primary, in a fixed footer. */
function provinceCard() {
  const o = m.order, target = L.provinces.find(p => p.id === o.to), source = L.provinces.find(p => p.id === o.from);
  const amount = Math.round(o.free * .75), owner = target.owner;
  const verb = !owner ? `Take ${prov(o.to)} with ${amount}` : rel.enemies.includes(owner) ? `Attack ${prov(o.to)} with ${amount}` : owner === you ? `Reinforce ${prov(o.to)} with ${amount}` : `Send ${amount} → ${prov(o.to)}`;
  const marching = L.armies.filter(a => a.country === you && a.to === o.to).reduce((n, a) => n + a.amount, 0);
  return `<section class="plate card card-province" data-region="card" data-inset="${phone ? 'bottom' : 'left'}">
    ${plaque(`${ic('march')}Orders`, `<span class="plaque-note">${esc(prov(o.from))}</span>${bezel('close', 'Cancel (Esc)', { cls: 'mini' })}`)}
    <div class="card-body">
      <div class="route">
        <div class="end">${insignia(you)}<b>${esc(prov(o.from))}</b><small>${source.troops} troops · industry ${source.development}</small></div>
        <div class="arrow">${ic('march')}<small>${o.eta}s march</small></div>
        <div class="end target">${insignia(owner || 'neutral')}<b>${esc(prov(o.to))}</b><small>${owner ? esc(short(owner)) : 'Unclaimed'} · ${target.troops} defenders</small></div>
      </div>
      <p class="note">${marching ? `${marching} of your troops are already marching here, arriving ${clock(L.armies.find(a => a.country === you && a.to === o.to).arrivesAt)}. ` : ''}No war needed: the province is unclaimed.</p>
      <div class="amount"><div class="amount-line"><span>Troops to send</span><output>${amount}<small> of ${o.free} free</small></output></div>
        ${slider(amount, o.free, 'Troops to send')}
        <div class="presets" role="group" aria-label="Share of free troops">${[25, 50, 75, 100].map(p => `<button type="button" class="chip" data-sfx="press" aria-pressed="${p === 75}">${p}%</button>`).join('')}</div></div>
    </div>
    <footer class="card-foot">${btn(esc(verb), { kind: 'primary', icon: 'march', sfx: 'confirm', cls: 'wide', attrs: 'id="primary"' })}<small class="foot-note">Enter sends · arrives ${clock(L.tick + (o.eta || 0) + 1)}</small></footer>
  </section>`;
}
function countryCard(id = 'germany') {
  const row = board.rows.flatMap(r => r.kind === 'alliance' ? r.members.map(x => ({ ...x, bloc: r })) : [r]).find(r => r.id === id);
  const side = L.players.find(p => p.id === id).side, bloc = L.sides.find(s => s.id === side);
  const partners = bloc.members.filter(x => x !== id), enemies = [...new Set(L.wars.filter(w => w.split(':').includes(id)).map(w => w.split(':').find(x => x !== id)))];
  const roster = bloc.members.length + 1, share = +(100 * L.players.length / roster).toFixed(1);
  return `<section class="plate card card-country" data-region="card" data-inset="${phone ? 'bottom' : 'left'}">
    ${plaque(`${ic('land')}Country`, bezel('close', 'Close (Esc)', { cls: 'mini' }))}
    <div class="card-body">
      <div class="dossier-head">${insignia(id)}<div><h3>${esc(full(id))}</h3><p>${partners.length ? `${esc(bloc.name)} · with ${partners.map(x => esc(short(x))).join(', ')}` : 'Independent'}</p></div></div>
      <div class="relation-banner neutral"><b>Neutral</b><span>Not at war with you · no alliance</span></div>
      <div class="facts">
        ${stat('troops', row.troops, 'troops')}${stat('land', L.provinces.filter(p => p.owner === id).length, 'provinces')}${stat('industry', bloc.economy, `${partners.length ? 'bloc ' : ''}industry`)}
      </div>
      <p class="note">${ic('war')} At war with ${enemies.map(x => esc(short(x))).join(', ')}.</p>
      <p class="terms">Propose an alliance: you would join <b>${esc(bloc.name)}</b> (${roster} members, up to ${share} Prestige each). Declaring war on ${esc(short(id))} also puts you at war with ${partners.map(x => esc(full(x))).join(', ')}.</p>
    </div>
    <footer class="card-foot two">${btn('Declare war', { kind: 'danger', icon: 'war', sfx: 'war' })}${btn('Propose alliance', { kind: 'primary', icon: 'ally', sfx: 'confirm', attrs: 'id="primary"' })}</footer>
  </section>`;
}
function allianceCard() {
  return `<section class="plate card card-alliance" data-region="card" data-inset="left">
    ${plaque(`${ic('ally')}Your alliance`)}
    <div class="card-body">
      <div class="dossier-head">${insignia(you)}<div><h3>${esc(full(you))}</h3><p>Independent</p></div></div>
      <div class="empty-state">${ic('ally', 'big')}<p><b>You are not in an alliance.</b> Alliance chat opens when one forms. Select any country to propose one, or answer France's offer.</p></div>
    </div>
    <footer class="card-foot">${btn('Review the offer from France', { kind: 'primary', icon: 'seal', sfx: 'seal', cls: 'wide', attrs: 'id="primary"' })}</footer></section>`;
}

/* The event letter (HoI-style): the notification lane holds at most one open letter. */
function letter() {
  const q = m.offer, lastDm = m.dm('france').filter(r => r.kind === 'chat' && r.from === 'france').at(-1);
  const share = +(100 * L.players.length / q.roster.length).toFixed(1);
  return `<article class="letter" data-region="letter" role="dialog" aria-labelledby="letter-title">
    <div class="letter-seal">${ic('seal')}</div>
    <header><small>Alliance offer · ${clock(L.tick)}</small><h2 id="letter-title">${esc(q.name)}</h2><p>From ${esc(full(q.creator))}</p></header>
    <div class="letter-body">
      <p>${esc(full(q.creator))} invites the ${esc(full(you))} into the <b>${esc(q.name)}</b>: ${q.roster.map(x => esc(short(x))).join(' + ')}.</p>
      <ul class="terms-list"><li>${ic('laurel')}Up to <b>${share}</b> Prestige each if the alliance wins</li><li>${ic('clock')}Active ${L.rules.notice}s after you accept</li><li>${ic('war')}You join France's war with the ${esc(full('germany'))} and the ${esc(full('ottoman'))}</li><li>${ic('seal')}Open until ${clock(q.expiresAt)}</li></ul>
      ${lastDm ? `<blockquote><span>${esc(short('france'))} wrote:</span> “${esc(lastDm.text)}”</blockquote>` : ''}
    </div>
    <footer>${btn('Decline', { sfx: 'press' })}${btn('Accept alliance', { kind: 'primary', icon: 'seal', sfx: 'seal', attrs: 'id="primary"' })}</footer>
  </article>`;
}

function camera() {
  return `<div class="camera" data-region="camera" role="group" aria-label="Map view">${phone ? '' : bezel('plus', 'Zoom in (Q)') + bezel('minus', 'Zoom out (E)')}${bezel('home', 'My country (C)')}${bezel('globe', 'World view')}</div>`;
}
function strip() { // phones: every other power, one tap into diplomacy, plus the attention seal
  const others = board.rows.flatMap(r => r.kind === 'alliance' ? r.members : [r]).filter(r => r.id !== you);
  return `<nav class="strip" data-region="strip" data-inset="top" aria-label="Powers">${bezel('seal', 'Alliance offer from France', { cls: `alert-offer ${S === 'offer' ? 'on' : ''}`, badge: '1' })}<div class="standards">${others.map(r => `<button type="button" class="std${r.relation ? ` is-${r.relation}` : ''}" data-sfx="press" aria-label="${esc(full(r.id))}">${insignia(r.id)}${r.relation === 'enemy' ? `<i>${ic('war')}</i>` : ''}</button>`).join('')}</div></nav>`;
}
function dock(active = 'map') {
  return `<nav class="dock" data-region="dock" data-inset="bottom" aria-label="Game">${[['map', 'globe', 'Map'], ['powers', 'powers', 'Powers'], ['chat', 'dispatch', 'Dispatches', 1], ['menu', 'gear', 'Menu']].map(([id, icon, label, n]) => `<button type="button" class="dock-btn" data-sfx="press" aria-pressed="${id === active}">${ic(icon)}<span>${label}</span>${n ? `<b class="badge">${n}</b>` : ''}</button>`).join('')}</nav>`;
}

/* Menu plate: replaces the outliner on desktop (stable place: the gear sits above it). */
function menu() {
  const keys = Object.entries(m.colors).map(([id, c]) => `<li><i style="--c:${c}"></i>${esc(m.names.side(id))}</li>`).join('');
  return `<aside class="plate menu" data-region="menu" data-inset="${phone ? 'bottom' : 'right'}">${plaque(`${ic('gear')}Menu`, `<span class="plaque-note">The match keeps running</span>${bezel('close', 'Close (Esc)', { cls: 'mini' })}`)}
    <div class="menu-body">
      <section><h3>Map</h3><div class="seg" role="group">${['World', 'Europe', 'My country'].map((x, i) => `<button type="button" data-sfx="press" aria-pressed="${i === 0}">${x}</button>`).join('')}</div>
        <div class="seg" role="group">${['Political', 'Diplomacy'].map((x, i) => `<button type="button" data-sfx="press" aria-pressed="${i === 0}">${x}</button>`).join('')}</div>
        <ul class="key">${keys}<li><i class="k-war"></i>War front</li><li><i class="k-forming"></i>Alliance forming</li></ul></section>
      <section><h3>Sound</h3><div class="setting">${ic('speaker')}<span>Effects</span>${slider(7, 10, 'Effects volume')}</div><div class="setting">${ic('speaker')}<span>Music</span>${slider(4, 10, 'Music volume')}</div>${toggle(true, 'Battle cues')}</section>
      <section><h3>Voice</h3>${toggle(true, 'Speak dispatches (hold the mic)')}${toggle(false, 'Read incoming letters aloud')}</section>
      <section><h3>Controls</h3><dl class="keys"><dt><kbd>Drag</kbd></dt><dd>from your province to send troops</dd><dt><kbd>Enter</kbd></dt><dd>send · <kbd>Esc</kbd> cancel</dd><dt><kbd>C</kbd></dt><dd>my country · <kbd>Q</kbd>/<kbd>E</kbd> zoom</dd><dt><kbd>M</kbd></dt><dd>diplomacy colours</dd></dl></section>
      <section class="menu-room">${btn('Copy room link', { icon: 'link' })}${btn('Change identity', { icon: 'user' })}${btn('Leave to rooms', { icon: 'door', kind: 'danger' })}</section>
    </div></aside>`;
}

/* ── Screens ── */
const shells = {
  hud() { return topbar() + (phone ? strip() + mapArea() + dock() : mapArea() + outliner()); },
  province() { return topbar() + (phone ? strip() + mapArea({ cam: false }) + provinceCard() : `<div class="left">${provinceCard()}</div>` + mapArea() + outliner()); },
  country() { return topbar() + (phone ? strip() + mapArea({ cam: false }) + countryCard() : `<div class="left">${countryCard()}</div>` + mapArea() + outliner()); },
  offer() { return topbar() + (phone ? strip() + mapArea({ lane: letter(), cam: false }) + dock() : mapArea({ lane: letter() }) + outliner()); },
  chat() { return topbar() + (phone ? strip() + `<div class="sheet-slot">${outliner({ powersOpen: false, tab: 'dm' })}</div>` + dock('chat') : `<div class="left">${allianceCard()}</div>` + mapArea() + outliner({ powersOpen: false, tab: 'dm' })); },
  menu() { return topbar() + (phone ? strip() + `<div class="sheet-slot">${menu()}</div>` + dock('menu') : mapArea() + menu()); },
  powers() { return topbar() + (phone ? strip() + `<div class="sheet-slot">${outliner({ dispatchOpen: false, detailed: true })}</div>` + dock('powers') : mapArea() + outliner({ dispatchOpen: false, detailed: true })); },
};
function mapArea({ lane = '', cam = true } = {}) {
  return `<div class="maparea">${lane ? `<div class="lane">${lane}</div>` : ''}${cam ? camera() : ''}</div>`;
}

function title() {
  const rooms = [
    { name: L.name, state: `In session · ${clock(L.tick)} of ${clock(L.rules.duration)}`, seats: `${L.players.filter(p => p.kind === 'human').length} human · ${L.players.filter(p => p.kind === 'agent').length} agents`, action: 'Watch', icon: 'eye', live: true },
    { name: m.review.name, state: `Finished · ${esc(m.review.alliances.find(a => a.id === m.review.outcome.winningSide).name)} won at ${clock(m.review.outcome.tick)}`, seats: '8 agents', action: 'Review', icon: 'book' },
    { name: 'The evening council', state: 'Lobby · 3 seats open', seats: '5 commanders waiting', action: 'Join', icon: 'door', primary: true },
  ];
  return `<section class="plate gate" data-region="title">
      <div class="gate-crest">${EMBLEM}</div>
      <h1>Council <span>of</span> Iron</h1>
      <p class="tagline">Eight powers. No permanent friends. Humans and agents at one table, 1910.</p>
      <nav class="main-menu" aria-label="Main menu">${[['Rooms', 'globe', true], ['How to play', 'book'], ['Records', 'laurel'], ['Settings', 'gear']].map(([l, i, on]) => `<button type="button" class="menu-item" data-sfx="press" aria-current="${on ? 'page' : 'false'}">${ic(i)}<span>${l}</span></button>`).join('')}</nav>
      
    </section>
    <section class="plate rooms" data-region="rooms">${plaque(`${ic('globe')}Rooms`, `<span class="plaque-note">${rooms.length} open to you</span>`)}
      <ol class="ledger">${rooms.map(r => `<li class="${r.live ? 'live' : ''}${r.sample ? ' sample' : ''}"><div><b>${esc(r.name)}</b><small>${r.state}</small><small>${esc(r.seats)}</small></div>${btn(r.action, { kind: r.primary ? 'secondary' : 'ghost', icon: r.icon })}</li>`).join('')}</ol>
    </section>
    <section class="plate create" data-region="create">${plaque(`${ic('crown')}Open a council`)}
      <div class="create-body">
        <label class="field"><span>Your name</span><span class="slot"><input value="Chris" maxlength="40"></span></label>
        <label class="field"><span>Room name</span><span class="slot"><input value="The evening council" maxlength="80"></span></label>
        <div class="field"><span>Pace</span><div class="seg" role="radiogroup"><button type="button" role="radio" aria-checked="true" data-sfx="press">Standard · 30 min</button><button type="button" role="radio" aria-checked="false" data-sfx="press">Quick · 5 min</button></div></div>
      </div>
      <footer class="card-foot">${btn('Create room', { kind: 'primary', icon: 'crown', sfx: 'confirm', cls: 'wide', attrs: 'id="primary"' })}<small class="foot-note">Invite by link, or fill empty seats with bots.</small></footer>
    </section>`;
}

function factionScreen(pick = 'britain') {
  const c = m.map.countries.find(x => x.id === pick), players = new Map(L.players.map(p => [p.id, p]));
  const seat = id => id === pick ? 'Open seat' : players.get(id)?.kind === 'agent' ? 'Agent seated' : 'Open seat';
  const names = ids => ids.map(prov).map(esc).join(', ');
  return `<header class="topbar lobby-bar" data-region="topbar" data-inset="top">
      ${bezel('back', 'All rooms')}<div class="lobby-title"><b>${esc(L.name)}</b><small>Choose your country · 7 of 8 seats taken · standard pace</small></div>
      ${phone ? '' : btn('Copy invite link', { icon: 'link', kind: 'ghost' })}${phone ? '' : btn('Fill seats with bots', { icon: 'user', kind: 'ghost' })}
    </header>
    <section class="plate dossier" data-region="dossier" data-inset="${phone ? 'bottom' : 'left'}">${plaque(`${ic('land')}Your country`)}
      <div class="card-body">
        <div class="dossier-head big">${insignia(pick)}<div><h3>${esc(c.name)}</h3><p>${c.start.length} holdings · ${c.homeland.length} homeland · ${c.colonies.length} colonies</p></div></div>
        <dl class="holdings"><dt>Homeland</dt><dd>${names(c.homeland)}</dd><dt>Colonies</dt><dd>${names(c.colonies)}</dd></dl>
        <p class="note">Industrial homeland, scattered colonies: strong early, stretched by distance. Every country plays by the same rules.</p>
      </div>
      <footer class="card-foot">${btn(`Take the seat of ${esc(faction(pick).short)}`, { kind: 'primary', icon: 'crown', sfx: 'confirm', cls: 'wide', attrs: 'id="primary"' })}</footer>
    </section>
    <nav class="plate rack" data-region="rack" data-inset="bottom" aria-label="The eight powers">
      ${m.map.countries.map(x => `<button type="button" class="banner${x.id === pick ? ' picked' : ''}" data-sfx="press" aria-pressed="${x.id === pick}">${insignia(x.id)}<b>${esc(faction(x.id).short)}</b><small>${x.start.length} holdings</small><em>${seat(x.id)}</em></button>`).join('')}
    </nav>`;
}

/* Replay: ONE team leaderboard at the scrubbed tick, history to the tick, a timeline band. */
const RT = 300;
function replayScreen() {
  const R = m.review, state = replayState(m, RT), b = m.powers(state, null), hist = historyTo(m, RT).slice().reverse();
  const winner = R.alliances.find(a => a.id === R.outcome.winningSide);
  const marks = R.events.filter(e => ['alliance_activated', 'dominance', 'dominance_broken', 'finished', 'capture'].includes(e.type))
    .map(e => `<i class="mark m-${e.type}" style="--x:${e.tick / R.duration}" title="${clock(e.tick)}"></i>`).join('');
  const next = historyTo(m, R.duration).find(e => e.tick > RT);
  const top = phone ? `<header class="topbar replay-bar" data-region="topbar" data-inset="top">${bezel('back', 'Exit replay')}<div class="lobby-title"><b>Replay</b><small>${esc(R.name)}</small></div><div class="clock-plaque"><b>${clock(RT)}</b><small>of ${clock(R.duration)}</small></div></header>`
    : `<header class="topbar replay-bar" data-region="topbar" data-inset="top">${bezel('back', 'Exit replay')}<div class="lobby-title"><b>Replay · ${esc(R.name)}</b><small>${esc(winner.name)} won by holding 60% of industry</small></div>
      <div class="clock-plaque"><span class="clock-face">${ic('clock')}<b>${clock(RT)}</b><small>/ ${clock(R.duration)}</small></span><small class="victory">Drag the timeline or press play</small></div>${btn('After-action report', { icon: 'book', kind: 'ghost' })}</header>`;
  const standings = `<aside class="outliner" data-region="standings" data-inset="${phone ? 'bottom' : 'right'}">
      <section class="ol ol-powers">${plaque(`Standings at ${clock(RT)}`, phone ? tabs([['s', 'Standings'], ['h', 'History']], 's') : '')}<div class="ol-body">${powersList(b, { viewer: null })}</div></section>
      ${phone ? '' : `<section class="ol ol-dispatch">${plaque(`History to ${clock(RT)}`)}<ol class="dp-list">${hist.slice(0, 40).map(e => `<li class="dp dp-news tone-${e.tone}">${ic(toneIcon[e.tone] || 'dispatch')}<div><header><b>${esc(e.title)}</b><time>${clock(e.tick)}</time></header><p>${esc(e.detail)}</p></div></li>`).join('')}</ol></section>`}
    </aside>`;
  const timeline = `<section class="plate timeline" data-region="timeline" data-inset="bottom">
      <div class="transport">${bezel('first', 'To start')}${bezel('back', 'Back 10 s')}<button type="button" class="play" data-sfx="press" aria-label="Play">${ic('play')}</button>${bezel('fwd', 'Forward 10 s')}${bezel('last', 'To end')}
        <div class="seg speed" role="group" aria-label="Speed">${['1×', '4×', '16×'].map((x, i) => `<button type="button" data-sfx="press" aria-pressed="${i === 2}">${x}</button>`).join('')}</div></div>
      <div class="scrub"><div class="track" style="--p:${RT / R.duration}">${marks}<i class="done"></i><b class="head"><span>${clock(RT)}</span></b></div>
        <div class="scale"><span>00:00</span><span>${clock(R.duration / 2)}</span><span>${clock(R.duration)}</span></div></div>
      ${phone ? '' : `<p class="next">${ic('right')}Next: ${clock(next.tick)} · ${esc(next.title)} — ${esc(next.detail)}</p>`}
    </section>`;
  return top + (phone ? `<div class="maparea"></div>` + standings + timeline : `<div class="maparea"></div>` + standings + timeline);
}

/* After-action report: the same plates, a victory plaque, alliance totals = sum of member Prestige. */
function reportScreen() {
  const R = m.review, win = R.alliances.find(a => a.id === R.outcome.winningSide), players = new Map(R.players.map(p => [p.country, p]));
  const colors = m.powers(replayState(m, R.duration), null).colors;
  const f1 = n => (Math.round(n * 10) / 10).toLocaleString('en', { maximumFractionDigits: 1 });
  const alliances = [...R.alliances].sort((a, b) => b.prestige - a.prestige);
  const table = alliances.map(a => `<tbody style="--c:${colors[a.id] || '#a5a28c'}"><tr class="grp${a.won ? ' won' : ''}"><th scope="row"><i class="sw"></i>${esc(a.name)}${a.won ? `<span class="tag">${ic('laurel')}Victor</span>` : ''}</th><td>${a.provinces}</td><td>${a.economy}</td><td class="pr">${f1(a.prestige)}</td></tr>
    ${a.members.map(id => { const p = players.get(id); return `<tr class="mem"><th scope="row">${insignia(id)}${esc(full(id))}<small>${p.kind === 'agent' ? 'Agent' : 'Human'}</small></th><td>${p.land}</td><td>${p.economy}</td><td class="pr${p.prestige < 0 ? ' neg' : ''}">${f1(p.prestige)}</td></tr>`; }).join('')}</tbody>`).join('');
  // Provinces held per alliance over time (review.series), as a share of the map.
  const W = 520, H = 150, total = m.map.provinces.length, top = .6; // y axis: 0–60% of the map
  const lines = alliances.map(a => { const pts = R.series.map(s => { const n = s.countries.filter(c => a.members.includes(c.country)).reduce((x, c) => x + c.land, 0); return `${(s.tick / R.duration * W).toFixed(1)},${(H - n / total / top * H).toFixed(1)}`; }).join(' ');
    return `<polyline points="${pts}" style="--c:${colors[a.id] || '#a5a28c'}"/>`; }).join('');
  const turning = R.events.filter(e => ['alliance_activated', 'dominance', 'dominance_broken', 'finished', 'eliminated'].includes(e.type));
  const copy = historyTo(m, R.duration).filter(e => ['alliance_activated', 'dominance', 'dominance_broken', 'finished', 'eliminated'].includes(e.type));
  return `<section class="plate report" data-region="report">
    <header class="victory-band"><div class="v-standards">${win.members.map(id => `<figure>${insignia(id)}<figcaption>${esc(short(id))}</figcaption></figure>`).join('')}</div>
      <div class="v-title"><small>After-action report · ${esc(R.name)}</small><h1>Victory for the ${esc(win.name)}</h1><p>Held 60% of active industry for ${R.rules.hold} seconds · match ended at ${clock(R.outcome.tick)} of ${clock(R.rules.duration)}</p></div>
      <div class="v-medal">${ic('laurel')}<b>${f1(win.prestige)}</b><small>alliance Prestige</small></div></header>
    <div class="report-body">
      <section class="r-table">${plaque('Final standings')}<table><thead><tr><th>Alliance / country</th><th>Provinces</th><th>Industry</th><th>Prestige</th></tr></thead>${table}</table>
        <p class="fine">Alliance Prestige is the total of its members' Prestige.</p></section>
      <section class="r-side">${plaque('Share of the map')}<figure class="chart"><svg viewBox="-4 -6 ${W + 8} ${H + 12}" preserveAspectRatio="none" aria-label="Provinces held by each alliance over time"><line x1="0" x2="${W}" y1="0" y2="0" class="grid"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="grid"/><line x1="0" x2="${W}" y1="${H}" y2="${H}" class="grid"/>${lines}</svg>
          <figcaption><span class="axis">Top line 60% · middle 30%</span>${alliances.map(a => `<span style="--c:${colors[a.id] || '#a5a28c'}"><i></i>${esc(a.name)}</span>`).join('')}</figcaption></figure>
        ${plaque('Turning points')}<ol class="turning">${copy.map(e => `<li class="tone-${e.tone}"><time>${clock(e.tick)}</time>${ic(toneIcon[e.tone] || 'dispatch')}<span><b>${esc(e.title)}</b> ${esc(e.detail)}</span></li>`).join('')}</ol></section>
    </div>
    <footer class="card-foot report-foot">${btn('Back to rooms', { icon: 'door', kind: 'ghost' })}${btn('Copy report link', { icon: 'link', kind: 'ghost' })}${btn('Watch the replay', { kind: 'primary', icon: 'play', sfx: 'confirm', attrs: 'id="primary"' })}</footer>
  </section>`;
}

/* Style tile: the whole system on one plate. */
function tileScreen() {
  const sw = [['Iron', '#23292b'], ['Iron high', '#333b3d'], ['Brass', '#c29a52'], ['Brass high', '#e8c98a'], ['Brass low', '#7d6231'], ['Oxblood', '#7a2621'], ['Verdigris', '#5f8f7e'], ['Ivory', '#efe4c8'], ['Muted', '#aaa690']];
  const icons = ['troops', 'land', 'industry', 'clock', 'bell', 'seal', 'war', 'ally', 'battle', 'dispatch', 'powers', 'mic', 'send', 'globe', 'home', 'gear', 'laurel', 'crown', 'play', 'link'];
  const sample = board.rows.find(r => r.kind === 'alliance');
  return `<section class="plate tile" data-region="tile">${plaque('Concept A · War Room — style tile', '<span class="plaque-note">Blued iron, brass fittings, oxblood enamel, verdigris</span>')}
    <div class="tile-grid">
      <section><h3>Material & colour</h3><ul class="swatches">${sw.map(([n, c]) => `<li><i style="background:${c}"></i><b>${n}</b><small>${c}</small></li>`).join('')}</ul></section>
      <section><h3>Type</h3><p class="t-display">Council of Iron</p><p class="t-h1">Victory for the Accord</p><p class="t-h2">Powers · Dispatches</p><p class="t-body">Barlow Condensed 16 — orders, rows and numbers <b>1 532 · 60.8%</b></p><p class="t-small">Barlow Condensed 14 — secondary lines, times 04:56</p></section>
      <section><h3>Buttons</h3><div class="spec-row">${btn('Accept alliance', { kind: 'primary', icon: 'seal' })}${btn('Hover', { kind: 'primary', cls: 'is-hover' })}${btn('Pressed', { kind: 'primary', cls: 'is-pressed' })}</div><div class="spec-row">${btn('Declare war', { kind: 'danger', icon: 'war' })}${btn('Decline')}${btn('Copy link', { kind: 'ghost', icon: 'link' })}${btn('Disabled', { attrs: 'disabled' })}</div><div class="spec-row">${bezel('gear', 'Menu')}${bezel('seal', 'Offer', { badge: '1' })}${bezel('home', 'Home', { cls: 'is-hover' })}${bezel('mic', 'Mic', { cls: 'on' })}</div></section>
      <section><h3>Tabs, slider, toggle</h3>${tabs([['a', 'World'], ['b', 'Direct', 2], ['c', 'Alliance']], 'b')}<div class="spec-row">${slider(11, 15, 'Amount')}</div><div class="presets">${[25, 50, 75, 100].map(p => `<button type="button" class="chip" aria-pressed="${p === 75}">${p}%</button>`).join('')}</div>${toggle(true, 'Battle cues')}${toggle(false, 'Read letters aloud')}<div class="seg">${['Political', 'Diplomacy'].map((x, i) => `<button type="button" aria-pressed="${i === 0}">${x}</button>`).join('')}</div></section>
      <section><h3>Leaderboard rows</h3><div class="ol-body spec-board">${powersList({ ...board, rows: [sample, board.rows.find(r => r.kind === 'country')], fronts: board.fronts.slice(0, 1) })}</div></section>
      <section><h3>Panel frame & plaque</h3><div class="plate mini-plate">${plaque('Orders', bezel('close', 'Close', { cls: 'mini' }))}<div class="card-body"><p class="note">Brass rim, dark inner line, corner brackets and studs. Plaques are engraved brass with dark Alegreya SC.</p></div><footer class="card-foot">${btn('Send 11 → Netherlands', { kind: 'primary', icon: 'march', cls: 'wide' })}</footer></div></section>
      <section><h3>Letter (event dialog)</h3><div class="mini-letter"><div class="letter-seal">${ic('seal')}</div><header><small>Alliance offer</small><h2>Channel Entente</h2><p>From the French Republic</p></header><footer>${btn('Decline')}${btn('Accept', { kind: 'primary', icon: 'seal' })}</footer></div></section>
      <section><h3>Toast · dispatch · chat</h3><div class="toast">${ic('battle')}<span><b>Battle at Alpine France</b> Germany attacks with 11. 12 defenders.</span></div><ol class="dp-list spec-dp">${[m.world.find(r => r.kind === 'headline'), m.dm('france').find(r => r.kind === 'chat' && r.from === 'france'), m.dm('france').find(r => r.from === you)].map(dispatchRow).join('')}</ol></section>
      <section><h3>Icons (original, engraved line)</h3><ul class="icon-set">${icons.map(n => `<li title="${n}">${ic(n)}<small>${n}</small></li>`).join('')}</ul></section>
      <section><h3>Motion & sound</h3><ul class="motion"><li><b>Letters unfold</b> from the seal (220 ms, ease-out), the one orchestrated moment per state.</li><li><b>Plates slide</b> 12 px from their anchored edge; nothing moves the camera by itself.</li><li><b>Press</b> sinks 1 px with an inner shadow; hover warms the brass.</li><li><b>Sound hooks</b> <code>data-sfx</code>: hover · press · confirm · war · seal.</li><li><b>Cursor</b>: brass crosshair over valid targets.</li><li>Reduced motion: all transitions become instant.</li></ul></section>
    </div></section>`;
}

/* ── Mount ── */
const html = { title, faction: () => factionScreen(), replay: replayScreen, report: reportScreen, tile: tileScreen }[S]?.() ?? shells[S]();
shell.className = `shell s-${S}`; shell.innerHTML = html;
for (const e of shell.querySelectorAll('[data-scroll-end]')) e.scrollTop = e.scrollHeight;
reviewerNav('A · War Room', 'Blued iron, brass and oxblood');
document.addEventListener('pointerdown', e => { const s = e.target.closest?.('[data-sfx]'); if (s) document.body.dataset.sfx = s.dataset.sfx; }); // sound hook (cue names only)

const insets = () => {
  const r = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const e of shell.querySelectorAll('[data-inset]')) {
    if (!e.checkVisibility()) continue; const b = e.getBoundingClientRect(), side = e.dataset.inset;
    if (side === 'top') r.top = Math.max(r.top, b.bottom); if (side === 'bottom') r.bottom = Math.max(r.bottom, innerHeight - b.top);
    if (side === 'left') r.left = Math.max(r.left, b.right); if (side === 'right') r.right = Math.max(r.right, innerWidth - b.left);
  }
  return r;
};
const mapOpts = {
  hud: { focus: 'world' }, offer: { focus: 'world' }, chat: { focus: 'world' }, menu: { focus: 'world' }, powers: { focus: 'world' }, title: { focus: 'world' }, tile: { focus: 'world' },
  province: { focus: 'low-countries', selected: m.order.from, target: m.order.to, width: phone ? 150 : 230, draft: { sources: [m.order.from], to: m.order.to, label: `${Math.round(m.order.free * .75)} · ${m.order.eta}s` } },
  country: { focus: 'rhineland', width: phone ? 260 : 420 },
  faction: { focus: 'england', width: phone ? 200 : 360 },
  replay: { focus: 'world', state: replayState(m, RT) }, report: { focus: 'world', state: replayState(m, m.review.duration) },
}[S];
const atlas = mountAtlas(svg, m, { ...mapOpts, insets });
// The draft label is sized for the zoom at paint time: repaint it once the camera has framed the target.
if (mapOpts.draft) requestAnimationFrame(() => requestAnimationFrame(() => atlas.setDraft(mapOpts.draft)));
if (S === 'country') atlas.setRelationFocus('germany');
if (S === 'powers') atlas.setRelationFocus(you);
requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { document.body.dataset.ready = '1'; }, 260)));
