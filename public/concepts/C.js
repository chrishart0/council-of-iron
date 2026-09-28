/** Concept C — "Modern minimal game". Prototype over the real atlas and recorded public data.
 * Every piece of player/room text goes through esc(); SVG markup here is authored constants only. */
import { load, mountAtlas, SCREENS, screen, reviewerNav, clock, esc, insignia, faction, replayState, historyTo } from '/concepts/kit/concept.js';
import { ic, ICONS } from '/concepts/C/icons.js';

const m = await load();
const S = screen(), live = m.live, you = m.you;
document.body.classList.add(`s-${S}`);
const shell = document.getElementById('shell');
const phone = () => innerWidth < 700;

/* ── data helpers ── */
const hex = v => /^#[0-9a-f]{6}$/i.test(v) ? v : '#8a93a3';
const countryColor = id => hex(m.map.countries.find(c => c.id === id)?.color);
const name = id => m.names.country(id), short = id => faction(id).short, prov = id => m.names.province(id);
const P = id => live.provinces.find(p => p.id === id);
const fmt = n => Math.round(n).toLocaleString('en-GB');
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const pct = n => `${Math.round(n * 100)}%`;
const powers = m.powers();
const memberOf = id => { for (const r of powers.rows) { if (r.id === id) return { row: r, member: r }; const mm = r.members?.find(x => x.id === id); if (mm) return { row: r, member: mm }; } return null; };
const sideOf = id => live.players.find(p => p.id === id)?.side;
const sideName = side => live.sides.find(s => s.id === side && !s.id.startsWith('solo:'))?.name ?? null;

/* ── components ── */
const std = (id, cls = '') => `<span class="std ${cls}" style="--c:${countryColor(id)}">${insignia(id)}</span>`;
const tip = (text, key) => ` data-tip="${esc(text)}${key ? ` · ${esc(key)}` : ''}"`;
const btn = (label, { kind = 'secondary', icon, sfx = 'press', key, attrs = '', cls = '' } = {}) =>
  `<button type="button" class="btn btn-${kind} ${cls}" data-sfx="${sfx}" ${attrs}>${icon ? ic(icon) : ''}<span>${label}</span>${key && !phone() ? `<kbd>${esc(key)}</kbd>` : ''}</button>`;
const round = (icon, label, { badge, tone = '', key, pressed, cls = '', sfx = 'press' } = {}) =>
  `<button type="button" class="round ${tone} ${cls}" aria-label="${esc(label)}"${pressed !== undefined ? ` aria-pressed="${pressed}"` : ''} data-sfx="${sfx}"${tip(label, key)}>${ic(icon)}${badge ? `<b class="badge">${badge}</b>` : ''}</button>`;
const pill = (icon, value, label, cls = '') => `<span class="pill ${cls}"${tip(label)}>${ic(icon)}<b>${value}</b><span class="sr">${esc(label)}</span></span>`;
const ring = (value, max, label) => { const k = Math.max(0, Math.min(1, value / max)), c = 2 * Math.PI * 15;
  return `<span class="pill ring-pill"${tip(label)}><svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle class="ring-fill" cx="18" cy="18" r="15" stroke-dasharray="${(k * c).toFixed(1)} ${c.toFixed(1)}"/></svg>${ic('industry', 'ring-ic')}<b>${value}<small>/${max}</small></b><span class="sr">${esc(label)}</span></span>`; };
const seg = (items, active, label) => `<div class="seg" role="tablist" aria-label="${esc(label)}">${items.map(([id, text, badge]) => `<button type="button" role="tab" aria-selected="${id === active}" data-sfx="press" data-tab="${id}">${text}${badge ? `<b class="badge">${badge}</b>` : ''}</button>`).join('')}</div>`;
const slider = (value, max, label) => `<div class="slider" role="slider" tabindex="0" aria-label="${esc(label)}" aria-valuemin="1" aria-valuemax="${max}" aria-valuenow="${value}" style="--k:${value / max}" data-max="${max}"><i class="track"></i><i class="fill"></i><i class="thumb"></i></div>`;
const toggle = (on, label) => `<button type="button" class="toggle" role="switch" aria-checked="${on}" data-sfx="press"><i></i><span>${esc(label)}</span></button>`;
const panelHead = (icon, title, extra = '', close = true) => `<header class="p-head">${ic(icon, 'p-ic')}<h2>${title}</h2>${extra}${close ? `<button type="button" class="x" aria-label="Close" data-sfx="press"${tip('Close', 'Esc')}>${ic('close')}</button>` : ''}</header>`;

/* ── HUD pieces ── */
const leaderSide = [...live.sides].sort((a, b) => b.economy - a.economy)[0];
function playerChip() {
  const side = sideName(sideOf(you));
  return `<div class="chip player sticker" data-region="player">
    <button type="button" class="player-std" aria-label="Your country"${tip('Your country & alliance', 'A')} data-sfx="press">${std(you, 'std-lg')}</button>
    <div class="player-name"><b>${esc(name(you))}</b><span class="tag ${side ? 'tag-ally' : ''}">${side ? esc(side) : 'Independent'}</span></div>
    <div class="pills">${pill('troops', fmt(m.stats.troops), 'Troops')}${pill('land', `${m.stats.land}<small>/${m.stats.provinces}</small>`, 'Provinces held')}${ring(m.stats.industry, m.stats.threshold, `Your industry toward victory (${m.stats.threshold} = 60% of active industry)`)}</div>
  </div>`;
}
const clockChip = (t = m.stats.tick, total = m.stats.duration, status) => `<div class="chip clock sticker" data-region="clock"${tip('Match clock')}>${ic('clock')}<b class="num">${clock(t)}</b><small>/ ${clock(total)}</small>
  <span class="status">${status ?? `Win: ${m.stats.threshold} industry for 90 s · ${esc(leaderSide.name === leaderSide.members[0] ? short(leaderSide.members[0]) : leaderSide.name)} leads with ${leaderSide.economy}`}</span></div>`;
const menuBtn = () => `<div class="menu-slot" data-region="menu-button">${round('menu', 'Menu', { key: 'Esc', cls: 'round-dark' })}</div>`;

