/** Concept B — Field Telegraph / Dispatch. Prototype over the real atlas and recorded public data.
 * The shell is the paperwork on a commander's desk: a telegraph tape, a dossier, an order-of-battle card,
 * a spike of telegrams. Player text (chat, alliance names, room names) goes through esc() only and never
 * into SVG markup. Buttons carry data-sfx hooks for the existing sound system.
 */
import { load, mountAtlas, mountComms, screen, reviewerNav, clock, esc, insignia, faction, replayState, historyTo } from '/concepts/kit/concept.js';

const m = await load();
const S = screen(), L = m.live, you = m.you;
const phone = matchMedia('(max-width: 699px)').matches;
const clean = new URLSearchParams(location.search).get('clean') === '1';
if (clean) document.body.classList.add('clean');
const desk = document.getElementById('desk');
const cname = id => m.names.country(id), short = id => faction(id).short;

/* ── Original pen-and-stamp icons (24×24, stroked). ── */
const PATHS = {
  bell: 'M6 17h12l-1.6-2.2V10a4.4 4.4 0 0 0-8.8 0v4.8L6 17Zm4.4 2.4a1.7 1.7 0 0 0 3.2 0M12 3.8v1.6',
  ledger: 'M5 3.5h11.5L19 6v14.5H5v-17Zm3 5h8M8 12h8M8 15.5h5',
  troops: 'M5 19.5L17.5 7m0 0 .8-3 1.4 1.4-2.2 1.6ZM19 19.5 6.5 7m0 0-.8-3-1.4 1.4 2.2 1.6ZM8.5 16.5 6 19m9.5-2.5L18 19',
  land: 'M3.5 19.5h17M5.5 19.5l4.5-6.5 3 3 2.5-3.5 3 7M10 13V4.5l5.5 2.2-5.5 2.1',
  industry: 'M4 20V11l4 3v-3l4 3v-3l4 3V5h3.5v15H4Zm3-3h2m3 0h2',
  clock: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 7v5.3l3.4 2',
  war: 'M4.5 4c5 3.8 9.3 8.8 13.7 15.2M19.5 4C14.4 7.8 10.2 12.8 5.8 19.2M3.8 17.2l3 3M20.2 17.2l-3 3',
  pact: 'M9 15l6-6M7.4 11.6 5.6 13.4a3.2 3.2 0 0 0 4.5 4.5l1.8-1.8m.2-7.9 1.8-1.8a3.2 3.2 0 0 1 4.5 4.5l-1.8 1.8',
  send: 'M3.5 12.2h14m-4.5-5 5 5-5 5',
  mic: 'M9 5.5a3 3 0 0 1 6 0v5.5a3 3 0 0 1-6 0V5.5ZM6 11a6 6 0 0 0 12 0M12 17v3.5m-3.2 0h6.4',
  compass: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm3.6 5.4-2.2 5-5 2.2 2.2-5 5-2.2Z',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  telegram: 'M3 6.5h18v11H3v-11Zm0 0 9 6.8 9-6.8M3 17.5l6.5-5.2m11.5 5.2-6.5-5.2',
  play: 'M8 5.2 19 12 8 18.8V5.2Z', pause: 'M8 5v14M16 5v14',
  back: 'M11.5 6.5 5 12l6.5 5.5v-11Zm7.5 0L12.5 12l6.5 5.5v-11Z', fwd: 'M12.5 6.5 19 12l-6.5 5.5v-11ZM5 6.5 11.5 12 5 17.5v-11Z',
  key: 'M8 14.6a4 4 0 1 1 3.1-6.5l9.4-.1v3h-2v2h-2.2v-2h-5.1A4 4 0 0 1 8 14.6Zm-1.2-4.1h.1',
  sound: 'M4 9.8h3.8L13 5.6v12.8l-5.2-4.2H4V9.8Zm12-1c1.6 1.8 1.6 4.6 0 6.4m2.4-8.8c3 3.2 3 8 0 11.2',
  link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1m2 3.6a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  leave: 'M14 4.5H6v15h8M10.5 12h10m-3.5-3.5 3.5 3.5-3.5 3.5',
  help: 'M9.2 9.2a2.9 2.9 0 1 1 4.3 2.5c-1 .6-1.5 1.2-1.5 2.4M12 17.6v.2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
  pen: 'M4 20l3.8-9.3L16.7 1.8a2.3 2.3 0 0 1 3.3 3.3L11.1 14 4 20Zm0 0 5.5-5.5',
  chart: 'M4 4v16h16M7 15l4-5 3 3 5-6',
  close: 'M6 6l12 12M18 6 6 18',
  map: 'M3.5 6 9 4l6 2 5.5-2v14L15 20l-6-2-5.5 2V6ZM9 4v14m6-12v14',
  seal: 'M12 3.2 14 5l2.8-.6.6 2.8 2.6 1.2-1 2.6 1 2.6-2.6 1.2-.6 2.8L14 19l-2 1.8L10 19l-2.8.6-.6-2.8L4 15.6l1-2.6-1-2.6 2.6-1.2.6-2.8L10 5l2-1.8ZM12 8.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
  voice: 'M4 12h1.5M7.5 8v8M11 5v14M14.5 8.5v7M18 10.5v3M21 12h-1',
  flag: 'M5 21V3.5m0 1h12.5l-2.8 4 2.8 4H5',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATHS[name] || PATHS.seal}"/></svg>`;
/** A wax seal: an irregular blob with the country's original insignia embossed (decorative). */
const seal = (id, tone = 'red') => `<span class="seal seal-${tone}" aria-hidden="true"><svg viewBox="0 0 48 48"><path class="wax" d="M24 2.5c3.6.2 5.2 2.6 8.3 3.2 3.4.7 6.6 1.3 8 4.6 1.3 3-.4 5.6.6 8.8 1 3.4 3.7 5.3 2.6 8.8-1 3.1-4.3 3.7-5.9 6.6-1.7 3-1.5 6.4-4.6 7.9-3 1.4-5.6-.7-9-.5-3.5.1-6 2.6-9.2 1.3-3-1.2-3.2-4.6-5.4-7-2.3-2.5-5.8-3.3-6.6-6.6-.8-3.1 1.6-5.5 1.8-8.8.2-3.3-1.4-6.3.6-9 2-2.8 5.6-2.4 8.7-4 3-1.6 5.7-5.9 10.1-5.3Z"/><circle class="ring" cx="24" cy="24" r="14.5"/></svg>${insignia(id)}</span>`;
const std = (id, cls = '') => `<span class="std ${cls}">${insignia(id)}</span>`;
const sfx = kind => `data-sfx="${kind}"`;

