/** v0.9 comms controller: ONE interaction model for notifications and messages, skinned by each concept.
 * Markup uses `cx-*` classes only; each direction styles them. Player text (chat, alliance names) is inserted
 * with textContent via esc(); never into SVG. See docs/UI-CONCEPTS.md "Comms" for the states.
 *
 *   closed ──C / badge / toast "View"──▶ list ──Enter / tap──▶ thread ──Esc / back──▶ list ──Esc──▶ closed
 *   toast(action): stays until handled or dismissed (×, swipe, Esc on the toast); one visible, "+N" counter
 *   toast(personal): ~4 s, coalesced per sender; toast(world): none, the World row pulses
 */
import { inbox, arrivals } from '/concepts/kit/comms-model.js';
import { headlineCopy, systemCopy } from '/feed-model.js';
import { esc, insignia, clock } from '/concepts/kit/concept.js';

const ICON = {
  comms: '<path d="M4 5h16v11H9l-5 4V5Z"/>', back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', send: '<path d="M4 12l16-8-6 16-3-6-7-2Z"/>',
  world: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>', alliance: '<path d="M7 4h10v8l-5 4-5-4V4Zm-2 16h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>', down: '<path d="M12 5v13m-6-6 6 6 6-6"/>', threat: '<path d="M12 3l9 17H3L12 3Zm0 6v5m0 3v.5"/>',
};
export const cxIcon = name => `<svg class="cx-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>`;
const QUICK = ['Agreed.', 'Not now.', 'Let us talk terms.'];

export class Comms {
  /** opts: { button, toasts, panel, m, state, onAct(action) → Promise<nextState|null>, voiceScript, readUpTo, phone } */
  constructor(opts) {
    Object.assign(this, { button: opts.button, toasts: opts.toasts, panel: opts.panel, m: opts.m, onAct: opts.onAct || (async () => null), voiceScript: opts.voiceScript || '' });
    this.read = new Set(); this.dismissed = new Set(); this.scroll = new Map(); this.expanded = new Set(); this.resolved = new Map();
    this.view = 'closed'; this.conv = null; this.toast = { actions: [], personal: null }; this.pulse = false; this.hold = new URLSearchParams(location.search).get('hold') === '1';
    this.state = opts.state;
    // Everything already on the table when the page opens counts as read up to `readUpTo` (a seq), like a returning player.
    for (const r of inbox(this.state).rows) if (r.seq <= (opts.readUpTo ?? Infinity)) this.read.add(r.key);
    this.names = { ...this.m.names, time: clock, players: this.state.players.length };
    this.buildShell(); this.bind(); this.render();
    window.__comms = this; // test-only handle for the scripted walkthrough (never a game route)
  }
  get box() { return inbox(this.state, { read: this.read, dismissed: this.dismissed }); }