const armyToTarget = live.armies.find(a => a.country === you && a.to === m.order.to);
const notes = [
  m.offer && { id: 'offer', icon: 'alliance', tone: 'teal', label: `Alliance offer from ${short(m.offer.creator)}`, urgent: true },
  { id: 'dm', icon: 'mail', tone: 'blue', label: `Message from ${short('france')}`, badge: 1 },
  armyToTarget && { id: 'army', icon: 'target', tone: 'gold', label: `${armyToTarget.amount} arriving at ${prov(armyToTarget.to)} in ${armyToTarget.arrivesAt - live.tick}s` },
  { id: 'war', icon: 'war', tone: 'red', label: `At war with ${m.relations.enemies.map(short).join(', ')}` },
].filter(Boolean);
const lane = (open) => `<nav class="lane" data-region="lane" aria-label="Notifications">${notes.map(n => round(n.icon, n.label, { badge: n.badge, tone: `tone-${n.tone} ${n.urgent ? 'urgent' : ''}`, pressed: n.id === open, sfx: 'hover' })).join('')}</nav>`;
const laneBadge = () => `<div class="lane-badge" data-region="lane">${round('bell', `${notes.length} notifications`, { badge: notes.length, tone: 'tone-teal urgent' })}</div>`;
const dock = (open) => `<nav class="dock" data-region="dock" aria-label="Panels and camera">
  ${round('trophy', 'Powers', { key: 'P', pressed: open === 'powers' })}${round('chat', 'Chat', { key: 'T', badge: 1, pressed: open === 'chat' })}
  <span class="dock-gap"></span>${round('home', 'My country', { key: 'C' })}${phone() ? '' : round('plus', 'Zoom in', { key: 'E', cls: 'round-sm' }) + round('minus', 'Zoom out', { key: 'Q', cls: 'round-sm' })}</nav>`;