/* ── Derived public facts (all from the recorded observation). ── */
const board = m.powers();
const flatRows = rows => rows.flatMap(r => r.members ? r.members : [r]);
const statOf = id => flatRows(board.rows).find(r => r.id === id) || { provinces: 0, troops: 0 };
const blocOf = (id, state = L) => { const s = state.sides.find(x => x.members.includes(id)); return s && !String(s.id).startsWith('solo:') ? s : null; };
const rowLabel = r => r.kind === 'alliance' ? r.name : cname(r.id);
const leaderSide = [...L.sides].sort((a, b) => b.economy - a.economy)[0];
const sideLabel = s => String(s.id).startsWith('solo:') ? cname(s.members[0]) : s.name;
const victoryLine = `Victory at ${L.economyThreshold} industry · ${sideLabel(leaderSide)} leads with ${leaderSide.economy}`;
const enemies = m.relations.enemies || [];

/* ── Shared components ── */
function tape({ mode = 'live', tick = L.tick } = {}) {
  if (mode === 'replay') return `<header class="tape" data-region="tape">
    <button class="tape-back pencil" type="button" ${sfx('press')}>${ic('back')}<span>Protocol</span></button>
    <div class="tape-title"><b class="fell">Replay · ${esc(m.review.name)}</b><small>${esc(winnerName())} prevailed</small></div>
    <div class="tape-clock"><b>${clock(tick)}</b><small>of ${clock(m.review.duration)}</small></div>
  </header>`;
  return `<header class="tape" data-region="tape">
    <button class="tape-std" type="button" ${sfx('press')} aria-label="Your country: British Empire">${std(you)}<span class="tape-name"><b class="fell"><span class="long">${esc(cname(you))}</span><span class="short">${esc(short(you))}</span></b><small>Independent · at war with ${enemies.length}</small></span></button>
    <div class="tape-clock" title="Match clock"><b>${clock(L.tick)}</b><small>of ${clock(L.rules.duration)}</small></div>
    <p class="tape-wire">${esc(victoryLine)}</p>
    <dl class="tape-forces">
      <div title="Troops: garrisons and armies">${ic('troops')}<dt>Troops</dt><dd>${m.stats.troops}</dd></div>
      <div title="Provinces held">${ic('land')}<dt>Land</dt><dd>${m.stats.land}<small>/${m.stats.provinces}</small></dd></div>
      <div class="hide-phone" title="Industry">${ic('industry')}<dt>Industry</dt><dd>${m.stats.industry}</dd></div>
    </dl>
    <button class="tape-bell" id="cx-button" type="button"></button>
    <button class="tape-menu" type="button" ${sfx('press')} aria-label="Standing orders (menu)">${ic('ledger')}</button>
  </header>`;
}
function winnerName() { const w = m.review.alliances.find(a => a.won); return w ? w.name : 'No one'; }

/** Order of battle: the one teams leaderboard (nested alliance totals) + war fronts. */
function orderOfBattle(state = L, viewer = you, { title = 'Order of battle', collapsed = false, full = false, sub = 'land · troops' } = {}) {
  const b = m.powers(state, viewer), total = state.provinces.length;
  const mark = r => r.relation === 'enemy' ? `<span class="rel war" title="At war with you">${ic('war')}</span>` : r.relation === 'ally' ? `<span class="rel ally" title="Allied with you">${ic('pact')}</span>` : r.you ? '<span class="rel you">you</span>' : '<span class="rel"></span>';
  const rows = b.rows.map(r => r.members ? `
    <li class="ob-group${r.forming ? ' forming' : ''}${r.you ? ' mine' : ''}" style="--team:${b.colors[r.id] || '#a5a28c'}"><span class="rk">${r.rank}</span><i class="sw" aria-hidden="true"></i><b class="nm">${esc(r.name)}</b>${r.forming ? '<small class="forming-tag">forming</small>' : ''}<span class="lead" aria-hidden="true"></span>${mark(r)}<span class="n" title="${Math.round(r.share * 100)}% of all provinces">${r.provinces}</span><span class="n">${r.troops}</span></li>
    ${r.members.map(c => `<li class="ob-member${c.you ? ' mine' : ''}${c.eliminated ? ' fallen' : ''}" style="--team:${b.colors[r.id] || '#a5a28c'}"><span class="rk"></span>${std(c.id, 'mini')}<span class="nm">${esc(short(c.id))}</span><span class="bar" title="${Math.round(c.shareOfAlliance * 100)}% of the alliance's troops"><i style="width:${Math.round(c.shareOfAlliance * 100)}%"></i></span><span class="lead" aria-hidden="true"></span>${mark(c)}<span class="n">${c.provinces}</span><span class="n">${c.troops}</span></li>`).join('')}`
    : `<li class="ob-solo${r.you ? ' mine' : ''}"><span class="rk">${r.rank}</span>${std(r.id, 'mini')}<b class="nm">${esc(short(r.id))}</b><span class="lead" aria-hidden="true"></span>${mark(r)}<span class="n" title="${Math.round(r.share * 100)}% of all provinces">${r.provinces}</span><span class="n">${r.troops}</span></li>`).join('');
  const sideName = s => s.name ?? cname(s.countries[0]);
  const fronts = b.fronts.map(f => { const mine = f.pairs.some(p => p.includes(viewer)); return `<li class="${mine ? 'mine' : ''}"><span>${esc(sideName(f.sides[0]))}</span>${ic('war', 'x')}<span>${esc(sideName(f.sides[1]))}</span></li>`; }).join('');
  return `<section class="oob${collapsed ? ' collapsed' : ''}${full ? ' full' : ''}" data-region="order-of-battle" aria-label="${esc(title)}">
    <header class="drawer-head"><h2 class="fell">${esc(title)}</h2><span class="sub">${esc(sub)}</span><button class="caret" type="button" aria-expanded="${!collapsed}" ${sfx('press')} aria-label="${collapsed ? 'Open' : 'Fold'} the order of battle">${collapsed ? '▸' : '▾'}</button></header>
    <p class="oob-peek">${b.rows.slice(0, 4).map(r => `<span>${r.rank}. ${esc(rowLabel(r))} <b>${r.troops}</b></span>`).join('')}</p>${collapsed ? '' : `
    <div class="ob-cols" aria-hidden="true"><span>#</span><span>Power</span><span></span><span>Land</span><span>Troops</span></div>
    <ol class="ob-rows">${rows}</ol>
    <h3 class="wars-head">${ic('war')} Wars <small>${b.fronts.length} fronts · ${total} provinces</small></h3>
    <ul class="ob-wars">${fronts || '<li class="none">No wars declared.</li>'}</ul>`}
  </section>`;
}