  /* ── shell ── */
  buildShell() {
    this.button.classList.add('cx-button'); this.button.type = 'button'; this.button.dataset.sfx = 'press';
    this.button.setAttribute('aria-keyshortcuts', 'C'); this.button.setAttribute('aria-controls', this.panel.id || (this.panel.id = 'cx-panel'));
    this.toasts.classList.add('cx-toasts');
    this.toasts.innerHTML = '<div class="cx-live" aria-live="assertive" data-tier="action"></div><div class="cx-live" aria-live="polite" data-tier="personal"></div>';
    this.panel.classList.add('cx-panel'); this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-label', 'Messages');
    this.panel.innerHTML = `<header class="cx-head"><button type="button" class="cx-back" aria-label="All conversations" data-sfx="press">${cxIcon('back')}</button><h2 class="cx-title">Messages</h2><button type="button" class="cx-readall" data-sfx="press">Mark all read</button><button type="button" class="cx-close" aria-label="Close messages" data-sfx="press">${cxIcon('close')}</button></header>
<ol class="cx-list" role="listbox" aria-label="Conversations"></ol>
<section class="cx-thread" aria-label="Conversation"><ol class="cx-rows"></ol><button type="button" class="cx-jump" hidden data-sfx="press"></button>
<div class="cx-quick" role="group" aria-label="Quick replies"></div>
<form class="cx-composer"><label class="cx-sr" for="cx-text">Message</label><input id="cx-text" class="cx-input" maxlength="500" autocomplete="off" data-voice><button type="button" class="cx-mic" aria-pressed="false" aria-label="Voice input" data-sfx="press">${cxIcon('mic')}</button><button type="submit" class="cx-send" data-sfx="confirm">${cxIcon('send')}<span>Send</span></button><small class="cx-voice-status" role="status"></small></form></section>`;
  }
  bind() {
    const p = this.panel;
    this.button.addEventListener('click', () => this.view === 'closed' ? this.openBest() : this.close());
    p.querySelector('.cx-back').addEventListener('click', () => this.showList());
    p.querySelector('.cx-close').addEventListener('click', () => this.close());
    p.querySelector('.cx-readall').addEventListener('click', () => this.markAllRead());
    p.querySelector('.cx-list').addEventListener('click', e => { const b = e.target.closest('[data-conv]'); if (b) this.openThread(b.dataset.conv); });
    p.querySelector('.cx-rows').addEventListener('click', e => this.rowClick(e));
    p.querySelector('.cx-rows').addEventListener('scroll', () => this.onScroll());
    p.querySelector('.cx-jump').addEventListener('click', () => this.toBottom(true));
    p.querySelector('.cx-quick').addEventListener('click', e => { const q = e.target.closest('[data-quick]'); if (q) { const i = p.querySelector('.cx-input'); i.value = q.dataset.quick; i.focus(); } });
    p.querySelector('.cx-mic').addEventListener('click', () => this.voice());
    p.querySelector('.cx-composer').addEventListener('submit', e => { e.preventDefault(); this.send(); });
    this.toasts.addEventListener('click', e => this.toastClick(e));
    // Swipe a toast sideways to dismiss it (touch); Escape on a focused toast does the same.
    let start = null;
    this.toasts.addEventListener('pointerdown', e => { const t = e.target.closest('.cx-toast'); if (t && !e.target.closest('button')) start = { t, x: e.clientX }; });
    addEventListener('pointerup', e => { if (start && Math.abs(e.clientX - start.x) > 60) this.dismissToast(start.t.dataset.key); start = null; });
    addEventListener('keydown', e => this.key(e));
  }
  key(e) {
    if (e.target.closest?.('input,textarea,select,[contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); this.view === 'closed' ? this.openBest() : this.close(); return; }
    if (e.key === 'Escape') { if (e.target.closest?.('.cx-toast')) return this.dismissToast(e.target.closest('.cx-toast').dataset.key); if (this.view === 'thread') return this.showList(); if (this.view === 'list') return this.close(); }
    if (this.view === 'closed') return;
    const convs = this.box.conversations.map(c => c.key), i = Math.max(0, convs.indexOf(this.conv ?? convs[0]));
    if (e.key === 'j' || e.key === 'k') { e.preventDefault(); const next = convs[(i + (e.key === 'j' ? 1 : -1) + convs.length) % convs.length]; this.view === 'thread' ? this.openThread(next) : this.focusConv(next); }
    if (e.key === 'Enter' && this.view === 'list' && e.target.closest?.('[data-conv]')) this.openThread(e.target.closest('[data-conv]').dataset.conv);
  }

  /* ── navigation ── */
  openBest() { const c = this.box.conversations.find(c => c.action || c.unread); c ? this.openThread(c.key) : this.showList(); }
  showList() { this.saveScroll(); this.view = 'list'; this.render(); this.focusConv(this.conv || this.box.conversations[0].key); }
  close() { this.saveScroll(); this.view = 'closed'; this.render(); this.button.focus({ preventScroll: true }); }
  focusConv(key) { this.conv = key; this.render(); this.panel.querySelector(`[data-conv="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }); }
  openThread(key) {
    this.saveScroll(); this.view = 'thread'; this.conv = key; this.divider = this.box.rows.find(r => r.thread === key && r.unread)?.key ?? null;
    this.render(); const rows = this.panel.querySelector('.cx-rows');
    requestAnimationFrame(() => {
      const mark = rows.querySelector('.cx-divider'), saved = this.scroll.get(key);
      if (mark) rows.scrollTop = Math.max(0, mark.offsetTop - rows.offsetTop - 8); else if (saved !== undefined) rows.scrollTop = saved; else rows.scrollTop = rows.scrollHeight;
      this.clampCheck(); this.markVisible();
    });
    // Reading an ACTION item's thread does not handle it: its toast leaves, its chip stays until decided.
    this.toast.actions = this.toast.actions.filter(r => r.thread !== key);
    if (this.toast.personal?.rows.some(r => r.thread === key)) this.toast.personal = null;
    this.renderToasts();
  }
  saveScroll() { if (this.view === 'thread' && this.conv) this.scroll.set(this.conv, this.panel.querySelector('.cx-rows').scrollTop); }
  onScroll() { this.markVisible(); const rows = this.panel.querySelector('.cx-rows'); if (rows.scrollHeight - rows.scrollTop - rows.clientHeight < 24) this.jump(0); }
  toBottom(smooth) { const rows = this.panel.querySelector('.cx-rows'); rows.scrollTo({ top: rows.scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' }); this.jump(0); }
  jump(n) { const b = this.panel.querySelector('.cx-jump'); b.hidden = !n; b.innerHTML = n ? `${cxIcon('down')}<span>${n} new</span>` : ''; }
  /** Per-item read state: a row counts as read once it has actually been on screen in its thread. */
  markVisible() {
    const rows = this.panel.querySelector('.cx-rows'), box = rows.getBoundingClientRect(); let changed = false;
    for (const li of rows.querySelectorAll('[data-key].cx-is-unread')) { const r = li.getBoundingClientRect(); if (r.top >= box.top - 2 && r.bottom <= box.bottom + 2 && !this.read.has(li.dataset.key)) { this.read.add(li.dataset.key); changed = true; } }
    if (changed) { this.renderButton(); this.renderList(); }
  }
  markAllRead() { for (const r of this.box.rows) if (r.tier !== 'action' || !r.pending) this.read.add(r.key); for (const r of this.box.rows) if (r.pending) this.read.add(r.key); this.toast.personal = null; this.pulse = false; this.render(); }

  /* ── arrivals & toasts ── */
  receive(next) {
    const before = this.box; this.state = next; const got = arrivals(before, this.box);
    for (const r of got.actions) if (!this.toast.actions.some(a => a.key === r.key)) this.toast.actions.push(r);
    if (got.personal.length) { const g = got.personal.at(-1); this.toast.personal = g; clearTimeout(this.personalTimer); if (!this.hold) this.personalTimer = setTimeout(() => { this.toast.personal = null; this.renderToasts(); }, 4200); }
    if (got.worldPulse) this.pulse = true;
    // A new row in the open thread: stay put if the reader scrolled up, and offer "↓ N new".
    const rows = this.panel.querySelector('.cx-rows'), atBottom = rows.scrollHeight - rows.scrollTop - rows.clientHeight < 24;
    const fresh = this.view === 'thread' ? this.box.rows.filter(r => r.thread === this.conv && !before.rows.some(b => b.key === r.key)).length : 0;
    this.render();
    if (this.view === 'thread') { if (atBottom) this.toBottom(false); else if (fresh) this.jump(fresh); this.markVisible(); }
    this.sfx(got.actions.length ? 'stinger' : got.personal.length ? 'blip' : null);
  }
  dismissToast(key) {
    if (this.toast.personal && this.toast.personal.rows.some(r => r.key === key)) { this.toast.personal = null; }
    this.toast.actions = this.toast.actions.filter(r => r.key !== key); this.dismissed.add(key); this.renderToasts();
  }
  toastClick(e) {
    const b = e.target.closest('button'), t = e.target.closest('.cx-toast'); if (!t) return;
    const key = t.dataset.key, row = this.box.rows.find(r => r.key === key);
    if (!b) { if (row) this.openThread(row.thread); return; }
    if (b.dataset.do === 'dismiss') return this.dismissToast(key);
    if (b.dataset.do === 'view') { if (t.dataset.tier === 'personal') this.toast.personal = null; return this.openThread(row?.thread || t.dataset.thread); }
    if (b.dataset.do === 'accept' || b.dataset.do === 'decline') return this.decide(row, b.dataset.do);
  }

  /* ── actions (the prototype swaps in the recorded next observation when one exists) ── */
  async decide(row, choice) {
    if (!row) return;
    const q = (this.state.proposals || []).find(q => q.id === row.item.proposalId);
    const next = await this.onAct({ type: choice === 'accept' ? 'accept' : 'decline', proposalId: q?.id, key: row.key });
    this.toast.actions = this.toast.actions.filter(r => r.key !== row.key); this.read.add(row.key);
    if (next) { const before = new Set(this.box.rows.map(r => r.key)); this.state = next; for (const r of this.box.rows) if (!before.has(r.key)) this.read.add(r.key); }
    else this.resolved.set(row.key, choice === 'accept' ? 'accepted' : 'declined');
    this.render(); if (this.view === 'thread') this.toBottom(false);
    this.sfx(choice === 'accept' ? 'seal' : 'press');
  }
  async send() {
    const input = this.panel.querySelector('.cx-input'), text = input.value.trim(); if (!text || !this.conv) return;
    const next = await this.onAct({ type: 'chat', channel: this.conv === 'world' ? 'world' : this.conv === 'alliance' ? 'alliance' : 'dm', to: this.conv.startsWith('dm:') ? this.conv.slice(3) : null, text });
    if (next) { const before = new Set(this.box.rows.map(r => r.key)); this.state = next; for (const r of this.box.rows) if (!before.has(r.key)) this.read.add(r.key); }
    input.value = ''; this.panel.querySelector('.cx-voice-status').textContent = ''; this.render(); this.toBottom(false); this.sfx('confirm');
  }
  /** Voice: the real client records and transcribes (public/voice.js); the prototype plays a scripted transcript. */
  voice() {
    const mic = this.panel.querySelector('.cx-mic'), status = this.panel.querySelector('.cx-voice-status'), input = this.panel.querySelector('.cx-input');
    if (mic.getAttribute('aria-pressed') === 'true') return;
    mic.setAttribute('aria-pressed', 'true'); this.panel.dataset.voice = 'listening'; status.textContent = 'Listening…';
    setTimeout(() => { input.value = this.voiceScript || input.value; mic.setAttribute('aria-pressed', 'false'); delete this.panel.dataset.voice; status.textContent = 'Check the words, then send.'; input.focus(); }, 1400);
  }
  sfx(cue) { if (cue) document.dispatchEvent(new CustomEvent('cx-sfx', { detail: cue })); }

  /* ── rendering ── */
  render() { document.body.dataset.comms = this.view; this.panel.dataset.view = this.view; this.panel.hidden = this.view === 'closed'; this.renderButton(); this.renderToasts(); this.renderList(); this.renderThread(); }
  renderButton() {
    const { action, unread } = this.box.counts;
    this.button.dataset.action = action; this.button.dataset.unread = unread; this.button.setAttribute('aria-expanded', String(this.view !== 'closed'));
    this.button.setAttribute('aria-label', `Messages${action ? `: ${action} to decide` : ''}${unread ? `, ${unread} unread` : ''} (C)`);
    this.button.innerHTML = `${cxIcon('comms')}<span class="cx-label">Messages</span>${action ? `<b class="cx-count" data-tier="action">${action}</b>` : ''}${unread ? `<i class="cx-count" data-tier="personal">${unread}</i>` : ''}`;
  }
  renderToasts() {
    const [loud, quiet] = this.toasts.querySelectorAll('.cx-live'), a = this.toast.actions.filter(r => this.box.rows.find(x => x.key === r.key)?.pending), p = this.toast.personal;
    this.toast.actions = a;
    // ONE fixed region; the ACTION toast wins the slot, a personal toast waits underneath only when there is none.
    loud.innerHTML = a.length ? this.actionToast(a[0], a.length - 1) : '';
    quiet.innerHTML = !a.length && p ? this.personalToast(p) : '';
    this.toasts.dataset.state = a.length ? 'action' : p ? 'personal' : 'empty';
  }
  actionToast(r, more) {
    const i = r.item, who = this.names.country(i.from ?? i.army?.country);
    const text = i.type === 'threat' ? `${esc(who)} army reaches ${esc(this.names.province(i.army.to))} in ${Math.max(0, i.army.arrivesAt - this.state.tick)}s`
      : i.system === 'offer' ? `<b>${esc(who)}</b> offers you the <b>${esc(i.name)}</b>` : `<b>${esc(who)}</b>: ${esc(systemCopy(i, this.names).title)}`;
    const buttons = i.system === 'offer' ? `<button type="button" class="cx-primary" data-do="accept" data-sfx="seal">Accept</button><button type="button" class="cx-secondary" data-do="view" data-sfx="press">Read</button>` : `<button type="button" class="cx-primary" data-do="view" data-sfx="press">View</button>`;
    return `<div class="cx-toast" data-tier="action" data-key="${esc(r.key)}" data-thread="${esc(r.thread)}" tabindex="0" data-sfx="stinger"><span class="cx-standard">${i.type === 'threat' ? cxIcon('threat') : insignia(i.from)}</span><p>${text}</p>${buttons}<button type="button" class="cx-dismiss" data-do="dismiss" aria-label="Dismiss (stays in Messages)" data-sfx="press">${cxIcon('close')}</button>${more ? `<span class="cx-more" aria-label="${more} more waiting">+${more}</span>` : ''}</div>`;
  }
  personalToast(g) {
    const r = g.rows.at(-1), i = r.item, who = g.from ? this.names.country(g.from) : 'News';
    const line = g.count > 1 ? `${g.count} messages` : i.type === 'message' ? i.text : i.headline ? headlineCopy(i, this.names).title : systemCopy(i, this.names).title;
    return `<div class="cx-toast" data-tier="personal" data-key="${esc(r.key)}" data-thread="${esc(r.thread)}" tabindex="0" data-sfx="blip"><span class="cx-standard">${g.from ? insignia(g.from) : cxIcon('world')}</span><p><b>${esc(who)}</b> <span class="cx-line">${esc(line)}</span></p><button type="button" class="cx-secondary" data-do="view" data-sfx="press">Open</button><button type="button" class="cx-dismiss" data-do="dismiss" aria-label="Dismiss" data-sfx="press">${cxIcon('close')}</button></div>`;
  }
  convTitle(c) { return c.kind === 'world' ? 'World' : c.kind === 'alliance' ? (c.side ? this.names.side(c.side) : 'Alliance') : this.names.country(c.country); }
  renderList() {
    const list = this.panel.querySelector('.cx-list'), box = this.box;
    list.innerHTML = box.conversations.map(c => {
      const last = c.last, preview = !last ? (c.kind === 'alliance' && !c.side ? 'Join an alliance to talk here.' : 'No messages yet.') : this.preview(last);
      const chip = c.action ? `<span class="cx-chip" data-tier="action">${c.rows.find(r => r.pending)?.item.system === 'offer' ? 'Offer' : 'Decide'}</span>` : '';
      const badge = c.unread ? `<i class="cx-count" data-tier="personal">${c.unread}</i>` : '';
      return `<li><button type="button" class="cx-conv" role="option" aria-selected="${c.key === this.conv}" data-conv="${esc(c.key)}" data-state="${c.action ? 'action' : c.unread ? 'unread' : 'read'}"${c.kind === 'world' && this.pulse ? ' data-pulse="1"' : ''}><span class="cx-standard">${c.kind === 'dm' ? insignia(c.country) : cxIcon(c.kind)}</span><span class="cx-conv-main"><b>${esc(this.convTitle(c))}</b><span class="cx-preview">${esc(preview)}</span></span><span class="cx-conv-meta"><time>${last ? clock(last.tick) : ''}</time>${chip}${badge}</span></button></li>`;
    }).join('');
  }
  preview(r) {
    const i = r.item; if (i.type === 'message') return `${r.mine ? 'You' : this.names.short(i.from)}: ${i.text}`;
    if (i.headline) return headlineCopy(i, this.names).detail || headlineCopy(i, this.names).title; return this.systemLine(r).text;
  }
  systemLine(r) {
    const i = r.item, c = systemCopy(i, this.names), local = this.resolved.get(r.key);
    if (i.system === 'offer') {
      const status = local || r.status;
      if (status === 'accepted') return { text: `You accepted · ${i.name}`, state: 'resolved' };
      if (status === 'declined') return { text: `You declined · ${i.name}`, state: 'resolved' };
      if (status === 'expired' || status === 'closed') return { text: `Offer closed · ${i.name}`, state: 'expired' };
    }
    if (i.system === 'accepted') return { text: `${i.country === this.state.you ? 'You' : this.names.country(i.country)} accepted${i.name ? ` · ${i.name}` : ''}`, state: 'resolved' };
    return { text: `${c.title}: ${c.detail}`, state: 'info' };
  }
  renderThread() {
    const rowsEl = this.panel.querySelector('.cx-rows'), key = this.conv, conv = this.box.conversations.find(c => c.key === key);
    const title = this.panel.querySelector('.cx-title'); title.textContent = this.view === 'thread' && conv ? this.convTitle(conv) : 'Messages';
    const composer = this.panel.querySelector('.cx-composer'), quick = this.panel.querySelector('.cx-quick');
    if (this.view !== 'thread' || !conv) { rowsEl.innerHTML = ''; return; }
    const canWrite = conv.kind !== 'alliance' || conv.side;
    composer.hidden = !canWrite; this.panel.querySelector('.cx-input').placeholder = conv.kind === 'world' ? 'Message everyone…' : conv.kind === 'alliance' ? 'Message your alliance…' : `Message ${this.names.short(conv.country)}…`;
    quick.hidden = conv.kind !== 'dm'; quick.innerHTML = QUICK.map(q => `<button type="button" data-quick="${esc(q)}" data-sfx="press">${esc(q)}</button>`).join('');
    let minute = -1, html = '';
    for (const r of conv.rows) {
      // The offer row itself says "You accepted"; the separate acceptance record would repeat it.
      if (r.item.system === 'accepted' && r.item.country === this.state.you) continue;
      const m = Math.floor(r.tick / 60);
      if (m !== minute) { minute = m; html += `<li class="cx-sep" aria-hidden="true"><span>${m === 0 ? 'Opening' : `${clock(m * 60)}`}</span></li>`; }
      if (r.key === this.divider) html += '<li class="cx-divider" role="separator"><span>Unread</span></li>';
      html += this.row(r);
    }
    if (!conv.rows.length) html = `<li class="cx-empty">${conv.kind === 'alliance' ? 'You are independent. Accept an offer or propose an alliance from a country card to open this channel.' : `Nothing yet. Write to ${esc(this.convTitle(conv))} below.`}</li>`;
    rowsEl.innerHTML = html; requestAnimationFrame(() => this.clampCheck());
  }
  row(r) {
    const i = r.item, unread = r.unread ? ' cx-is-unread' : '', time = `<time>${clock(r.tick)}</time>`;
    if (i.type === 'message') {
      const long = this.expanded.has(r.key) ? ' data-open="1"' : '';
      return `<li class="cx-msg${unread}" data-key="${esc(r.key)}" data-mine="${r.mine}"><header><span class="cx-standard">${insignia(i.from)}</span><b>${r.mine ? 'You' : esc(this.names.country(i.from))}</b>${time}</header><p class="cx-text"${long}>${esc(i.text)}</p><button type="button" class="cx-more-btn" hidden data-sfx="press">More</button></li>`;
    }
    if (i.type === 'threat') return `<li class="cx-sys${unread}" data-key="${esc(r.key)}" data-tier="action" data-state="open">${cxIcon('threat')}<p><b>Incoming attack</b> ${esc(this.names.country(i.army.country))} reaches ${esc(this.names.province(i.army.to))} at ${clock(i.army.arrivesAt)}</p>${time}</li>`;
    if (i.headline) {
      const h = headlineCopy(i, this.names), marker = ['war', 'peace', 'alliance', 'eliminated'].includes(i.headline.kind);
      return `<li class="${marker ? 'cx-marker' : 'cx-headline'}${unread}" data-key="${esc(r.key)}" data-tone="${esc(h.tone)}" data-tier="${r.tier}"><p><b>${esc(h.title)}</b> ${esc(h.detail)}</p>${time}</li>`;
    }
    const line = this.systemLine(r), pending = r.pending && !this.resolved.has(r.key);
    if (i.system === 'offer' && pending) {
      const c = systemCopy(i, this.names);
      return `<li class="cx-sys${unread}" data-key="${esc(r.key)}" data-tier="action" data-state="open"><header>${cxIcon('alliance')}<b>${esc(c.title)} · ${esc(i.name)}</b>${time}</header><p>${esc(c.detail)}</p><p class="cx-expiry">Open until ${clock(this.state.proposals.find(q => q.id === i.proposalId)?.expiresAt ?? r.tick)}</p><div class="cx-actions"><button type="button" class="cx-primary" data-do="accept" data-sfx="seal">Accept</button><button type="button" class="cx-secondary" data-do="decline" data-sfx="press">Decline</button></div></li>`;
    }
    return `<li class="cx-sys${unread}" data-key="${esc(r.key)}" data-tier="${r.tier}" data-state="${line.state}">${cxIcon(line.state === 'resolved' ? 'check' : 'alliance')}<p>${esc(line.text)}</p>${time}</li>`;
  }
  rowClick(e) {
    const b = e.target.closest('button'), li = e.target.closest('[data-key]'); if (!b || !li) return;
    if (b.classList.contains('cx-more-btn')) { const t = li.querySelector('.cx-text'); const open = t.dataset.open === '1'; open ? (delete t.dataset.open, this.expanded.delete(li.dataset.key)) : (t.dataset.open = '1', this.expanded.add(li.dataset.key)); b.textContent = open ? 'More' : 'Less'; return; }
    if (b.dataset.do) this.decide(this.box.rows.find(r => r.key === li.dataset.key), b.dataset.do);
  }
  /** Long messages clamp (CSS: .cx-text:not([data-open]) line-clamp); show "More" only when text is actually cut. */
  clampCheck() { for (const t of this.panel.querySelectorAll('.cx-text')) { const btn = t.nextElementSibling; if (t.dataset.open === '1') { btn.hidden = false; btn.textContent = 'Less'; } else btn.hidden = t.scrollHeight <= t.clientHeight + 1; } }
}