/* ── panels ── */
function powersPanel(pw = powers, { title = 'Powers', viewer = you, region = 'panel', sub = '', close = true, compact = false } = {}) {
  const color = id => hex(pw.colors[id]);
  const mark = r => r.you ? `<span class="rel rel-you">You</span>` : r.relation === 'enemy' ? `<span class="rel rel-war"${tip('At war with you')}>${ic('war')}</span>` : r.relation === 'ally' ? `<span class="rel rel-ally">${ic('alliance')}</span>` : '<span class="rel"></span>';
  const warDots = r => r.atWarWith?.length ? `<span class="wars-n"${tip(`At war with ${r.atWarWith.map(short).join(', ')}`)}>${ic('war')}${r.atWarWith.length}</span>` : '<span></span>';
  const rows = pw.rows.map(r => r.kind === 'alliance'
    ? `<li class="lb-group${r.members.some(x => x.you) ? ' mine' : ''}" style="--team:${color(r.id)}">
        <div class="lb-row lb-total"><span class="rk">${r.rank}</span><span class="swatch"></span><b class="nm">${esc(r.name)}</b>${warDots(r)}<span class="n">${r.provinces}</span><span class="n">${fmt(r.troops)}</span></div>
        <ul>${r.members.map(x => `<li class="lb-row lb-member${x.you ? ' you' : ''}"><span class="rk"></span>${std(x.id, 'std-xs')}<span class="nm">${esc(short(x.id))}</span>${mark(x)}<span class="bar"${tip(`${pct(x.shareOfAlliance)} of the alliance's troops`)}><i style="width:${pct(x.shareOfAlliance)}"></i></span><span class="n">${x.provinces}</span><span class="n">${fmt(x.troops)}</span></li>`).join('')}</ul></li>`
    : `<li class="lb-group solo${r.you ? ' mine' : ''}"><div class="lb-row lb-member${r.you ? ' you' : ''}"><span class="rk">${r.rank}</span>${std(r.id, 'std-xs')}<b class="nm">${esc(short(r.id))}</b>${mark(r)}<span class="solo-tag">Independent</span><span class="n">${r.provinces}</span><span class="n">${fmt(r.troops)}</span></div></li>`).join('');
  const sideLabel = s => esc(s.name ?? s.countries.map(short).join(' + '));
  const fronts = pw.fronts.map(f => { const mine = viewer && f.sides.some(s => s.countries.includes(viewer));
    return `<li class="front${mine ? ' mine' : ''}"><span style="--team:${hex(pw.colors[f.sides[0].side]) }" class="fs">${sideLabel(f.sides[0])}</span>${ic('war', 'front-ic')}<span style="--team:${hex(pw.colors[f.sides[1].side])}" class="fs">${sideLabel(f.sides[1])}</span></li>`; }).join('');
  return `<section class="panel powers sticker${compact ? ' compact' : ''}" data-region="${region}" aria-label="${esc(title)}">
    ${panelHead('trophy', title, sub ? `<span class="p-sub">${sub}</span>` : seg([['teams', 'Teams'], ['players', 'Players']], 'teams', 'Rank'), close)}
    <div class="lb-cols" aria-hidden="true"><span>#</span><span>Power</span><span>${ic('land')}</span><span>${ic('troops')}</span></div>
    <div class="lb-scroll"><ol class="lb">${rows}</ol>
    ${fronts ? `<h3 class="sub-h">${ic('war')} Wars <small>${pw.fronts.length}</small></h3><ul class="fronts">${fronts}</ul>` : ''}</div>
  </section>`;
}
function bubble(r, { inline = true } = {}) {
  if (r.kind === 'chat') { const mine = r.from === you;
    return `<li class="msg ${mine ? 'mine' : ''}">${mine ? '' : std(r.from, 'std-sm')}<div class="bub"><header><b>${esc(short(r.from))}</b><time>${clock(r.tick)}</time></header><p>${esc(r.text)}</p></div></li>`; }
  if (r.kind === 'system' && r.system === 'offer' && inline && m.offer) return `<li class="sys sys-offer"><div class="sys-card">${ic('alliance', 'sys-ic')}<div><b>${esc(r.title)} · ${esc(r.name)}</b><p>${esc(r.detail.replace(/Maximum share ([\d.]+) points each\./, (_, n) => `Up to ${Math.round(Number(n))} Prestige each.`))}</p><div class="row">${btn('Accept', { kind: 'primary', icon: 'check', sfx: 'seal' })}${btn('Decline', { kind: 'ghost' })}</div></div></div></li>`;
  return `<li class="sys tone-${esc(r.tone)}"><span class="sys-line">${ic(r.tone === 'war' ? 'war' : r.tone === 'alliance' ? 'alliance' : 'flag')}<b>${esc(r.title)}</b> ${esc(r.detail)}</span><time>${clock(r.tick)}</time></li>`;
}
function chatPanel(tab = 'dm', region = 'panel') {
  const contacts = live.players.filter(p => p.id !== you).map(p => `<button type="button" class="contact" aria-pressed="${p.id === 'france'}" data-sfx="press"${tip(name(p.id))}>${std(p.id, 'std-sm')}${p.id === 'france' ? '<b class="badge">1</b>' : ''}</button>`).join('');
  const list = tab === 'world' ? m.world.slice(-12) : tab === 'dm' ? m.dm('france') : [];
  return `<section class="panel chat sticker" data-region="${region}" aria-label="Chat">
    ${panelHead('chat', 'Chat', seg([['world', 'World'], ['alliance', 'Alliance'], ['dm', 'Direct', 1]], tab, 'Channel'))}
    ${tab === 'dm' ? `<div class="contacts" role="group" aria-label="Conversations">${contacts}</div><div class="thread-head">${std('france', 'std-sm')}<b>${esc(name('france'))}</b><span class="tag">Neutral</span><span class="tag tag-war">At war with Germany</span></div>` : ''}
    ${tab === 'alliance' ? `<div class="empty">${ic('alliance', 'empty-ic')}<b>No alliance yet</b><p>You are independent. Open a country and propose an alliance to get a private channel.</p></div>` : `<ol class="thread">${list.map(r => bubble(r)).join('')}</ol>`}
    <form class="composer"><label class="field"><span class="sr">Message</span><input maxlength="500" placeholder="${tab === 'dm' ? 'Message France…' : 'Message everyone…'}" autocomplete="off"></label>${round('mic', 'Voice input', { key: 'V', cls: 'round-sm round-light' })}${round('send', 'Send', { key: 'Enter', cls: 'round-sm round-gold', sfx: 'confirm' })}</form>
  </section>`;
}
function provinceCard() {
  const from = P(m.order.from), to = P(m.order.to), amount = Math.round(m.order.free / 2), eta = m.order.eta;
  const owner = to.owner, hostile = owner && m.relations.enemies.includes(owner);
  const verb = !owner ? `Take ${esc(prov(to.id))} with ${amount}` : hostile ? `Attack ${esc(prov(to.id))} with ${amount}` : `Send ${amount} → ${esc(prov(to.id))}`;
  return `<section class="card sticker" data-region="card" aria-labelledby="card-title">
    <header class="c-head">${std(you, 'std-md')}<div><h2 id="card-title">${esc(prov(from.id))}</h2><p>${esc(name(you))} · your province</p></div><button type="button" class="x" aria-label="Close" data-sfx="press"${tip('Close', 'Esc')}>${ic('close')}</button></header>
    <div class="stats">
      <div class="stat">${ic('troops')}<b>${from.troops}</b><span>free troops</span></div>
      <div class="stat">${ic('industry')}<b>${'●'.repeat(from.development)}<i>${'●'.repeat(3 - from.development)}</i></b><span>industry ${from.development}/3</span></div>
      <div class="stat">${ic('clock')}<b>${from.nextRecruit - live.tick}s</b><span>+${from.development} recruits</span></div>
    </div>
    <div class="target"><span class="t-ic">${ic('target')}</span><div><b>${esc(prov(to.id))}</b><p>${owner ? esc(name(owner)) : 'Unclaimed'} · ${to.troops} defending · ${eta ?? '?'}s march</p>
      ${armyToTarget ? `<p class="t-note">${ic('arrow')} ${armyToTarget.amount} of yours already on the way · ${armyToTarget.arrivesAt - live.tick}s</p>` : ''}</div></div>
    <div class="amount"><div class="amount-line"><span>Troops to send</span><output class="num">${amount}<small> / ${m.order.free}</small></output></div>
      ${slider(amount, m.order.free, 'Troops to send')}
      <div class="chips" role="group" aria-label="Share of free troops">${[25, 50, 75, 100].map(p => `<button type="button" class="chip-btn" aria-pressed="${p === 50}" data-sfx="press">${p}%</button>`).join('')}</div></div>
    <div class="c-actions">${btn(verb, { kind: 'primary', icon: 'arrow', sfx: 'confirm', key: 'Enter', cls: 'wide', attrs: 'id="primary"' })}</div>
  </section>`;
}
function countryCard(id = 'germany') {
  const found = memberOf(id), side = sideName(sideOf(id)), partners = found?.row.kind === 'alliance' ? found.row.members.filter(x => x.id !== id) : [];
  const me = found?.member, wars = me?.atWarWith || [];
  const warWith = [id, ...partners.map(x => x.id)];
  return `<section class="card sticker" data-region="card" aria-labelledby="card-title">
    <header class="c-head">${std(id, 'std-md')}<div><h2 id="card-title">${esc(name(id))}</h2><p>${side ? `${esc(side)} · with ${partners.map(x => esc(short(x.id))).join(', ')}` : 'Independent'}</p></div><button type="button" class="x" aria-label="Close" data-sfx="press"${tip('Close', 'Esc')}>${ic('close')}</button></header>
    <div class="relation"><span class="rel-big">Neutral</span><span>No war, no treaty with you</span></div>
    <div class="stats">
      <div class="stat">${ic('troops')}<b>${fmt(me?.troops ?? 0)}</b><span>troops</span></div>
      <div class="stat">${ic('land')}<b>${me?.provinces ?? 0}</b><span>provinces</span></div>
      <div class="stat">${ic('alliance')}<b>${fmt(found?.row.troops ?? 0)}</b><span>bloc troops</span></div>
    </div>
    <div class="at-war"><span>${ic('war')} At war with</span><div class="stds">${wars.map(w => `<span class="mini"${tip(name(w))}>${std(w, 'std-xs')}${esc(short(w))}</span>`).join('')}</div></div>
    <p class="terms">${ic('info')} An alliance with ${esc(short(id))} would bring you into ${side ? esc(side) : 'a new bloc'}; every member must accept. Declaring war puts you at war with ${warWith.map(w => esc(short(w))).join(' and ')}.</p>
    <div class="c-actions two">${btn('Declare war', { kind: 'danger', icon: 'war', sfx: 'war' })}${btn('Propose alliance', { kind: 'primary', icon: 'alliance', sfx: 'seal', key: 'Enter', attrs: 'id="primary"' })}</div>
  </section>`;
}
function offerNote() {
  const q = m.offer, left = q.expiresAt - live.tick, share = (100 * live.players.length / q.roster.length).toFixed(0);
  const quote = m.dm('france').filter(r => r.kind === 'chat' && r.from === q.creator).at(-1);
  return `<section class="note sticker" data-region="note" role="alertdialog" aria-labelledby="note-title">
    <header class="n-head"><span class="n-ic tone-teal">${ic('alliance')}</span><div><small>Alliance offer · ${clock(left)} left</small><h2 id="note-title">${esc(q.name)}</h2></div><button type="button" class="x" aria-label="Later" data-sfx="press"${tip('Later', 'Esc')}>${ic('close')}</button></header>
    <div class="roster">${q.roster.map(id => `<span class="mini">${std(id, 'std-sm')}<b>${esc(short(id))}</b>${q.accepted.includes(id) ? `<i class="ok">${ic('check')}</i>` : '<i class="wait">?</i>'}</span>`).join('<span class="plus">+</span>')}</div>
    ${quote ? `<blockquote>${std(q.creator, 'std-xs')}<p>${esc(quote.text)}</p></blockquote>` : ''}
    <ul class="facts"><li>${ic('star')} Up to <b>${share}</b> Prestige each if you win together</li><li>${ic('clock')} Active ${live.rules.notice}s after you accept</li><li>${ic('war')} ${esc(short(q.creator))} is at war with ${esc((memberOf(q.creator)?.member.atWarWith || []).map(short).join(' + ') || 'no one')}</li></ul>
    <div class="c-actions two">${btn('Decline', { kind: 'ghost', icon: 'close' })}${btn('Accept alliance', { kind: 'primary', icon: 'check', sfx: 'seal', key: 'Enter', attrs: 'id="primary"' })}</div>
  </section>`;
}