/** One row of the spike: a printed bulletin, a typed telegram (player text), or a diplomatic form. */
function slip(r, { actions = true } = {}) {
  const t = `<time>${clock(r.tick)}</time>`;
  if (r.kind === 'chat') {
    const mine = r.from === you, dm = r.channel === 'dm';
    return `<li class="slip wire${mine ? ' mine' : ''}${dm ? ' dm' : ''}"><header>${std(r.from, 'mini')}<b>${esc(mine ? 'You' : cname(r.from))}</b>${dm ? `<span class="chan">${mine ? 'to Paris' : 'private'}</span>` : '<span class="chan">world</span>'}${t}</header><p>${esc(r.text)}</p></li>`;
  }
  if (r.kind === 'system') {
    const offer = r.system === 'offer' && r.candidate !== undefined || r.system === 'offer';
    return `<li class="slip form ${esc(r.tone)}"><header>${ic(r.tone === 'war' ? 'war' : 'seal')}<b>${esc(r.title)}</b>${t}</header><p>${esc(r.detail)}</p>${offer && actions && m.offer ? `<div class="slip-acts"><button class="seal-btn small" type="button" ${sfx('seal')}>${seal('france')}<span>Accept</span></button><button class="pencil" type="button" ${sfx('press')}>Decline</button></div>` : ''}</li>`;
  }
  return `<li class="slip bulletin ${esc(r.tone || '')}"><header>${ic(r.tone === 'war' ? 'war' : r.tone === 'alliance' ? 'pact' : r.tone === 'victory' ? 'flag' : r.tone === 'industry' ? 'industry' : 'telegram')}<b>${esc(r.title)}</b>${t}</header><p>${esc(r.detail)}</p></li>`;
}
function spike({ tab = 'all', collapsed = false, rows = null, title = 'Telegrams', composer = true, to = 'everyone' } = {}) {
  const dm = m.dm('france');
  const all = [...m.world, ...dm.filter(r => !m.world.some(w => w.id === r.id))].sort((a, b) => a.id - b.id);
  const list = rows ?? (tab === 'world' ? m.world : tab === 'dm' ? dm : tab === 'alliance' ? [] : all);
  const tabs = [['all', 'All'], ['world', 'World'], ['dm', 'Paris', dm.length], ['alliance', 'Alliance']];
  return `<section class="spike${collapsed ? ' collapsed' : ''}" data-region="spike" aria-label="${esc(title)}">
    <nav class="folder-tabs" aria-label="Show">${rows ? `<h2 class="fell">${esc(title)}</h2>` : tabs.map(([id, label, n]) => `<button type="button" aria-pressed="${id === tab}" ${sfx('press')}>${label}${n ? `<i>${n}</i>` : ''}</button>`).join('')}</nav>
    ${collapsed ? '' : `<ol class="slips">${list.length ? list.map(r => slip(r)).join('') : `<li class="empty"><p class="fell">No alliance wire.</p><p>You are independent. Open a power's dossier and propose an alliance to get a private line to your allies.</p></li>`}</ol>
    ${composer ? `<form class="blank"><label for="wire-text">To: <b>${esc(to)}</b></label><input id="wire-text" maxlength="500" autocomplete="off" placeholder="Write a telegram…"><button class="key mic" type="button" ${sfx('press')} aria-label="Hold to dictate">${ic('mic')}</button><button class="stamp violet small" type="button" ${sfx('stamp')}>Send</button></form>` : ''}`}
  </section>`;
}
function camera() {
  return `<div class="camera" data-region="camera" role="group" aria-label="Map view"><button type="button" ${sfx('press')} aria-label="Home: my country">${ic('compass')}</button>${phone ? '' : `<button type="button" ${sfx('press')} aria-label="Zoom in">${ic('plus')}</button><button type="button" ${sfx('press')} aria-label="Zoom out">${ic('minus')}</button>`}<button type="button" ${sfx('press')} aria-label="Expand map">${ic('expand')}</button></div>`;
}
function standardsStrip() {
  const others = flatRows(board.rows).filter(r => r.id !== you);
  return `<nav class="strip" data-region="standards" aria-label="Powers: open a dossier">${others.map(r => `<button type="button" class="${r.relation || ''}" ${sfx('press')} aria-label="${esc(cname(r.id))}${r.relation === 'enemy' ? ', at war with you' : ''}">${std(r.id, 'mini')}<span>${esc(short(r.id).split(' ')[0])}</span>${r.relation === 'enemy' ? ic('war', 'x') : ''}</button>`).join('')}</nav>`;
}
function deskTabs(active) {
  const tabs = [['map', 'Map', 'map'], ['powers', 'Order of battle', 'troops'], ['menu', 'Standing orders', 'ledger']];
  return `<nav class="desk-tabs" data-region="tabs" aria-label="Desk">${tabs.map(([id, label, i]) => `<button type="button" aria-pressed="${id === active}" ${sfx('press')}>${ic(i)}<span>${label}</span></button>`).join('')}</nav>`;
}