/* ── screens ── */
const hudBase = ({ card = '', panel = '', note = '', open = '', sheet = false } = {}) => `
  <div class="top">${playerChip()}${clockChip()}${menuBtn()}</div>
  ${phone() ? laneBadge() : lane(note ? 'offer' : '')}
  ${note}${card}${panel}${sheet ? '' : dock(open)}`;
const R = {
  hud: () => hudBase({ panel: phone() ? '' : powersPanel(), open: phone() ? '' : 'powers' }),
  province: () => hudBase({ card: provinceCard(), panel: phone() ? '' : powersPanel(), open: 'powers', sheet: phone() }),
  country: () => hudBase({ card: countryCard(), panel: phone() ? '' : powersPanel(), open: 'powers', sheet: phone() }),
  offer: () => hudBase({ note: offerNote(), panel: phone() ? '' : powersPanel(powers, { compact: true }), open: phone() ? '' : 'powers' }),
  chat: () => hudBase({ panel: chatPanel('dm'), open: 'chat', sheet: phone() }),
  powers: () => hudBase({ panel: powersPanel(), open: 'powers', sheet: phone() }),
  menu: () => `${menuPanel()}`,
  replay: replayScreen, report: reportScreen, title: titleScreen, faction: factionScreen, tile: tileScreen,
};

function menuPanel() {
  const keys = [['Drag', 'Send troops'], ['Enter', 'Confirm'], ['Esc', 'Close / menu'], ['C', 'My country'], ['Q / E', 'Zoom'], ['M', 'Diplomacy colours'], ['P', 'Powers'], ['T', 'Chat'], ['V', 'Voice']];
  return `<section class="menu-panel sticker" data-region="menu" role="dialog" aria-labelledby="menu-title">
    <header class="p-head big">${ic('gear', 'p-ic')}<div><h2 id="menu-title">Menu</h2><p class="p-sub">${esc(live.name)} · the match keeps running</p></div><button type="button" class="x" aria-label="Close menu" data-sfx="press"${tip('Resume', 'Esc')}>${ic('close')}</button></header>
    <div class="menu-grid">
      <section class="m-box"><h3>${ic('map')} Map</h3>${seg([['world', 'World'], ['europe', 'Europe'], ['home', 'My country']], 'world', 'Map view')}
        <div class="m-row"><span>Colours</span>${seg([['political', 'Countries'], ['diplomacy', 'Diplomacy']], 'political', 'Map colours')}</div>
        <ul class="key">${live.sides.filter(s => !s.id.startsWith('solo:')).map(s => `<li style="--team:${hex(m.colors[s.id])}"><i></i>${esc(s.name)}</li>`).join('')}<li class="key-war"><i></i>War front</li><li class="key-threat"><i></i>Threatened province</li></ul></section>
      <section class="m-box"><h3>${ic('sound')} Sound</h3>
        <div class="m-row"><span>Music</span>${slider(4, 10, 'Music volume')}</div><div class="m-row"><span>Effects</span>${slider(7, 10, 'Effects volume')}</div>
        ${toggle(true, 'Battle and treaty stingers')}
        <h3>${ic('voice')} Voice</h3>${toggle(true, 'Voice input (hold V or tap the mic)')}<p class="hint">Speak, check the words, send.</p></section>
      <section class="m-box"><h3>${ic('keyboard')} Controls</h3><dl class="keys">${keys.map(([k, v]) => `<div><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`).join('')}</dl></section>
      <section class="m-box"><h3>${ic('link')} Room</h3><div class="stack">${btn('Copy room link', { icon: 'copy' })}${btn('Show the three tips again', { icon: 'info' })}${btn('Leave room', { kind: 'danger-ghost', icon: 'exit' })}</div></section>
    </div>
    <div class="c-actions">${btn('Resume', { kind: 'primary', icon: 'play', key: 'Esc', cls: 'wide', attrs: 'id="primary"' })}</div>
  </section>`;
}

const RTICK = 300;
function replayScreen() {
  const state = replayState(m, RTICK), pw = m.powers(state, null), hist = historyTo(m, RTICK).slice(-14).reverse(), dur = m.review.duration;
  const dots = m.review.events.filter(e => e.type !== 'army_recalled' && e.type !== 'development_started').map(e => {
    const big = ['alliance_activated', 'dominance', 'dominance_broken', 'finished'].includes(e.type);
    return `<i class="dot ${big ? 'big' : ''} d-${esc(e.type)}" style="left:${(100 * e.tick / dur).toFixed(2)}%"></i>`; }).join('');
  const toneIc = { war: 'war', alliance: 'alliance', industry: 'industry', victory: 'crown', neutral: 'flag' };
  const history = `<section class="panel history sticker" data-region="history" aria-label="History to this moment">${panelHead('history', 'History', `<span class="p-sub">to ${clock(RTICK)}</span>`, false)}
    <ol class="hist">${hist.map(h => `<li class="tone-${esc(h.tone)}"><span class="h-ic">${ic(toneIc[h.tone] || 'flag')}</span><div><b>${esc(h.title)}</b><p>${esc(h.detail)}</p></div><time>${clock(h.tick)}</time></li>`).join('')}</ol></section>`;
  const latest = hist[0];
  return `
    <div class="top"><div class="chip replay-title" data-region="player"><button type="button" class="round round-sm round-light" aria-label="Back to report" data-sfx="press"${tip('Back to report', 'Esc')}>${ic('back')}</button><div><b>${esc(m.review.name)}</b><span class="tag">Replay · ${esc(m.review.alliances.find(a => a.won)?.name ?? '')} won</span></div></div>
    ${clockChip(RTICK, dur, 'Replay')}<span></span></div>
    ${powersPanel(pw, { title: 'Standings', viewer: null, region: 'panel', sub: `at ${clock(RTICK)}`, close: false })}
    ${phone() ? '' : history}
    <section class="scrub sticker" data-region="scrubber" aria-label="Playback">
      ${phone() && latest ? `<p class="latest">${ic(toneIc[latest.tone] || 'flag')}<b>${esc(latest.title)}</b> ${esc(latest.detail)}</p>` : ''}
      <div class="scrub-row">${round('back', 'Back 10 s', { cls: 'round-sm round-light', key: '←' })}${round('play', 'Play', { cls: 'round-gold', key: 'Space' })}${round('forward', 'Forward 10 s', { cls: 'round-sm round-light', key: '→' })}
      <div class="timeline" role="slider" tabindex="0" aria-label="Replay time" aria-valuemin="0" aria-valuemax="${dur}" aria-valuenow="${RTICK}" aria-valuetext="${clock(RTICK)} of ${clock(dur)}" style="--k:${RTICK / dur}"><i class="track"></i><i class="fill"></i>${dots}<i class="thumb"><b>${clock(RTICK)}</b></i></div>
      <button type="button" class="chip-btn speed" data-sfx="press"${tip('Playback speed')}>8×</button></div>
    </section>`;
}