/* ── Dossiers (the context card) ── */
function provinceDossier() {
  const o = m.order, p = L.provinces.find(x => x.id === o.to), free = o.free - 1, amount = Math.round(free * .5), travel = (o.eta ?? 0) + 1;
  const marching = L.armies.filter(a => a.country === you && a.to === o.to);
  const budget = L.commandBudget?.remaining ?? 0;
  return `<aside class="dossier" data-region="dossier" aria-labelledby="dossier-title"><div class="folder">
    <div class="folder-tab">Field order</div>
    <header class="dossier-head"><span class="std-plain" aria-hidden="true">${ic('flag')}</span><div><h2 id="dossier-title" class="fell">${esc(m.names.province(o.to))}</h2><p>Unclaimed · ${p.troops} defenders · industry ${p.development}</p></div><button class="close" type="button" ${sfx('press')} aria-label="Close">${ic('close')}</button></header>
    <div class="dossier-body">
      <p class="typed"><b>Unclaimed.</b> No declaration needed.</p>
      <dl class="facts">
        <div><dt>From</dt><dd>${std(you, 'mini')} ${esc(m.names.province(o.from))} <small>${o.free} troops, ${free} free</small></dd></div>
        ${marching.map(a => `<div><dt>Marching</dt><dd>${a.amount} troops arrive at ${clock(a.arrivesAt)}</dd></div>`).join('')}
        <div><dt>Orders</dt><dd>${budget} of ${L.rules.orderLimit} left this window</dd></div>
      </dl>
      <p class="hint">Tap another of your provinces beside ${esc(m.names.province(o.to))} to attack together.</p>
    </div>
    <footer class="dossier-foot">
      <div class="amount"><label for="amt">Troops</label><output for="amt">${amount} <small>of ${free}</small></output></div>
      <input id="amt" class="slide" type="range" min="1" max="${free}" value="${amount}" style="--pct:${(amount - 1) / (free - 1) * 100}%" aria-describedby="order-preview">
      <div class="keys" role="group" aria-label="Share of free troops">${[25, 50, 75, 100].map(n => `<button type="button" class="key" aria-pressed="${n === 50}" ${sfx('type')}>${n}%</button>`).join('')}</div>
      <p class="preview" id="order-preview">${amount} vs ${p.troops} defenders · arrives in ${travel}s (${clock(L.tick + travel)})</p>
      <button class="stamp violet primary" type="button" ${sfx('stamp')}>${ic('send')}<span>Send ${amount} → ${esc(m.names.province(o.to))}</span></button>
    </footer>
  </div></aside>`;
}
function countryDossier(id = 'germany') {
  const s = statOf(id), bloc = blocOf(id), members = bloc ? bloc.members : [id];
  const blocRow = bloc ? board.rows.find(r => r.id === bloc.id) : null;
  const theirWars = (L.wars || []).map(k => k.split(':')).filter(p => p.includes(id)).map(p => p.find(x => x !== id));
  const roster = [...members, you], share = (100 * L.players.length / roster.length).toFixed(1);
  const partners = members.filter(x => x !== id);
  return `<aside class="dossier" data-region="dossier" aria-labelledby="dossier-title"><div class="folder">
    <div class="folder-tab">Dossier · ${esc(short(id))}</div>
    <header class="dossier-head">${std(id, 'big')}<div><h2 id="dossier-title" class="fell">${esc(cname(id))}</h2><p>${bloc ? `${esc(bloc.name)} · with ${partners.map(x => esc(cname(x))).join(', ')}` : 'Independent'}</p></div><button class="close" type="button" ${sfx('press')} aria-label="Close">${ic('close')}</button></header>
    <div class="dossier-body">
      <p class="relation-stamp neutral" role="status"><span>Neutral</span></p>
      <dl class="facts grid">
        <div><dt>Troops</dt><dd>${s.troops}</dd></div><div><dt>Provinces</dt><dd>${s.provinces}</dd></div>
        ${blocRow ? `<div class="wide"><dt>Bloc</dt><dd>${esc(bloc.name)}: ${blocRow.troops} troops, ${blocRow.provinces} provinces</dd></div>` : ''}
        <div class="wide"><dt>At war with</dt><dd>${theirWars.length ? theirWars.map(x => esc(short(x))).join(', ') : 'no one'}</dd></div>
      </dl>
      <p class="terms"><b>Proposed terms.</b> You would join ${bloc ? esc(bloc.name) : 'a new alliance'}: ${roster.map(x => esc(short(x))).join(' + ')}. Maximum share ${share} points each; forms ${L.rules.notice}s after every member signs.</p>
      <p class="thread-empty">No telegrams with Berlin yet. <button class="pencil" type="button" ${sfx('press')}>${ic('pen')}Write to Berlin</button></p>
    </div>
    <footer class="dossier-foot two">
      <button class="stamp red outline" type="button" ${sfx('war')} title="Also puts you at war with ${partners.map(x => esc(cname(x))).join(', ') || 'no one else'}">${ic('war')}<span>Declare war</span></button>
      <button class="stamp violet primary" type="button" ${sfx('stamp')}>${ic('pact')}<span>Propose alliance</span></button>
    </footer>
  </div></aside>`;
}

/* ── Incoming telegram (alliance offer) ── */
function offerTelegram() {
  const q = m.offer, from = q.creator, share = (100 * L.players.length / q.roster.length).toFixed(1);
  const last = m.dm(from).filter(r => r.kind === 'chat' && r.from === from).at(-1);
  return `<div class="notice-lane" data-region="notice"><article class="telegram incoming" role="alertdialog" aria-labelledby="offer-title">
    <header class="form-head"><span>Imperial telegraph · form A-7</span><time>${clock(L.tick - 2)}</time></header>
    <p class="wire-line" aria-hidden="true">${esc(short(from).toUpperCase())} PROPOSES ${esc(q.name.toUpperCase())} STOP</p>
    <div class="tg-body">${seal(from)}<div>
      <h2 id="offer-title" class="fell">Alliance offer from ${esc(cname(from))}</h2>
      <p>${esc(cname(from))} invites you into <b>${esc(q.name)}</b>: ${q.roster.map(x => esc(cname(x))).join(' + ')}.</p>
      <p class="small">Maximum share ${share} points each · open until ${clock(q.expiresAt)} · forms ${L.rules.notice}s after you sign.</p>
      ${last ? `<blockquote><span>Paris, ${clock(last.tick)}:</span> ${esc(last.text)}</blockquote>` : ''}
    </div></div>
    <footer><button class="seal-btn" type="button" ${sfx('seal')}>${seal(you, 'violet')}<span>Accept &amp; seal</span></button><button class="pencil" type="button" ${sfx('press')}>Decline</button><button class="pencil" type="button" ${sfx('press')}>Open dossier</button></footer>
  </article></div>`;
}

/* ── Standing orders (menu) ── */
function ledger() {
  const blocs = L.sides.filter(s => !String(s.id).startsWith('solo:'));
  return `<section class="ledger" data-region="menu" aria-labelledby="ledger-title">
    <header class="drawer-head"><h2 id="ledger-title" class="fell">Standing orders</h2><span class="sub">${esc(L.name)} · standard pace</span><button class="caret" type="button" ${sfx('press')} aria-label="Close">${ic('close')}</button></header>
    <div class="ledger-body">
      <h3>Map</h3>
      <div class="keys wide" role="group" aria-label="Map view"><button class="key" type="button" aria-pressed="true" ${sfx('type')}>World</button><button class="key" type="button" aria-pressed="false" ${sfx('type')}>Europe</button><button class="key" type="button" aria-pressed="false" ${sfx('type')}>Home</button><button class="key" type="button" aria-pressed="false" ${sfx('type')} aria-keyshortcuts="M">Relations</button></div>
      <h3>Map key</h3>
      <ul class="map-key">${blocs.map(s => `<li><i style="--team:${m.colors[s.id]}"></i>${esc(s.name)}</li>`).join('')}<li><i class="front"></i>War front</li><li><i class="threat"></i>Province under threat</li></ul>
      <h3>Sound</h3>
      <div class="setting"><label for="vol-fx">Effects</label><input id="vol-fx" class="slide" type="range" min="0" max="100" value="70" style="--pct:70%"></div>
      <div class="setting"><label for="vol-music">Music</label><input id="vol-music" class="slide" type="range" min="0" max="100" value="35" style="--pct:35%"></div>
      <h3>Voice</h3>
      <div class="setting toggle"><span>Dictate telegrams with the mic key</span><button class="key" type="button" role="switch" aria-checked="true" ${sfx('type')}>On</button></div>
      <h3>Controls</h3>
      <dl class="controls"><div><dt>Drag</dt><dd>from your province to a neighbour to send troops</dd></div><div><dt>Enter / Esc</dt><dd>send / cancel an order</dd></div><div><dt>C · Q · E</dt><dd>home · zoom in · zoom out</dd></div><div><dt>M · J</dt><dd>relations colours · war log</dd></div></dl>
      <h3>Room</h3>
      <div class="ledger-acts"><button class="pencil" type="button" ${sfx('press')}>${ic('link')}Copy room link</button><button class="pencil" type="button" ${sfx('press')}>${ic('help')}Show the three tips</button><button class="pencil" type="button" ${sfx('press')}>${ic('telegram')}All rooms</button><button class="pencil danger" type="button" ${sfx('press')}>${ic('leave')}Leave the table</button></div>
    </div>
  </section>`;
}

/* ── Map screens: a strict grid; the atlas is full-bleed underneath, framed by the desk. ── */
function mapScreen({ cls = '', parts, atlas = {} }) {
  desk.className = `desk map-screen ${phone ? 'phone' : 'wide'} ${cls}`;
  desk.innerHTML = `<svg id="map" viewBox="0 0 1280 680" role="group" aria-label="World province map"></svg><div class="well" aria-hidden="true"></div>${parts.join('')}`;
  const well = desk.querySelector('.well');
  // Camera insets = the framed well, minus a dossier lying on the map (desktop) so targets stay beside it.
  const insets = () => { const r = well.getBoundingClientRect(), d = !phone && desk.querySelector('.dossier')?.getBoundingClientRect();
    return { top: r.top + 6, left: Math.max(r.left, d ? d.right : 0) + 6, right: innerWidth - r.right + 6, bottom: innerHeight - r.bottom + 6 }; };
  return mountAtlas(desk.querySelector('#map'), m, { insets, ...atlas });
}

/** The shared comms model (kit/comms.js) in B's regions: the in-tray key on the tape, one toast slot at the
 * top of the map well, and the Messages spike in the right column (docked list on desktop, sheet on phones). */
const commsParts = () => ['<div class="toasts" id="cx-toasts" data-region="toasts"></div>', '<section class="comms" id="cx-panel" data-region="comms" style="--cx-composer-h:112px"></section>'];
const inMatch = (cls, desktop, phoneParts, atlas) => {
  const a = mapScreen({ cls, parts: phone ? [tape(), standardsStrip(), ...phoneParts, ...commsParts()] : [tape(), ...desktop, ...commsParts(), camera()], atlas });
  return a;
};
const screens = {
  hud() { inMatch('idle', [orderOfBattle()], [camera(), deskTabs('map')], { focus: 'world' }); },
  walk() { inMatch('idle', [orderOfBattle()], [camera(), deskTabs('map')], { focus: 'world' }); },
  offer() { inMatch('idle', [orderOfBattle()], [camera(), deskTabs('map')], { focus: 'world' }); },
  chat() { inMatch('idle', [orderOfBattle()], [camera(), deskTabs('map')], { focus: 'world' }); },
  province() {
    const o = m.order, amount = Math.round((o.free - 1) * .5);
    const draft = { sources: [o.from], to: o.to, label: `${amount} · ${(o.eta ?? 0) + 1}s` };
    const a = inMatch('has-dossier', [provinceDossier(), orderOfBattle()], [provinceDossier(), camera()], { selected: o.from, target: o.to, draft, focus: o.to, width: phone ? 150 : 330 });
    // The draft label is sized for the zoom at paint time: repaint it once the camera has framed the target.
    requestAnimationFrame(() => requestAnimationFrame(() => a.setDraft(draft)));
    desk.querySelector('#map').classList.add('targeting');
  },
  country() {
    const a = inMatch('has-dossier', [countryDossier(), orderOfBattle()], [countryDossier(), camera()], { focus: 'brandenburg', width: phone ? 260 : 520 });
    a.setRelationFocus?.('germany');
  },
  menu() { inMatch('focus-menu', [ledger()], [ledger(), deskTabs('menu')], { focus: 'world' }); },
  powers() { inMatch('focus-oob', [orderOfBattle(L, you, { full: true })], [orderOfBattle(L, you, { full: true }), deskTabs('powers')], { focus: 'world' }); },
  replay() {
    const tick = 300, state = replayState(m, tick), history = historyTo(m, tick).slice(-40);
    const rows = history.map((h, i) => ({ kind: 'headline', id: i, tick: h.tick, title: h.title, detail: h.detail, tone: h.tone }));
    const oob = orderOfBattle(state, null, { title: `Standings at ${clock(tick)}`, sub: 'land · troops' });
    const hist = spike({ rows, title: `Dispatches to ${clock(tick)}`, composer: false });
    mapScreen({ cls: 'replay', parts: phone ? [tape({ mode: 'replay', tick }), oob, timeline(tick)] : [tape({ mode: 'replay', tick }), oob, hist, camera(), timeline(tick)], atlas: { state, focus: 'world' } });
  },
  title: titleScreen, faction: factionScreen, report: reportScreen, tile: tileScreen,
};

/* ── Replay tape: punched holes mark public events; the reader head is the scrubber. ── */
function timeline(tick) {
  const d = m.review.duration, ev = m.review.events.filter(e => ['alliance_activated', 'dominance', 'dominance_broken', 'finished', 'capture'].includes(e.type));
  const last = historyTo(m, tick).at(-1);
  const holes = ev.map(e => `<i class="hole ${e.type === 'capture' ? 'cap' : e.type.startsWith('dominance') || e.type === 'finished' ? 'vic' : 'ally'}" style="left:${(e.tick / d * 100).toFixed(2)}%"></i>`).join('');
  const marks = [0, 120, 240, 360, 480].map(t => `<span style="left:${t / d * 100}%">${clock(t)}</span>`).join('') + `<span class="end">${clock(d)}</span>`;
  return `<footer class="reel" data-region="timeline">
    <div class="reel-keys" role="group" aria-label="Playback"><button class="key" type="button" ${sfx('type')} aria-label="Back 10 seconds">${ic('back')}</button><button class="key play" type="button" ${sfx('type')} aria-label="Play">${ic('play')}</button><button class="key" type="button" ${sfx('type')} aria-label="Forward 10 seconds">${ic('fwd')}</button><button class="key speed" type="button" ${sfx('type')} aria-label="Speed 16 times">16×</button></div>
    <div class="reel-tape"><div class="tape-strip" role="slider" tabindex="0" aria-label="Replay position" aria-valuemin="0" aria-valuemax="${d}" aria-valuenow="${tick}" aria-valuetext="${clock(tick)} of ${clock(d)}" style="--at:${(tick / d * 100).toFixed(2)}%"><span class="played"></span>${holes}<span class="head" aria-hidden="true"></span></div><div class="reel-marks" aria-hidden="true">${marks}</div></div>
    <p class="reel-caption">${last ? `<time>${clock(last.tick)}</time> ${esc(last.title)}: ${esc(last.detail)}` : ''}</p>
  </footer>`;
}