function reportScreen() {
  const r = m.review, won = r.alliances.find(a => a.won), endColors = m.powers(replayState(m, r.duration), null).colors;
  const teams = [...r.alliances].sort((a, b) => b.prestige - a.prestige);
  const podium = [teams[1], teams[0], teams[2]].filter(Boolean).map(a => { const place = teams.indexOf(a) + 1;
    return `<div class="podium-col p${place}" style="--team:${hex(endColors[a.id])}"><div class="p-stds">${a.members.map(id => std(id, 'std-sm')).join('')}</div><b class="p-name">${esc(a.name)}</b><div class="block"><span class="place">${place}</span><b class="num">${signed(a.prestige)}</b><small>Prestige</small></div></div>`; }).join('');
  const players = [...r.players].sort((a, b) => b.prestige - a.prestige || b.land - a.land);
  const table = `<table class="scores"><thead><tr><th>Country</th><th>${ic('land')}<span class="sr">Provinces</span></th><th>${ic('troops')}<span class="sr">Troops</span></th><th>${ic('star')}<span class="sr">Prestige</span></th></tr></thead><tbody>${players.map(p => `<tr class="${p.country === 'britain' ? 'you' : ''}" style="--team:${hex(endColors[p.side])}"><td><span class="swatch"></span>${std(p.country, 'std-xs')}<b>${esc(short(p.country))}</b></td><td class="num">${p.land}</td><td class="num">${fmt(p.troops)}</td><td class="num ${p.prestige >= 0 ? 'pos' : 'neg'}">${signed(p.prestige)}</td></tr>`).join('')}</tbody></table>`;
  // Land share by final roster, from the public series.
  const W = 460, H = 150, total = m.map.provinces.length, xs = t => (t / r.duration) * W, ys = v => H - (v / total) * H;
  const lines = r.alliances.map(a => `<polyline style="--team:${hex(endColors[a.id])}" points="${r.series.map(s => `${xs(s.tick).toFixed(1)},${ys(s.countries.filter(c => a.members.includes(c.country)).reduce((n, c) => n + c.land, 0)).toFixed(1)}`).join(' ')}"/>`).join('');
  const chart = `<figure class="chart"><svg viewBox="-34 -8 ${W + 44} ${H + 30}" role="img" aria-label="Provinces held by each final alliance over time">${[0, .25, .5, .75].map(k => `<line x1="0" x2="${W}" y1="${ys(total * k)}" y2="${ys(total * k)}"/><text x="-8" y="${ys(total * k) + 4}">${Math.round(k * 100)}%</text>`).join('')}${[0, 120, 240, 360, 480].map(t => `<text class="tx" x="${xs(t)}" y="${H + 20}">${clock(t)}</text>`).join('')}${lines}</svg>
    <figcaption>${r.alliances.map(a => `<span style="--team:${hex(endColors[a.id])}"><i></i>${esc(a.name)}</span>`).join('')}</figcaption></figure>`;
  const moments = historyTo(m, r.duration).filter(h => ['alliance_activated', 'dominance', 'dominance_broken', 'finished'].includes(h.type)).slice(-6);
  const toneIc = { war: 'war', alliance: 'alliance', victory: 'crown' };
  const momentList = `<ol class="moments">${moments.map(h => `<li class="tone-${esc(h.tone)}"><time>${clock(h.tick)}</time>${ic(toneIc[h.tone] || 'flag')}<div><b>${esc(h.title)}</b><p>${esc(h.detail)}</p></div></li>`).join('')}</ol>`;
  const hero = `<header class="r-hero"><div class="r-crown">${ic('crown')}</div><div><small>Match over · ${clock(r.outcome.tick)} · ${esc(r.outcome.reason === 'domination' ? 'held 60% of industry' : r.outcome.reason)}</small><h1>${esc(won?.name ?? 'Draw')} wins</h1><p>${won ? won.members.map(id => esc(name(id))).join(', ') : ''}. You finished with <b>${signed(r.players.find(p => p.country === 'britain').prestige)}</b> Prestige.</p></div></header>`;
  const pre = id => r.players.find(p => p.country === id)?.prestige ?? 0;
  const sums = `<ul class="a-sum">${teams.map(a => `<li style="--team:${hex(endColors[a.id])}"><span class="swatch"></span><b class="nm">${esc(a.name)}</b><span class="mem">${a.members.map(id => `<span class="mini">${std(id, 'std-xs')}${signed(pre(id))}</span>`).join('')}</span><b class="num">${signed(a.prestige)}</b></li>`).join('')}</ul>`;
  const def = `<p class="def">${ic('info')} Alliance score: its final members' Prestige added together.</p>`;
  const actions = `<div class="c-actions two r-actions">${btn('All rooms', { kind: 'ghost', icon: 'exit' })}${btn('Watch replay', { kind: 'primary', icon: 'play', key: 'R', attrs: 'id="primary"' })}</div>`;
  if (phone()) return `<section class="report sticker" data-region="report">${hero}${seg([['podium', 'Podium'], ['table', 'Scores'], ['chart', 'Timeline']], 'podium', 'Report section')}
    <div class="r-body"><div class="podium">${podium}</div>${def}${momentList}</div>${actions}</section>`;
  return `<section class="report sticker" data-region="report">${hero}
    <div class="r-grid"><section class="r-box"><h3>${ic('trophy')} Alliances</h3><div class="podium">${podium}</div>${sums}${def}</section>
    <section class="r-box"><h3>${ic('star')} Countries</h3>${table}</section>
    <section class="r-box"><h3>${ic('land')} Land held</h3>${chart}<h3>${ic('history')} Moments</h3>${momentList}</section></div>${actions}</section>`;
}

function titleScreen() {
  const winner = m.review.alliances.find(a => a.won);
  const rooms = [
    { name: live.name, state: 'Live', tone: 'live', meta: `${clock(live.tick)} / ${clock(live.rules.duration)} · ${live.players.length} of 8 seats`, stds: live.players.map(p => p.id), action: btn('Watch', { icon: 'eye' }) },
    { name: m.review.name, state: 'Finished', tone: 'done', meta: `${winner ? `${esc(winner.name)} won` : 'Draw'} · ${clock(m.review.duration)}`, stds: m.review.players.map(p => p.country), action: btn('Replay', { icon: 'play' }) },
    { name: 'The evening council', state: 'Open', tone: 'open', meta: '3 seats open · 30 min', stds: ['russia', 'japan', 'usa'], action: btn('Join', { kind: 'primary', icon: 'arrow' }) },
  ];
  return `
    <section class="hero-box" data-region="hero"><div class="logo">${ic('star', 'logo-ic')}<h1>Council<span>of Iron</span></h1></div>
      <p class="lede">Eight powers, humans and AI agents, one live map. Win together, or take it alone.</p>
      <div class="hero-actions">${btn('Quick match', { kind: 'primary', icon: 'play', cls: 'xl', attrs: 'id="primary"' })}${btn('Watch live', { icon: 'eye', cls: 'xl' })}</div>
      <div class="profile"><span class="avatar">${ic('troops')}</span><div><b>Chris</b><small>Prestige +166 · 4 matches</small></div>${round('gear', 'Settings', { cls: 'round-sm round-light' })}</div></section>
    <section class="panel rooms sticker" data-region="rooms">${panelHead('flag', 'Rooms', seg([['all', 'All'], ['open', 'Open'], ['live', 'Live']], 'all', 'Filter'), false)}
      <ul class="room-list">${rooms.map(x => `<li class="room"><div class="room-main"><span class="state st-${x.tone}">${esc(x.state)}</span><b>${esc(x.name)}</b><small>${x.meta}</small><div class="room-stds">${x.stds.map(id => std(id, 'std-xs')).join('')}</div></div>${x.action}</li>`).join('')}</ul>
      <form class="create"><h3>${ic('plus')} New room</h3><label class="field"><span class="sr">Room name</span><input value="The evening council" maxlength="80"></label>
        ${seg([['standard', 'Standard · 30 min'], ['quick', 'Quick · 5 min']], 'standard', 'Pace')}${btn('Create room', { kind: 'secondary', icon: 'arrow', cls: 'wide' })}</form></section>`;
}

const PICK = 'britain';
function factionScreen() {
  const c = m.map.countries.find(x => x.id === PICK), seat = id => live.players.find(p => p.id === id);
  const tiles = m.map.countries.map(x => { const p = seat(x.id), mine = x.id === you;
    return `<button type="button" class="f-tile" aria-pressed="${x.id === PICK}" data-sfx="press" style="--c:${countryColor(x.id)}">${std(x.id, 'std-lg')}<b>${esc(short(x.id))}</b><small>${x.start.length} provinces</small><span class="seat ${mine ? 'seat-you' : 'seat-ai'}">${mine ? 'You' : p?.kind === 'human' ? 'Human' : 'AI agent'}</span></button>`; }).join('');
  return `
    <section class="panel factions sticker" data-region="factions"><header class="p-head big">${ic('flag', 'p-ic')}<div><h2>Choose your country</h2><p class="p-sub">${esc(live.name)} · 8 seats · pick a standard</p></div></header><div class="f-grid">${tiles}</div></section>
    <section class="panel f-detail sticker" data-region="detail" style="--c:${countryColor(PICK)}">
      <div class="f-hero">${std(PICK, 'std-xl')}<div><h2>${esc(c.name)}</h2><p>Your seat</p></div></div>
      <div class="stats"><div class="stat">${ic('land')}<b>${c.start.length}</b><span>provinces</span></div><div class="stat">${ic('flag')}<b>${c.homeland.length}</b><span>homeland</span></div><div class="stat">${ic('map')}<b>${c.colonies.length}</b><span>colonies</span></div></div>
      <div class="f-provs"><h3>Homeland</h3><div class="tags">${c.homeland.map(id => `<span class="tag">${esc(prov(id))}</span>`).join('')}</div><h3>Colonies</h3><div class="tags">${c.colonies.map(id => `<span class="tag">${esc(prov(id))}</span>`).join('')}</div></div>
      <div class="c-actions">${btn(`Take this seat`, { kind: 'primary', icon: 'check', sfx: 'confirm', key: 'Enter', cls: 'wide', attrs: 'id="primary"' })}</div></section>`;
}

function tileScreen() {
  const sw = [['Ink', '#1b2433', 'outlines, text'], ['Slate', '#263447', 'HUD chips'], ['Card', '#f4f7fb', 'cards'], ['Signal gold', '#ffc43d', 'the one primary'], ['War red', '#e5484d', 'war, danger'], ['Alliance teal', '#1fae96', 'treaties, offers'], ['Info blue', '#4c7dff', 'messages'], ['Muted', '#6b778a', 'secondary text']];
  const box = (t, body, cls = '') => `<section class="t-box ${cls}"><h3>${t}</h3>${body}</section>`;
  const sample = powers.rows.find(r => r.kind === 'alliance');
  return `<div class="tile-wrap sticker" data-region="tile"><header class="p-head big">${ic('star', 'p-ic')}<div><h2>Concept C · Modern minimal game</h2><p class="p-sub">Sticker objects: 2 px ink outline, hard offset shadow, radius by hierarchy. One gold primary per surface.</p></div></header>
  <div class="tile-grid">
    ${box('Palette', `<ul class="sw">${sw.map(([n, v, u]) => `<li><i style="background:${v}"></i><b>${n}</b><small>${v} · ${u}</small></li>`).join('')}</ul>`)}
    ${box('Type · Rubik', `<p class="ts d">Victory 44/800</p><p class="ts h">Panel heading 20/700</p><p class="ts u">Interface text 16/500, the size of every label.</p><p class="ts n num">1,532 · 08:00</p><p class="ts s">Small print 13/500 for times and hints</p>`)}
    ${box('Buttons', `<div class="stack">${btn('Propose alliance', { kind: 'primary', icon: 'alliance' })}<div class="row">${btn('Hover', { kind: 'primary', cls: 'is-hover' })}${btn('Pressed', { kind: 'primary', cls: 'is-down' })}</div>${btn('Secondary', { icon: 'eye' })}${btn('Declare war', { kind: 'danger', icon: 'war' })}${btn('Decline', { kind: 'ghost', icon: 'close' })}<div class="row">${round('trophy', 'Powers')}${round('chat', 'Chat', { badge: 2 })}${round('home', 'Home', { pressed: true })}${round('plus', 'Zoom', { cls: 'round-sm' })}</div></div>`)}
    ${box('Tabs · slider · toggle', `${seg([['world', 'World'], ['alliance', 'Alliance'], ['dm', 'Direct', 3]], 'dm', 'Tabs')}<div class="amount"><div class="amount-line"><span>Troops</span><output class="num">8<small> / 15</small></output></div>${slider(8, 15, 'Troops')}<div class="chips">${[25, 50, 75, 100].map(p => `<button type="button" class="chip-btn" aria-pressed="${p === 50}">${p}%</button>`).join('')}</div></div>${toggle(true, 'Voice input')}${toggle(false, 'Battle stingers')}`)}
    ${box('HUD chips', `<div class="stack">${pill('troops', '192', 'Troops')}${pill('land', '9<small>/79</small>', 'Provinces')}${ring(22, m.stats.threshold, 'Industry')}<div class="notes-demo">${notes.map(n => round(n.icon, n.label, { badge: n.badge, tone: `tone-${n.tone}` })).join('')}</div></div>`)}
    ${box('Leaderboard row', `<ol class="lb">${`<li class="lb-group" style="--team:${hex(powers.colors[sample.id])}"><div class="lb-row lb-total"><span class="rk">${sample.rank}</span><span class="swatch"></span><b class="nm">${esc(sample.name)}</b><span class="n">${sample.provinces}</span><span class="n">${fmt(sample.troops)}</span></div><ul>${sample.members.map(x => `<li class="lb-row lb-member"><span class="rk"></span>${std(x.id, 'std-xs')}<span class="nm">${esc(short(x.id))}</span><span class="bar"><i style="width:${pct(x.shareOfAlliance)}"></i></span><span class="n">${x.provinces}</span><span class="n">${fmt(x.troops)}</span></li>`).join('')}</ul></li>`}</ol>`)}
    ${box('Chat & diplomacy', `<ol class="thread">${m.dm('france').map(r => bubble(r)).join('')}</ol>`, 'wide2')}
    ${box('Toast', `<div class="toast">${ic('war', 'toast-ic')}<div><b>Battle at Low Countries</b><p>Your 8 troops arrive in 7 s.</p></div>${btn('Show', { kind: 'ghost' })}</div><div class="toast t-ally">${ic('alliance', 'toast-ic')}<div><b>Alliance formed</b><p>Pacific Pact is active.</p></div></div>`)}
    ${box('Dialog', `<div class="dialog"><b class="d-t">Declare war on Germany?</b><p>You will also be at war with the Ottoman Empire (Central Compact).</p><div class="row">${btn('Cancel', { kind: 'ghost' })}${btn('Declare war', { kind: 'danger', icon: 'war' })}</div></div>`)}
    ${box(`Icons · ${ICONS.length} original glyphs`, `<div class="icons">${ICONS.map(n => `<span${tip(n)}>${ic(n)}</span>`).join('')}</div>`, 'wide2')}
    ${box('Motion & sound', `<ul class="motion"><li><b>Press</b> offset shadow collapses 4→0 px in 90 ms, spring back 180 ms · <code>data-sfx="press"</code></li><li><b>Panels</b> slide 24 px from their anchored edge, 220 ms ease-out; never over another panel</li><li><b>Notifications</b> pop in the right lane (scale 0.6→1, spring); urgent ones pulse twice, then rest</li><li><b>Commit</b> the primary flashes gold→white once · <code>confirm / war / seal</code> cues</li><li>Reduced motion: fades only.</li></ul>`)}
  </div></div>`;
}