/* ── Title: the register of councils on the desk, over the real map. ── */
function titleScreen() {
  desk.className = `desk plain title-screen ${phone ? 'phone' : 'wide'}`;
  const running = L, done = m.review;
  desk.innerHTML = `<svg id="map" viewBox="0 0 1280 680" aria-hidden="true"></svg><div class="dim" aria-hidden="true"></div>
  <header class="letterhead" data-region="letterhead"><p class="lh-rule" aria-hidden="true">Est. 1910 · by wire and by treaty</p><h1 class="fell">Council of Iron</h1><p>A real-time game of empires and allegiances. Eight powers, humans and agents, one map.</p><p class="signed">${std(you, 'mini')} Signed in as <b>${esc(cname(you))}</b> <button class="pencil" type="button" ${sfx('press')}>Change</button></p></header>
  <section class="register" data-region="register" aria-labelledby="reg-title"><header class="drawer-head"><h2 id="reg-title" class="fell">Register of councils</h2><span class="sub">Watch, resume or take a seat</span></header>
    <ol class="reg-rows">
      <li><span class="reg-stamp live">In session</span><div><b>${esc(running.name)}</b><small>${clock(running.tick)} of ${clock(running.rules.duration)} · 8 seats · 3 alliances, 8 wars</small></div><button class="stamp violet small" type="button" ${sfx('stamp')}>Resume seat</button></li>
      <li><span class="reg-stamp done">Concluded</span><div><b>${esc(done.name)}</b><small>${esc(winnerName())} prevailed at ${clock(done.duration)}</small></div><button class="pencil" type="button" ${sfx('press')}>Read protocol</button></li>
      <li><span class="reg-stamp open">Assembling</span><div><b>The evening council</b><small>3 seats open · standard pace</small></div><button class="pencil" type="button" ${sfx('press')}>Take a seat</button></li>
    </ol></section>
  <form class="telegram open-form" data-region="create" aria-labelledby="create-title"><header class="form-head"><span>Imperial telegraph · form C-1</span><span>Open a council</span></header>
    <h2 id="create-title" class="fell">Open a council</h2>
    <label class="field f-name"><span>Your name</span><input value="Chris" maxlength="40"></label>
    <label class="field"><span>Room name</span><input value="The evening council" maxlength="80"></label>
    <div class="field"><span>Pace</span><div class="keys" role="group" aria-label="Pace"><button class="key" type="button" aria-pressed="true" ${sfx('type')}>Standard · 30 min</button><button class="key" type="button" aria-pressed="false" ${sfx('type')}>Quick · 5 min</button></div></div>
    <p class="small">Invite by room link, seat an agent, or fill empty chairs with computer generals.</p>
    <button class="stamp violet primary" type="submit" ${sfx('stamp')}>${ic('telegram')}<span>Open the council</span></button>
  </form>`;
  mountAtlas(desk.querySelector('#map'), m, { focus: 'world', insets: () => ({}) });
}

/* ── Faction selection: dossiers clipped to a board. ── */
function factionScreen() {
  const pick = 'britain', c = m.map.countries.find(x => x.id === pick);
  desk.className = `desk map-screen faction-screen ${phone ? 'phone' : 'wide'}`;
  const cards = m.map.countries.map(k => { const p = L.players.find(x => x.id === k.id), open = k.id === pick;
    return `<button type="button" class="index-card${open ? ' chosen' : ''}" aria-pressed="${open}" ${sfx('press')}>${std(k.id)}<b class="fell">${esc(short(k.id))}</b><small>${k.start.length} holdings</small><span class="seat">${open ? 'Open seat' : p?.kind === 'agent' ? 'Agent seated' : 'Seated'}</span></button>`; }).join('');
  const names = ids => ids.map(id => esc(m.names.province(id))).join(', ');
  desk.innerHTML = `<svg id="map" viewBox="0 0 1280 680" role="group" aria-label="Holdings map"></svg><div class="well" aria-hidden="true"></div>
  <header class="tape" data-region="tape"><div class="tape-title"><b class="fell">${esc(L.name)}</b><small>Choose your country · open seats close at the start</small></div><button class="pencil" type="button" ${sfx('press')}>${ic('link')}<span>Copy invite link</span></button></header>
  <aside class="dossier" data-region="dossier" aria-labelledby="dossier-title"><div class="folder"><div class="folder-tab">Dossier · candidate</div>
    <header class="dossier-head">${std(pick, 'big')}<div><h2 id="dossier-title" class="fell">${esc(c.name)}</h2><p>${c.start.length} holdings · ${c.homeland.length} homeland, ${(c.colonies || []).length} colonies</p></div></header>
    <div class="dossier-body"><dl class="facts"><div><dt>Homeland</dt><dd>${names(c.homeland)}</dd></div><div><dt>Colonies</dt><dd>${names(c.colonies || [])}</dd></div><div><dt>Seat</dt><dd>Open. Humans and agents play by the same rules.</dd></div></dl>
      <p class="hint">Unequal strengths, shared rules: a strong homeland draws enemies; colonies are far to reinforce.</p></div>
    <footer class="dossier-foot"><label class="field"><span>Commander</span><input value="Chris" maxlength="40"></label><button class="stamp violet primary" type="button" ${sfx('stamp')}>${ic('seal')}<span>Take this seat</span></button></footer></div></aside>
  <section class="board" data-region="board" aria-label="Choose an empire">${cards}</section>`;
  const well = desk.querySelector('.well');
  const a = mountAtlas(desk.querySelector('#map'), m, { focus: 'world', insets: () => { const r = well.getBoundingClientRect(), d = desk.querySelector('.dossier').getBoundingClientRect(), bd = desk.querySelector('.board').getBoundingClientRect();
    return phone ? { top: r.top, left: 0, right: 0, bottom: innerHeight - r.bottom } : { top: r.top, left: d.right, right: innerWidth - r.right, bottom: innerHeight - bd.top }; } });
  a.setRelationFocus?.(pick);
}

/* ── After-action report: the Protocol of the Conference. ── */
function reportScreen() {
  const r = m.review, win = r.alliances.find(a => a.won), provinces = m.map.provinces.length;
  const alliances = [...r.alliances].sort((a, b) => b.prestige - a.prestige);
  const tone = a => a.won ? 'red' : 'grey';
  const sign = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
  const seals = alliances.map(a => `<figure class="seal-card${a.won ? ' won' : ''}">${seal(a.members[0], tone(a))}<figcaption><b class="fell">${esc(a.name)}</b><span>${a.members.map(x => esc(short(x))).join(' · ')}</span><strong>${sign(a.prestige)}</strong><small>alliance Prestige</small></figcaption></figure>`).join('');
  const table = alliances.map(a => `<tbody><tr class="group"><th colspan="4" scope="rowgroup">${esc(a.name)}${a.won ? ' <span class="won-tag">victors</span>' : ''}</th></tr>${a.members.map(id => { const p = r.players.find(x => x.country === id); return `<tr><th scope="row">${std(id, 'mini')} ${esc(cname(id))}</th><td>${p.land}</td><td>${p.troops}</td><td class="${p.prestige >= 0 ? 'plus' : 'minus'}">${sign(p.prestige)}</td></tr>`; }).join('')}</tbody>`).join('');
  const highlights = historyTo(m, r.duration).filter(h => ['alliance', 'victory'].includes(h.tone) || h.type === 'dominance_broken').slice(0, 9);
  const reason = r.outcome.reason === 'domination' ? `held 60% of active industry for ${r.rules.hold} seconds` : r.outcome.reason;
  desk.className = `desk plain report-screen ${phone ? 'phone' : 'wide'}`;
  desk.innerHTML = `<svg id="map" viewBox="0 0 1280 680" aria-hidden="true"></svg><div class="dim" aria-hidden="true"></div>
  <article class="protocol" data-region="protocol" aria-labelledby="protocol-title">
    <div class="protocol-scroll">
    <header class="protocol-head"><p class="lh-rule">Protocol of the Conference · ${esc(r.name)}</p><h1 id="protocol-title" class="fell">${esc(win.name)} prevails</h1><p>Concluded at ${clock(r.outcome.tick)} of ${clock(r.rules.duration)}: ${esc(win.name)} ${esc(reason)}.</p></header>
    <div class="protocol-cols">
      <section class="page"><h2 class="fell">Seals of the signatories</h2><div class="seals">${seals}</div>
        <table class="tally"><caption class="sr-only">Final standing of every power</caption><thead><tr><th scope="col">Power</th><th scope="col">Land</th><th scope="col">Troops</th><th scope="col">Prestige</th></tr></thead>${table}</table>
        <p class="footnote">An alliance's Prestige is the sum of its members' Prestige.</p></section>
      <section class="page"><h2 class="fell">Share of the land</h2>${landPlot(r, alliances, provinces)}
        <h2 class="fell">From the record</h2><ol class="highlights">${highlights.map(h => `<li class="${esc(h.tone)}"><time>${clock(h.tick)}</time><b>${esc(h.title)}</b> <span>${esc(h.detail)}</span></li>`).join('')}</ol></section>
    </div></div>
    <footer class="protocol-foot"><button class="pencil" type="button" ${sfx('press')}>${ic('back')}Register</button><button class="pencil" type="button" ${sfx('press')}>${ic('link')}Copy link</button><button class="stamp violet primary" type="button" ${sfx('stamp')}>${ic('play')}<span>Watch replay</span></button></footer>
  </article>`;
  mountAtlas(desk.querySelector('#map'), m, { focus: 'world', insets: () => ({}) });
  wirePlot();
}
let plotData = [];
/** Pen plot: each final alliance's share of provinces over the match. Ink line (dash = identity) over a
 * highlighter stroke in the alliance colour; direct labels at the line end; hover shows a crosshair readout. */