/* ── render + map ── */
shell.innerHTML = R[S]();
if (S === 'menu') { document.getElementById('scrim').hidden = false; }
const regionInsets = () => {
  const vw = innerWidth, vh = innerHeight, ins = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const e of shell.querySelectorAll('[data-region]')) {
    const r = e.getBoundingClientRect(); if (!r.width) continue;
    if (r.top < 90 && r.height < vh * .3) ins.top = Math.max(ins.top, r.bottom + 8);
    else if (r.width > vw * .8 && r.top > vh * .3) ins.bottom = Math.max(ins.bottom, vh - r.top + 8);
    else if (r.left < vw * .1 && r.right < vw * .62 && r.height > vh * .25) ins.left = Math.max(ins.left, r.right + 8);
    else if (r.right > vw * .9 && r.left > vw * .38 && r.height > vh * .2) ins.right = Math.max(ins.right, vw - r.left + 8);
    else if (r.top > vh * .5) ins.bottom = Math.max(ins.bottom, vh - r.top + 8);
  }
  return ins;
};
const mapOpts = {
  hud: { focus: 'world' }, offer: { focus: 'world' }, powers: { focus: 'world' }, chat: { focus: 'world' }, menu: { focus: 'world' }, tile: { focus: 'world' },
  title: { focus: 'world' }, report: { focus: 'world', state: replayState(m, m.review.duration) },
  province: { focus: 'england', width: phone() ? 150 : 260, selected: m.order.from, target: m.order.to, draft: { sources: [m.order.from], to: m.order.to, label: `${Math.round(m.order.free / 2)} · ${m.order.eta}s` } },
  country: { focus: 'rhineland', width: 330, mode: 'diplomacy' },
  faction: { focus: 'england', width: 260 },
  replay: { focus: 'world', state: replayState(m, RTICK) },
}[S];
const atlas = mountAtlas(document.getElementById('map'), m, { ...mapOpts, insets: regionInsets });
if (mapOpts.draft) setTimeout(() => atlas.setDraft(mapOpts.draft), 120);
if (S === 'country') atlas.setRelationFocus?.('germany');
if (S === 'faction') atlas.setRelationFocus?.(PICK);
if (['province'].includes(S)) document.body.classList.add('cursor-target');

/* ── light interaction (prototype) ── */
for (const f of document.querySelectorAll('form')) f.addEventListener('submit', e => e.preventDefault());
document.addEventListener('pointerdown', e => { const b = e.target.closest('[data-sfx]'); if (b) dispatchEvent(new CustomEvent('council:sfx', { detail: b.dataset.sfx })); });
for (const s of document.querySelectorAll('.seg')) s.addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (!b) return; for (const x of s.querySelectorAll('[role=tab]')) x.setAttribute('aria-selected', String(x === b)); });
for (const t of document.querySelectorAll('.toggle')) t.addEventListener('click', () => t.setAttribute('aria-checked', String(t.getAttribute('aria-checked') !== 'true')));
for (const c of document.querySelectorAll('.chips')) c.addEventListener('click', e => { const b = e.target.closest('.chip-btn'); if (!b) return; for (const x of c.querySelectorAll('.chip-btn')) x.setAttribute('aria-pressed', String(x === b));
  const k = parseInt(b.textContent) / 100, sl = c.parentElement.querySelector('.slider'), max = Number(sl.dataset.max), v = Math.max(1, Math.round(max * k)); setSlider(sl, v); });
function setSlider(sl, v) { const max = Number(sl.dataset.max); sl.style.setProperty('--k', v / max); sl.setAttribute('aria-valuenow', v); const out = sl.parentElement.querySelector('output'); if (out) out.innerHTML = `${v}<small> / ${max}</small>`;
  const p = document.getElementById('primary'); if (p && S === 'province') p.querySelector('span').textContent = p.querySelector('span').textContent.replace(/\d+$/, v); }
for (const sl of document.querySelectorAll('.slider')) {
  const set = x => { const r = sl.getBoundingClientRect(), max = Number(sl.dataset.max); setSlider(sl, Math.max(1, Math.round(max * Math.min(1, Math.max(0, (x - r.left) / r.width))))); };
  sl.addEventListener('pointerdown', e => { sl.setPointerCapture(e.pointerId); set(e.clientX); sl.onpointermove = ev => set(ev.clientX); });
  sl.addEventListener('pointerup', () => { sl.onpointermove = null; });
  sl.addEventListener('keydown', e => { const v = Number(sl.getAttribute('aria-valuenow')), max = Number(sl.dataset.max); if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setSlider(sl, Math.min(max, v + 1)); if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setSlider(sl, Math.max(1, v - 1)); });
}

reviewerNav('C · Modern', SCREENS.find(([id]) => id === S)[1]);
await document.fonts.ready; await new Promise(r => setTimeout(r, 180));
requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