function landPlot(r, alliances, provinces) {
  const W = 600, H = 230, pad = { l: 36, r: 168, t: 12, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, top = .7;
  const x = t => pad.l + t / r.duration * iw, y = v => pad.t + (1 - v / top) * ih;
  const dashes = ['', '7 5', '2 4'], colors = ['#c8ff00', '#00ffd0', '#ff8cff', '#3d5cff'];
  const finalColors = m.powers(replayState(m, r.duration), null).colors, colorOf = (a, i) => finalColors[a.id] || colors[i % 4];
  const series = alliances.map((a, i) => ({ a, i, pts: r.series.map(s => [s.tick, s.countries.filter(c => a.members.includes(c.country)).reduce((n, c) => n + c.land, 0) / provinces]) }));
  const path = pts => pts.map(([t, v], k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const grid = [0, .2, .4, .6].map(v => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join('');
  const xt = [0, 120, 240, 360, 480].map(t => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${clock(t)}</text>`).join('');
  // Labels at the right end, nudged apart so they never collide.
  const ends = series.map(s => ({ s, y: y(s.pts.at(-1)[1]) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 30);
  const labels = ends.map(({ s, y: ly }) => `<g class="lbl" transform="translate(${W - pad.r + 8} ${ly})"><rect x="0" y="-7" width="10" height="10" fill="${colorOf(s.a, s.i)}" stroke="#1d2530"/><text x="15" y="2">${esc(s.a.name.length > 20 ? s.a.name.slice(0, 19) + '…' : s.a.name)}</text><text x="15" y="16" class="v">${Math.round(s.pts.at(-1)[1] * 100)}%</text></g>`).join('');
  plotData = series.map(s => ({ name: s.a.name, pts: s.pts }));
  return `<figure class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of provinces held by each final alliance over the match"><g class="grid">${grid}${xt}</g>
    ${series.map(s => `<path class="hl" d="${path(s.pts)}" stroke="${colorOf(s.a, s.i)}"/>`).join('')}
    ${series.map(s => `<path class="ink" d="${path(s.pts)}" stroke-dasharray="${dashes[s.i % 3]}"/>`).join('')}
    <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>${labels}
    <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>
    <figcaption class="readout" aria-live="polite">Hover the plot to read the shares at a moment.</figcaption></figure>`;
}
function wirePlot() {
  const fig = desk.querySelector('.plot'); if (!fig) return;
  const svg = fig.querySelector('svg'), hit = svg.querySelector('.hit'), cross = svg.querySelector('.cross'), out = fig.querySelector('.readout');
  const data = plotData, W = 600, l = 36, iw = W - 36 - 168, d = m.review.duration;
  hit.addEventListener('pointermove', e => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const u = p.matrixTransform(svg.getScreenCTM().inverse());
    const t = Math.max(0, Math.min(d, (u.x - l) / iw * d)); cross.setAttribute('x1', u.x); cross.setAttribute('x2', u.x); cross.setAttribute('visibility', 'visible');
    const at = s => s.pts.reduce((b, q) => Math.abs(q[0] - t) < Math.abs(b[0] - t) ? q : b)[1];
    out.textContent = `${clock(t)} · ${data.map(s => `${s.name} ${Math.round(at(s) * 100)}%`).join(' · ')}`;
  });
  hit.addEventListener('pointerleave', () => cross.setAttribute('visibility', 'hidden'));
}

/* ── Style tile: every component of the system side by side. ── */
function tileScreen() {
  desk.className = `desk plain tile-screen ${phone ? 'phone' : 'wide'}`;
  const sw = [['Desk leather', '#2a3a31'], ['Telegram buff', '#e6d6a8'], ['Dossier manila', '#d2b77c'], ['Index card', '#efe6cf'], ['Telegraph tape', '#f1e7c9'], ['Ink', '#1d2530'], ['Pencil', '#5f5b50'], ['Stamp red', '#a3261f'], ['Copying violet', '#4b3f78'], ['Brass', '#b48a45']];
  const sample = m.world.find(r => r.kind === 'chat'), head = m.world.find(r => r.kind === 'headline');
  desk.innerHTML = `<main class="tile" data-region="tile"><header class="tile-head"><h1 class="fell">Field Telegraph</h1><p>Concept B style tile · the shell is the paperwork on a commander's desk; the map stays as it is.</p></header>
  <div class="tile-grid">
    <section class="tcard"><h2 class="fell">Materials</h2><ul class="swatches">${sw.map(([n, c]) => `<li><i style="background:${c}"></i><span>${n}</span><code>${c}</code></li>`).join('')}</ul></section>
    <section class="tcard"><h2 class="fell">Type</h2><p class="fell t40">Council of Iron</p><p class="fell t24">Order of battle · 24</p><p class="t15">Courier Prime 15 — telegram body, readable at a glance.</p><p class="t13">Courier Prime 13 — labels, numbers 0123456789</p><p class="wire-line">FRANCE PROPOSES CHANNEL ENTENTE STOP</p><p class="t13 pencilc">Decorative wire line only; real copy stays sentence case.</p></section>
    <section class="tcard"><h2 class="fell">Buttons</h2><div class="row"><button class="stamp violet primary" type="button">${ic('pact')}<span>Propose alliance</span></button><button class="stamp violet primary is-hover" type="button"><span>Hover</span></button><button class="stamp violet primary is-pressed" type="button"><span>Pressed</span></button></div><div class="row"><button class="stamp red" type="button">${ic('war')}<span>Declare war</span></button><button class="stamp red outline" type="button">${ic('war')}<span>Secondary</span></button><button class="stamp violet primary" type="button" disabled><span>Disabled</span></button></div><div class="row"><button class="pencil" type="button">${ic('pen')}Pencil link</button><button class="seal-btn" type="button">${seal('britain', 'violet')}<span>Accept &amp; seal</span></button></div></section>
    <section class="tcard"><h2 class="fell">Keys, slide, tabs</h2><div class="keys"><button class="key" type="button" aria-pressed="false">25%</button><button class="key" type="button" aria-pressed="true">50%</button><button class="key" type="button" aria-pressed="false">75%</button><button class="key" type="button" role="switch" aria-checked="true">On</button></div><input class="slide" type="range" min="0" max="100" value="60" style="--pct:60%" aria-label="Example slide"><nav class="folder-tabs demo"><button type="button" aria-pressed="true">All</button><button type="button" aria-pressed="false">World</button><button type="button" aria-pressed="false">Paris<i>2</i></button></nav></section>
    <section class="tcard wide2"><h2 class="fell">Order of battle lines</h2>${orderOfBattle(L, you, { title: 'Order of battle' }).replace('data-region="order-of-battle"', '')}</section>
    <section class="tcard"><h2 class="fell">Dialog (telegram form)</h2>${offerTelegram().replace('data-region="notice"', '').replace('notice-lane', 'notice-demo')}</section>
    <section class="tcard wide2"><h2 class="fell">Messages (shared comms model)</h2><div class="cx-demo">
      <div class="cx-toast" data-tier="action"><span class="cx-standard">${insignia('france')}</span><p><b>French Republic</b> offers you the <b>Channel Entente</b></p><button type="button" class="cx-primary">Accept</button><button type="button" class="cx-secondary">Read</button><button type="button" class="cx-dismiss" aria-label="Dismiss">${ic('close')}</button><span class="cx-more">+1</span></div>
      <div class="cx-toast" data-tier="personal"><span class="cx-standard">${insignia('germany')}</span><p><b>German Empire</b> <span>Our quarrel is with France alone.</span></p><button type="button" class="cx-secondary">Open</button><button type="button" class="cx-dismiss" aria-label="Dismiss">${ic('close')}</button></div>
      <ol class="cx-list demo"><li><button type="button" class="cx-conv" data-state="action"><span class="cx-standard">${insignia('france')}</span><span class="cx-conv-main"><b>French Republic</b><span class="cx-preview">Alliance offer: Channel Entente</span></span><span class="cx-conv-meta"><time>00:58</time><span class="cx-chip">Offer</span></span></button></li>
        <li><button type="button" class="cx-conv" data-state="unread"><span class="cx-standard">${insignia('germany')}</span><span class="cx-conv-main"><b>German Empire</b><span class="cx-preview">Our quarrel is with France alone.</span></span><span class="cx-conv-meta"><time>00:12</time><i class="cx-count" data-tier="personal">1</i></span></button></li></ol>
      <ol class="cx-rows demo"><li class="cx-sep"><span>00:00</span></li>${sample ? `<li class="cx-msg" data-mine="false"><header><span class="cx-standard">${insignia(sample.from)}</span><b>${esc(cname(sample.from))}</b><time>${clock(sample.tick)}</time></header><p class="cx-text">${esc(sample.text)}</p></li>` : ''}
        <li class="cx-divider"><span>Unread</span></li>
        <li class="cx-sys" data-tier="action" data-state="open"><header>${ic('seal')}<b>Alliance offer · Channel Entente</b><time>00:58</time></header><p>French Republic invites British Empire into Channel Entente.</p><p class="cx-expiry">Open until 02:58</p><div class="cx-actions"><button type="button" class="cx-primary">Accept</button><button type="button" class="cx-secondary">Decline</button></div></li>
        <li class="cx-marker" data-tone="war"><p><b>War declared</b> British Empire declared war on United States.</p><time>00:00</time></li></ol>
      <form class="cx-composer"><input class="cx-input" placeholder="Message France…" aria-label="Message"><button type="button" class="cx-mic" aria-pressed="false" aria-label="Voice input">${ic('mic')}</button><button type="button" class="cx-send">${ic('send')}<span>Send</span></button></form>
    </div></section>
    <section class="tcard"><h2 class="fell">Icons</h2><ul class="icons">${Object.keys(PATHS).map(n => `<li>${ic(n)}<span>${n}</span></li>`).join('')}</ul></section>
    <section class="tcard"><h2 class="fell">Motion &amp; sound</h2><ul class="notes"><li><b>Telegram</b> slides out of the slot under the tape (240 ms), <code>data-sfx="type"</code>.</li><li><b>Stamp</b> lands: scale 1.5→1 with a 2° settle (200 ms), <code>stamp</code>.</li><li><b>Seal</b> presses: wax spreads, <code>seal</code>.</li><li><b>Dossier</b> slides in from the left edge, the map keeps its place.</li><li><b>Cursor</b>: a pen nib over valid targets.</li><li>Reduced motion: every transition becomes an instant change.</li></ul></section>
  </div></main>`;
}

/* ── Boot ── */
desk.addEventListener('submit', e => e.preventDefault());
(screens[S] || screens.hud)();
if (desk.querySelector('#cx-panel')) await mountComms(m, { button: desk.querySelector('#cx-button'), toasts: desk.querySelector('#cx-toasts'), panel: desk.querySelector('#cx-panel'),
  docked: () => !matchMedia('(max-width: 699px)').matches && S !== 'menu' });
for (const list of desk.querySelectorAll('.slips')) list.scrollTop = list.scrollHeight;
reviewerNav('B · Field Telegraph', 'Paperwork on the desk around a live map');
await document.fonts.ready;
requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
