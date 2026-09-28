/** v0.9 Messages: ONE interaction model for notifications and messages (see docs/UI-DESIGN.md v0.9).
 * One comms button (ACTION count loud, unread PERSONAL quiet), one toast lane (at most one toast, "+N"), one
 * panel = inbox (conversations sorted by what needs you) + threads (messages with inline Accept/Decline, an
 * Unread divider, "↓ N new", quick replies, a composer with the mic from voice.js). The World thread is the
 * history. Player text (chat, alliance names) only ever reaches textContent / escaped HTML, never SVG.
 *
 *   closed/docked ─C · badge · toast Read/Open─▶ THREAD ─Esc · back─▶ LIST ─Esc · ×─▶ closed (docked: LIST)
 */
import { inbox, arrivals } from './comms-model.js';
import { headlineCopy, systemCopy } from './feed-model.js';
import { icon, insignia, faction } from './presentation.js';
import { escapeHTML as esc } from './ui.js';
import { relationsOf } from './relations.js';

const QUICK = ['Agreed.', 'Not now.', 'Let us talk terms.'];
const clock = n => `${Math.floor(Math.max(0, n) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60).toString().padStart(2, '0')}`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Comms {
  /** opts: { button, toasts, panel, names, docked(): boolean, onAct(action) → Promise, onView(row), onSend(channel,to,text) → Promise,
   *  onRead(keys: Set), onOpen(view), sfx(cue) } */
  constructor(opts) {
    Object.assign(this, { button: opts.button, toasts: opts.toasts, panel: opts.panel, names: opts.names, docked: opts.docked || (() => false),
      onAct: opts.onAct || (async () => null), onView: opts.onView || (() => {}), onSend: opts.onSend || (async () => null), onRead: opts.onRead || (() => {}),
      onOpen: opts.onOpen || (() => {}), onPropose: opts.onPropose || (() => {}), onNotice: opts.onNotice || (() => {}), sfxHook: opts.sfx || (() => {}) });
    this.reset();
    this.build(); this.bind();
  }
  reset() {
    this.read = new Set(); this.dismissed = new Set(); this.scroll = new Map(); this.expanded = new Set(); this.drafts = new Map();
    this.state = null; this.history = []; this.items = null; this.box = null; this.readOnly = true;
    this.view = 'closed'; this.conv = null; this.divider = null; this.toast = { actions: [], personal: null, flash: null }; this.pulse = false;
    clearTimeout(this.personalTimer); clearTimeout(this.flashTimer);
    if (this.panel) this.render();
  }
  /* ── shell ── */
  build() {
    const b = this.button; b.classList.add('cx-button'); b.type = 'button'; b.dataset.sfx = 'press'; b.setAttribute('aria-keyshortcuts', 'C');
    b.setAttribute('aria-controls', this.panel.id); b.setAttribute('aria-expanded', 'false');
    this.toasts.innerHTML = '<div class="cx-live" aria-live="assertive" data-tier="action"></div><div class="cx-live" aria-live="polite" data-tier="personal"></div>';
    this.toasts.dataset.state = 'empty';
    const p = this.panel; p.classList.add('cx-panel'); p.setAttribute('aria-label', 'Messages');
    p.innerHTML = `<header class="cx-head plaque"><button type="button" class="cx-back" aria-label="All conversations" data-sfx="press">${icon('back')}</button><h2 class="cx-title">Messages</h2><button type="button" class="cx-readall" data-sfx="press">Mark all read</button><button type="button" class="cx-close" aria-label="Close messages" data-sfx="press">${icon('close')}</button></header>
<ol class="cx-list" aria-label="Conversations"></ol>
<section class="cx-thread" aria-label="Conversation"><nav class="cx-switch" aria-label="Switch conversation"></nav><div class="cx-members" hidden></div><ol class="cx-rows" aria-live="polite" aria-relevant="additions"></ol><button type="button" class="cx-jump" hidden data-sfx="press"></button>
<div class="cx-quick" role="group" aria-label="Quick replies"></div>
<form class="cx-composer composer"><label class="sr-only" for="cx-text">Message</label><textarea id="cx-text" class="cx-input" maxlength="500" rows="1" autocomplete="off" enterkeyhint="send" data-voice required></textarea><button type="submit" class="cx-send" data-sfx="confirm">${icon('send')}<span class="cx-send-label">Send</span></button><small class="cx-note"></small></form></section>`;
    this.render();
  }
  $(s) { return this.panel.querySelector(s); }
  bind() {
    this.button.addEventListener('click', () => this.view === 'thread' || (this.view === 'list' && !this.docked()) ? this.close() : this.openBest());
    this.$('.cx-back').addEventListener('click', () => this.showList());
    this.$('.cx-close').addEventListener('click', () => this.close());
    this.$('.cx-readall').addEventListener('click', () => this.markAllRead());
    this.$('.cx-list').addEventListener('click', e => { const b = e.target.closest('[data-conv]'); if (!b) return; const c = this.box?.conversations.find(c => c.key === b.dataset.conv); this.openThread(b.dataset.conv, { focusComposer: !c?.action }); });
    this.$('.cx-rows').addEventListener('click', e => this.rowClick(e));
    this.$('.cx-rows').addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.$('.cx-jump').addEventListener('click', () => this.toBottom(true));
    this.$('.cx-quick').addEventListener('click', e => { const q = e.target.closest('[data-quick]'); if (q) { const i = this.$('.cx-input'); i.value = q.dataset.quick; i.focus(); } });
    this.$('.cx-composer').addEventListener('submit', e => { e.preventDefault(); this.send(); });
    // Enter sends, Shift+Enter is a new line; the box grows to four lines.
    const input = this.$('.cx-input');
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } });
    input.addEventListener('input', () => { this.grow(); if (this.conv) this.drafts.set(this.conv, input.value); });
    this.$('.cx-switch').addEventListener('click', e => { const b = e.target.closest('[data-conv]'); if (b && b.dataset.conv !== this.conv) this.openThread(b.dataset.conv, { focusComposer: true }); });
    this.$('.cx-list').addEventListener('click', e => { const b = e.target.closest('[data-propose]'); if (b) { e.stopPropagation(); this.onPropose(b.dataset.propose || null); } }, true);
    this.$('.cx-rows').addEventListener('click', e => { const b = e.target.closest('[data-propose]'); if (b) this.onPropose(b.dataset.propose || null); });
    this.toasts.addEventListener('click', e => this.toastClick(e));
    let start = null; // swipe a toast sideways to dismiss it
    this.toasts.addEventListener('pointerdown', e => { const t = e.target.closest('.cx-toast'); if (t && !e.target.closest('button')) start = { t, x: e.clientX }; });
    addEventListener('pointerup', e => { if (start && Math.abs(e.clientX - start.x) > 60) this.dismissToast(start.t.dataset.key); start = null; });
    this.toasts.addEventListener('keydown', e => { const t = e.target.closest('.cx-toast'); if (t && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.dismissToast(t.dataset.key); } });
    addEventListener('resize', () => { if (this.view === 'closed' && this.docked() && this.state) { this.view = 'list'; this.render(); } });
  }
  /** Keyboard (the app forwards keys not typed into a field): C, J/K, Enter, Escape. Returns true if handled. */
  key(e) {
    if (!this.state) return false;
    if (e.key === 'c' || e.key === 'C') { this.view === 'thread' || (this.view === 'list' && !this.docked()) ? this.close() : this.openBest(); return true; }
    if (this.view === 'closed') return false;
    if (e.key === 'Escape') { if (this.view === 'thread') { this.showList(); return true; } if (!this.docked()) { this.close(); return true; } return false; }
    const convs = this.box.conversations.map(c => c.key), i = Math.max(0, convs.indexOf(this.conv ?? convs[0]));
    if (e.key === 'j' || e.key === 'k') { const next = convs[(i + (e.key === 'j' ? 1 : -1) + convs.length) % convs.length]; this.view === 'thread' ? this.openThread(next) : this.focusConv(next); return true; }
    return false;
  }
  /* ── data ── */
  /** A new observation. `live` = after catch-up (only then do arrivals toast). */
  update(state, history, { live = false, readOnly = false } = {}) {
    const first = !this.state || this.state.id !== state.id;
    this.state = state; this.history = history; this.readOnly = readOnly || !state.you;
    const before = this.box, after = inbox(state, { read: this.read, dismissed: this.dismissed, history });
    this.box = after;
    if (first && this.docked() && this.view === 'closed') this.view = 'list';
    // Watching (no seat): the only conversation is World, so the docked panel shows the history itself.
    if (first && this.readOnly && this.docked()) { this.render(); this.openThread('world', { focus: false }); return; }
    if (before && live && !first) {
      const got = arrivals(before, after);
      for (const r of got.actions) if (!this.toast.actions.some(a => a.key === r.key) && !(this.view === 'thread' && r.thread === this.conv)) this.toast.actions.push(r);
      const visible = got.personal.filter(g => !(this.view === 'thread' && g.thread === this.conv));
      if (visible.length) { this.toast.personal = visible.at(-1); clearTimeout(this.personalTimer); this.personalTimer = setTimeout(() => { this.toast.personal = null; this.renderToasts(); }, 4200); }
      if (got.worldPulse && this.conv !== 'world') this.pulse = true;
      this.sfx(got.actions.length ? 'action' : got.personal.length ? 'personal' : null);
      // New rows in the open thread: stay put if the reader scrolled up, and offer "↓ N new".
      if (this.view === 'thread') {
        const rows = this.$('.cx-rows'), atBottom = rows.scrollHeight - rows.scrollTop - rows.clientHeight < 32;
        const fresh = after.rows.filter(r => r.thread === this.conv && !before.rows.some(b => b.key === r.key)).length;
        this.render();
        if (fresh) { if (atBottom) this.toBottom(false); else this.jump((this.below || 0) + fresh); }
        this.markVisible(); return;
      }
    }
    this.render();
  }
  refresh() { if (this.state) { this.box = inbox(this.state, { read: this.read, dismissed: this.dismissed, history: this.history }); this.render(); } }
  setRead(keys) { this.read = new Set(keys); this.refresh(); }
  /* ── navigation ── */
  /** The most important conversation; for an unread message (no decision waiting) the composer is focused, ready to reply. */
  openBest() { const c = this.box?.conversations.find(c => c.action || c.unread); c ? this.openThread(c.key, { focusComposer: !c.action }) : this.showList(); }
  showList() { this.saveDraft(); this.saveScroll(); this.view = 'list'; this.render(); this.onOpen('list'); this.focusConv(this.conv || this.box?.conversations[0]?.key); }
  close() { this.saveDraft(); this.saveScroll(); const wasOpen = this.view !== 'closed'; this.view = this.docked() ? 'list' : 'closed'; this.render(); if (wasOpen) this.onOpen(this.view); if (this.panel.contains(document.activeElement) || wasOpen) this.button.focus({ preventScroll: true }); }
  focusConv(key) { if (!key) return; this.conv = key; this.renderList(); this.panel.querySelector(`[data-conv="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }); }
  /** Open a thread: jump to the first unread row (under an "Unread" divider) or the saved position. */
  openThread(key, { focusComposer = false, focus = true } = {}) {
    if (!this.box) return;
    this.saveDraft(); this.saveScroll(); this.view = 'thread'; this.conv = key; this.below = 0; this.jump(0);
    const input = this.$('.cx-input'); input.value = this.drafts.get(key) || ''; this.grow();
    this.divider = this.box.rows.find(r => r.thread === key && r.unread)?.key ?? null;
    if (key === 'world') this.pulse = false;
    this.toast.actions = this.toast.actions.filter(r => r.thread !== key);
    if (this.toast.personal?.thread === key) this.toast.personal = null;
    this.render(); this.onOpen('thread');
    const rows = this.$('.cx-rows');
    requestAnimationFrame(() => {
      const mark = rows.querySelector('.cx-divider'), saved = this.scroll.get(key);
      rows.scrollTop = mark ? Math.max(0, mark.offsetTop - 8) : saved !== undefined ? saved : rows.scrollHeight;
      this.clampCheck(); this.markVisible();
      if (focusComposer && !this.$('.cx-composer').hidden) this.$('.cx-input').focus({ preventScroll: true });
      else if (focus) this.$('.cx-title').focus?.({ preventScroll: true });
    });
  }
  saveDraft() { if (this.view === 'thread' && this.conv) { const v = this.$('.cx-input').value; if (v) this.drafts.set(this.conv, v); else this.drafts.delete(this.conv); } }
  saveScroll() { if (this.view === 'thread' && this.conv) this.scroll.set(this.conv, this.$('.cx-rows').scrollTop); }
  onScroll() { this.markVisible(); const rows = this.$('.cx-rows'); if (rows.scrollHeight - rows.scrollTop - rows.clientHeight < 32) this.jump(0); }
  toBottom(smooth) { const rows = this.$('.cx-rows'); rows.scrollTo({ top: rows.scrollHeight, behavior: smooth && !reduced() ? 'smooth' : 'auto' }); this.jump(0); }
  jump(n) { this.below = n; const b = this.$('.cx-jump'); b.hidden = !n; b.innerHTML = n ? `${icon('down')}<span>${n} new</span>` : ''; }
  /** Per-item read state: a row counts as read once it has actually been on screen in its open thread. */
  markVisible() {
    if (this.view !== 'thread' || this.panel.hidden) return;
    const rows = this.$('.cx-rows'), box = rows.getBoundingClientRect(); let changed = false;
    if (!box.height) return;
    for (const li of rows.querySelectorAll('.cx-is-unread[data-key]')) { const r = li.getBoundingClientRect(); if (r.top >= box.top - 2 && r.bottom <= box.bottom + 2 && !this.read.has(li.dataset.key)) { this.read.add(li.dataset.key); changed = true; } }
    if (changed) { this.onRead(this.read); this.box = inbox(this.state, { read: this.read, dismissed: this.dismissed, history: this.history }); this.renderButton(); this.renderList(); }
  }
  /** Everything read; decisions stay as chips in their conversations until decided or expired. */
  markAllRead() { for (const r of this.box?.rows || []) this.read.add(r.key); this.toast.personal = null; this.pulse = false; this.onRead(this.read); this.refresh(); }
  /* ── toasts ── */
  dismissToast(key) {
    if (this.toast.personal?.rows.some(r => r.key === key)) this.toast.personal = null;
    if (this.toast.flash?.key === key) this.toast.flash = null;
    if (this.toast.actions.some(r => r.key === key)) { this.toast.actions = this.toast.actions.filter(r => r.key !== key); this.dismissed.add(key); }
    this.renderToasts();
  }
  /** A brief, quiet line in the one toast lane (order confirmations, errors). Never covers an ACTION. */
  flash(text, { error = false } = {}) { clearTimeout(this.flashTimer); this.toast.flash = { key: `flash-${Date.now()}`, text, error }; this.renderToasts(); this.flashTimer = setTimeout(() => { this.toast.flash = null; this.renderToasts(); }, error ? 7000 : 4200); }
  /** A PERSONAL notice that is not a message (a battle result, an army turned back). `buttons`: [{label, act, arg,
   * primary}] handled by onNotice(act, arg); `sticky` notices stay until handled, dismissed or withdrawn. */
  notify({ key, title, detail = '', standard = null, view = null, buttons = [], sticky = false }) {
    this.toast.personal = { from: standard, thread: null, count: 1, notice: { key, title, detail, view, buttons }, rows: [{ key, item: {} }] };
    clearTimeout(this.personalTimer); if (!sticky) this.personalTimer = setTimeout(() => { this.toast.personal = null; this.renderToasts(); }, 5200);
    this.renderToasts(); this.sfx('personal');
  }
  /** Withdraw a toast whose subject no longer applies (the inbox withdraws threat rows by itself). */
  withdraw(key) { if (this.toast.personal?.notice?.key === key) { this.toast.personal = null; this.renderToasts(); } }
  toastClick(e) {
    const b = e.target.closest('button'), t = e.target.closest('.cx-toast'); if (!t) return;
    const key = t.dataset.key, row = this.box?.rows.find(r => r.key === key);
    if (b?.dataset.do === 'dismiss') return this.dismissToast(key);
    if (this.toast.personal?.notice?.key === key) {
      const n = this.toast.personal.notice; this.toast.personal = null; this.renderToasts();
      if (b?.dataset.noticeAct) return this.onNotice(b.dataset.noticeAct, b.dataset.arg); if (n.view) this.onView(n.view); return;
    }
    if (row?.item.type === 'threat') { this.dismissToast(key); return this.onView({ province: row.item.army.to }); }
    if (b?.dataset.do === 'accept' || b?.dataset.do === 'decline') return this.decide(row, b.dataset.do);
    if (!b || b.dataset.do === 'view') { if (t.dataset.tier === 'personal') this.toast.personal = null; return this.openThread(row?.thread || t.dataset.thread || 'world', { focusComposer: t.dataset.tier === 'personal' && Boolean(row?.item.channel) }); }
  }
  /* ── actions ── */
  async decide(row, choice) {
    if (!row || this.readOnly) return;
    const d = row.decision; if (!d) return;
    const action = d.kind === 'offer' ? { type: choice === 'accept' ? 'accept' : 'decline', proposalId: d.id }
      : d.kind === 'war_vote' ? { type: 'vote_war', motionId: d.id } : { type: 'vote_peace', motionId: d.id };
    this.toast.actions = this.toast.actions.filter(r => r.key !== row.key); this.read.add(row.key); this.onRead(this.read);
    this.renderToasts();
    await this.onAct(action, row);
    this.sfx(choice === 'accept' ? 'seal' : 'press');
  }
  async send() {
    const input = this.$('.cx-input'), text = input.value.trim(), conv = this.conv; if (!text || !conv || this.readOnly || this.$('.cx-send').disabled) return;
    const channel = conv === 'world' ? 'world' : conv === 'alliance' ? 'alliance' : 'dm';
    const ok = await this.onSend(channel, channel === 'dm' ? conv.slice(3) : null, text);
    // Keep the conversation going: clear only what was sent, keep focus in the box.
    if (ok) { this.drafts.delete(conv); if (this.conv === conv && input.value.trim() === text) input.value = ''; this.grow(); this.toBottom(false); input.focus({ preventScroll: true }); }
  }
  grow() { const i = this.$('.cx-input'); i.style.height = 'auto'; i.style.height = `${Math.min(i.scrollHeight, 108)}px`; }
  sfx(cue) { if (cue) this.sfxHook(cue); }
  /* ── rendering ── */
  render() {
    document.body.dataset.comms = this.view;
    this.panel.dataset.view = this.view === 'closed' ? 'list' : this.view;
    this.panel.hidden = this.view === 'closed' || !this.state;
    this.panel.dataset.docked = String(this.docked());
    this.button.hidden = !this.state;
    if (!this.state) { this.toasts.dataset.state = 'empty'; return; }
    this.renderButton(); this.renderToasts(); this.renderList(); this.renderThread();
  }
  renderButton() {
    const { action, unread } = this.box?.counts || { action: 0, unread: 0 }, b = this.button;
    b.dataset.action = String(action); b.dataset.unread = String(unread); b.setAttribute('aria-expanded', String(this.view !== 'closed'));
    b.setAttribute('aria-label', `Messages${action ? `: ${action} to decide` : ''}${unread ? `${action ? ',' : ':'} ${unread} unread` : ''}`);
    b.title = 'Messages (C)';
    const key = `${action}|${unread}`; if (b.dataset.key === key) return; b.dataset.key = key;
    b.innerHTML = `${icon('dispatches')}${action ? `<b class="cx-count" data-tier="action">${action}</b>` : ''}${unread ? `<i class="cx-count" data-tier="personal">${unread}</i>` : ''}`;
  }
  renderToasts() {
    const [loud, quiet] = this.toasts.querySelectorAll('.cx-live');
    const live = new Set((this.box?.rows || []).filter(r => r.pending).map(r => r.key));
    this.toast.actions = this.toast.actions.filter(r => live.has(r.key) && !this.dismissed.has(r.key));
    const a = this.toast.actions, p = this.toast.personal, f = this.toast.flash;
    // ONE lane: a decision owns it; otherwise a personal toast; otherwise a brief confirmation.
    const loudHTML = a.length ? this.actionToast(a[0], a.length - 1) : '', quietHTML = !a.length && p ? this.personalToast(p) : !a.length && f ? this.flashToast(f) : '';
    if (loud.dataset.html !== loudHTML) { loud.dataset.html = loudHTML; loud.innerHTML = loudHTML; }
    if (quiet.dataset.html !== quietHTML) { quiet.dataset.html = quietHTML; quiet.innerHTML = quietHTML; }
    this.toasts.dataset.state = a.length ? 'action' : p ? 'personal' : f ? 'flash' : 'empty';
  }
  actionToast(r, more) {
    const i = r.item, n = this.names;
    let text, buttons;
    if (i.type === 'threat') {
      text = `<b>${esc(n.country(i.army.country))}</b> attacks ${esc(n.province(i.army.to))} in ${Math.max(0, i.army.arrivesAt - this.state.tick)}s`;
      buttons = `<button type="button" class="cx-primary" data-do="view" data-sfx="press">View</button>`;
    } else if (i.system === 'offer') {
      text = i.candidate && i.candidate !== this.state.you ? `<b>${esc(n.country(i.from))}</b> proposes <b>${esc(n.country(i.candidate))}</b> for the <b>${esc(i.name)}</b>`
        : `<b>${esc(n.country(i.from))}</b> offers you the <b>${esc(i.name)}</b>`;
      buttons = `<button type="button" class="cx-primary" data-do="accept" data-sfx="seal">Accept</button><button type="button" class="cx-secondary" data-do="view" data-sfx="press">Read</button>`;
    } else {
      const c = systemCopy(i, { ...n, time: clock });
      text = `<b>${esc(c.title)}</b> ${esc(c.detail)}`;
      buttons = `<button type="button" class="cx-primary" data-do="accept" data-sfx="press">${r.decision?.kind === 'peace_offer' ? 'Accept peace' : 'Approve'}</button><button type="button" class="cx-secondary" data-do="view" data-sfx="press">Read</button>`;
    }
    const standard = i.type === 'threat' ? icon('threat') : insignia(i.from || i.fromRoster?.[0] || null);
    return `<div class="cx-toast" data-tier="action" data-key="${esc(r.key)}" data-thread="${esc(r.thread)}" tabindex="0"><span class="cx-standard">${standard}</span><p>${text}</p>${buttons}<button type="button" class="cx-dismiss" data-do="dismiss" aria-label="Dismiss (it stays in Messages)" data-sfx="press">${icon('close')}</button>${more ? `<span class="cx-more" aria-label="${more} more waiting">+${more}</span>` : ''}</div>`;
  }
  personalToast(g) {
    const n = this.names;
    if (g.notice) {
      const buttons = g.notice.buttons?.length ? g.notice.buttons.map(x => `<button type="button" class="${x.primary ? 'cx-primary' : 'cx-secondary'}" data-notice-act="${esc(x.act)}" data-arg="${esc(x.arg ?? '')}" data-sfx="press">${esc(x.label)}</button>`).join('')
        : g.notice.view ? `<button type="button" class="cx-secondary" data-do="view" data-sfx="press">View</button>` : '';
      return `<div class="cx-toast${g.notice.buttons?.length > 1 ? ' cx-wide' : ''}" data-tier="personal" data-key="${esc(g.notice.key)}" tabindex="0"><span class="cx-standard">${g.from ? insignia(g.from) : icon('battle')}</span><p><b>${esc(g.notice.title)}</b> <span class="cx-line">${esc(g.notice.detail)}</span></p>${buttons}<button type="button" class="cx-dismiss" data-do="dismiss" aria-label="Dismiss" data-sfx="press">${icon('close')}</button></div>`;
    }
    const r = g.rows.at(-1), i = r.item, who = g.from ? n.country(g.from) : 'News';
    const line = g.count > 1 ? `${g.count} messages` : i.type === 'message' ? String(i.text).split('\n')[0] : i.headline ? headlineCopy(i, { ...n, time: clock }).title : systemCopy(i, { ...n, time: clock }).title;
    const label = i.type === 'message' ? (i.channel === 'dm' ? 'Reply' : 'Open') : 'Open';
    return `<div class="cx-toast" data-tier="personal" data-key="${esc(r.key)}" data-thread="${esc(r.thread)}" tabindex="0"><span class="cx-standard">${g.from ? insignia(g.from) : icon('globe')}</span><p><b>${esc(who)}${i.channel === 'alliance' ? ' · alliance' : ''}</b> <span class="cx-line">${esc(line)}</span></p><button type="button" class="cx-secondary" data-do="view" data-sfx="press">${label}</button><button type="button" class="cx-dismiss" data-do="dismiss" aria-label="Dismiss" data-sfx="press">${icon('close')}</button></div>`;
  }
  flashToast(f) { return `<div class="cx-toast${f.error ? ' error' : ''}" data-tier="flash" data-key="${esc(f.key)}" role="${f.error ? 'alert' : 'status'}"><p>${esc(f.text)}</p><button type="button" class="cx-dismiss" data-do="dismiss" aria-label="Dismiss" data-sfx="press">${icon('close')}</button></div>`; }
  convTitle(c) { return c.kind === 'world' ? 'World' : c.kind === 'alliance' ? (c.side ? this.names.side(c.side) : 'Alliance') : this.names.country(c.country); }
  /** Pinned first: your alliance (or how to get one), then World and every power, sorted by what needs you. */
  ordered() {
    const convs = this.box.conversations, alliance = convs.find(c => c.kind === 'alliance');
    return [...(alliance ? [alliance] : []), ...convs.filter(c => c.kind !== 'alliance' && !(c.kind === 'dm' && c.eliminated && !c.active))];
  }
  relationTag(country) {
    if (!this.state.you) return '';
    const r = relationsOf(this.state, this.state.you);
    return r.allies.includes(country) ? 'Ally' : r.enemies.includes(country) ? 'At war' : 'Neutral';
  }
  renderList() {
    const list = this.$('.cx-list'), box = this.box; if (!box) return;
    const html = this.ordered().map(c => {
      const noAlliance = c.kind === 'alliance' && !c.side;
      const preview = c.last ? this.preview(c.last) : noAlliance ? 'You are independent. Propose an alliance to open a group chat.' : c.kind === 'dm' ? 'No messages yet. Say hello.' : 'No messages yet.';
      const chip = c.action ? `<span class="cx-chip">${c.rows.find(r => r.pending)?.item.system === 'offer' ? 'Offer' : c.rows.find(r => r.pending)?.item.type === 'threat' ? 'Attack' : 'Decide'}</span>` : '';
      const badge = c.unread ? `<i class="cx-count" data-tier="personal">${c.unread}</i>` : '';
      const tag = c.kind === 'dm' ? this.relationTag(c.country) : '';
      const glyph = c.kind === 'dm' ? insignia(c.country) : icon(c.kind === 'world' ? 'globe' : 'ally');
      const title = c.kind === 'alliance' ? (c.side ? `Your alliance: ${this.names.side(c.side)}` : 'No alliance yet') : this.convTitle(c);
      const propose = noAlliance && !this.readOnly && this.state.status === 'running' ? '<button type="button" class="cx-propose" data-propose="" data-sfx="press">Propose an alliance</button>' : '';
      return `<li${c.kind === 'alliance' ? ' class="cx-pinned"' : ''}><button type="button" class="cx-conv" aria-current="${c.key === this.conv && this.view === 'thread'}" data-conv="${esc(c.key)}" data-kind="${c.kind}" data-state="${c.action ? 'action' : c.unread ? 'unread' : 'read'}"${c.kind === 'world' && this.pulse ? ' data-pulse="1"' : ''}><span class="cx-standard">${glyph}</span><span class="cx-conv-main"><b>${esc(title)}</b><span class="cx-preview">${esc(preview)}</span></span><span class="cx-conv-meta"><time>${c.last ? clock(c.last.tick) : ''}</time>${tag ? `<small class="cx-rel" data-rel="${esc(tag)}">${esc(tag)}</small>` : ''}${chip}${badge}</span></button>${propose}</li>`;
    }).join('');
    if (list.dataset.html !== html) { list.dataset.html = html; list.innerHTML = html; }
  }
  preview(r) {
    const i = r.item, n = this.names;
    if (i.type === 'message') return `${r.mine ? 'You' : faction(i.from).short}: ${i.text}`;
    if (i.headline) { const h = headlineCopy(i, { ...n, time: clock }); return h.detail || h.title; }
    return this.systemLine(r).text;
  }
  systemLine(r) {
    const i = r.item, n = this.names, c = systemCopy(i, { ...n, time: clock, players: this.state.players.length });
    if (i.system === 'offer') {
      if (r.status === 'accepted') return { text: `${r.mine || (this.state.you && this.state.proposals?.find(q => q.id === i.proposalId)?.accepted.includes(this.state.you)) ? 'You accepted' : 'Accepted'} · ${i.name}`, state: 'resolved' };
      if (r.status === 'closed' || r.status === 'expired') return { text: `Offer closed · ${i.name}`, state: 'expired' };
      if (r.status === 'open' && !r.pending) return { text: `Alliance offer · ${i.name}: waiting for ${r.item.candidate ? n.country(r.item.candidate) : 'the others'}`, state: 'info' };
    }
    if (i.system === 'accepted') return { text: `${i.country === this.state.you ? 'You' : n.country(i.country)} accepted${i.name ? ` · ${i.name}` : ''}`, state: 'resolved' };
    if ((i.system === 'vote' || i.system === 'peace_offer') && !r.pending) return { text: `${c.title}${r.status === 'accepted' ? ' · passed' : r.status === 'waiting' ? ' · waiting for the others' : ' · closed'}`, state: r.status === 'accepted' ? 'resolved' : r.status === 'waiting' ? 'info' : 'expired' };
    return { text: `${c.title}: ${c.detail}`, state: 'info' };
  }
  renderThread() {
    const rowsEl = this.$('.cx-rows'), conv = this.box?.conversations.find(c => c.key === this.conv);
    const title = this.$('.cx-title'); title.textContent = this.view === 'thread' && conv ? this.convTitle(conv) : 'Messages'; title.tabIndex = -1;
    this.$('.cx-readall').hidden = !this.box || this.readOnly;
    const composer = this.$('.cx-composer'), quick = this.$('.cx-quick');
    if (this.view !== 'thread' || !conv) { if (rowsEl.dataset.html) { rowsEl.dataset.html = ''; rowsEl.innerHTML = ''; } composer.hidden = quick.hidden = true; return; }
    const me = this.state.players?.find(p => p.id === this.state.you);
    const canWrite = !this.readOnly && this.state.status === 'running' && me?.eliminatedAt == null && (conv.kind !== 'alliance' || conv.side) && !(conv.kind === 'dm' && conv.eliminated);
    composer.hidden = !canWrite; quick.hidden = !canWrite || conv.kind !== 'dm';
    const input = this.$('.cx-input'), n = this.names;
    input.placeholder = conv.kind === 'world' ? 'Message everyone…' : conv.kind === 'alliance' ? 'Message your alliance…' : `Message ${faction(conv.country).short}…`;
    const wait = Math.max(0, (this.state.commandBudget?.chatReadyAt || 0) - this.state.tick);
    // The chat cooldown is on the button itself; the draft stays in the box meanwhile.
    this.$('.cx-send').disabled = wait > 0; const label = wait ? `Send · ${wait}s` : 'Send';
    if (this.$('.cx-send-label').textContent !== label) this.$('.cx-send-label').textContent = label;
    this.$('.cx-note').textContent = conv.kind === 'alliance' && this.state.rules?.revealAllianceChatAfterMatch ? 'Alliance chat becomes public in the replay after the match ends.' : '';
    this.renderSwitch(conv); this.renderMembers(conv);
    const qhtml = QUICK.map(q => `<button type="button" data-quick="${esc(q)}" data-sfx="press">${esc(q)}</button>`).join('');
    if (quick.dataset.html !== qhtml) { quick.dataset.html = qhtml; quick.innerHTML = qhtml; }
    let minute = -1, html = '';
    for (const r of conv.rows) {
      if (r.item.system === 'accepted' && r.item.country === this.state.you) continue; // the offer row already says so
      const m = Math.floor(r.tick / 60);
      if (m !== minute) { minute = m; html += `<li class="cx-sep" aria-hidden="true"><span>${m === 0 ? 'Opening' : clock(m * 60)}</span></li>`; }
      if (r.key === this.divider) html += '<li class="cx-divider" role="separator"><span>Unread</span></li>';
      html += this.row(r);
    }
    if (!conv.rows.length) html = `<li class="cx-empty">${conv.kind === 'alliance' && !conv.side ? `You are independent. Propose an alliance to open a group chat.${this.readOnly ? '' : `<span class="cx-propose-list">${(this.state.players || []).filter(p => p.id !== this.state.you && p.eliminatedAt == null).map(p => `<button type="button" data-propose="${esc(p.id)}" data-sfx="press">${insignia(p.id)}<span>${esc(faction(p.id).short)}</span></button>`).join('')}</span>`}` : conv.kind === 'alliance' ? 'No alliance messages yet. Write below.' : conv.kind === 'world' ? 'Nothing has happened yet.' : `No messages with ${esc(n.country(conv.country))} yet.${canWrite ? ' Write below.' : ''}`}</li>`;
    if (rowsEl.dataset.html !== html) { rowsEl.dataset.html = html; const keep = rowsEl.scrollTop, bottom = rowsEl.scrollHeight - rowsEl.scrollTop - rowsEl.clientHeight < 32; rowsEl.innerHTML = html; rowsEl.scrollTop = bottom ? rowsEl.scrollHeight : keep; requestAnimationFrame(() => this.clampCheck()); }
    const unreadKeys = new Set(conv.rows.filter(r => r.unread).map(r => r.key));
    for (const li of rowsEl.querySelectorAll('[data-key]')) li.classList.toggle('cx-is-unread', unreadKeys.has(li.dataset.key));
  }
  /** One tap between conversations: your alliance, World, then the powers you talk to (and the rest). */
  renderSwitch(conv) {
    const nav = this.$('.cx-switch');
    const items = this.ordered().filter(c => c.kind !== 'dm' || c.active || c.key === conv.key || !this.readOnly);
    const html = this.readOnly ? '' : items.map(c => `<button type="button" data-conv="${esc(c.key)}" aria-current="${c.key === conv.key}" title="${esc(c.kind === 'alliance' ? (c.side ? this.names.side(c.side) : 'Alliance') : this.convTitle(c))}" aria-label="${esc(c.kind === 'alliance' ? 'Alliance chat' : this.convTitle(c))}${c.unread ? `, ${c.unread} unread` : ''}" data-sfx="press">${c.kind === 'dm' ? insignia(c.country) : icon(c.kind === 'world' ? 'globe' : 'ally')}${c.unread || c.action ? '<i class="cx-dot"></i>' : ''}</button>`).join('');
    if (nav.dataset.html !== html) { nav.dataset.html = html; nav.innerHTML = html; }
    nav.hidden = !html;
  }
  /** The alliance thread names its members (standards and names). */
  renderMembers(conv) {
    const box = this.$('.cx-members'), side = conv.kind === 'alliance' && conv.side ? (this.state.sides || []).find(s => s.id === conv.side) : null;
    const html = side ? side.members.map(id => `<span>${insignia(id)}<b>${id === this.state.you ? 'You' : esc(faction(id).short)}</b></span>`).join('') : '';
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
    box.hidden = !html;
  }
  row(r) {
    // Unread is a class set after rendering, so reading a row never rebuilds it (a tap on its buttons is never lost).
    const i = r.item, n = this.names, unread = '', time = `<time>${clock(r.tick)}</time>`;
    if (i.type === 'message') {
      const open = this.expanded.has(r.key) ? ' data-open="1"' : '';
      return `<li class="cx-msg${unread}" data-key="${esc(r.key)}" data-mine="${r.mine}"><header><span class="cx-standard">${insignia(i.from)}</span><b>${r.mine ? 'You' : esc(n.country(i.from))}</b>${time}</header><p class="cx-text"${open}>${esc(i.text)}</p><button type="button" class="cx-more-btn" hidden data-sfx="press">More</button></li>`;
    }
    if (i.type === 'threat') return `<li class="cx-sys cx-threat${unread}" data-key="${esc(r.key)}" data-tier="action" data-state="open">${icon('threat')}<p><b>Incoming attack</b> ${i.army.amount} ${esc(faction(i.army.country).short)} troops reach ${esc(n.province(i.army.to))} at ${clock(i.army.arrivesAt)}</p><button type="button" class="cx-secondary" data-do="view" data-province="${esc(i.army.to)}" data-sfx="press">View</button></li>`;
    if (i.headline) {
      const h = headlineCopy(i, { ...n, time: clock }), marker = ['war', 'peace', 'alliance', 'eliminated', 'dominance', 'dominance_broken', 'finished'].includes(i.headline.kind);
      const focus = h.focus?.province ? ` data-province="${esc(h.focus.province)}"` : h.focus?.country ? ` data-country="${esc(h.focus.country)}"` : '';
      return `<li class="${marker ? 'cx-marker' : 'cx-headline'}${unread}" data-key="${esc(r.key)}" data-tone="${esc(h.tone)}" data-tier="${r.tier}" data-kind="${esc(i.headline.kind)}"${focus}><p><b>${esc(h.title)}</b> ${esc(h.detail)}</p>${time}</li>`;
    }
    if (r.pending && !this.readOnly) {
      const c = systemCopy(i, { ...n, time: clock, players: this.state.players.length });
      if (i.system === 'offer') {
        const q = this.state.proposals?.find(q => q.id === i.proposalId);
        return `<li class="cx-sys cx-letter${unread}" data-key="${esc(r.key)}" data-tier="action" data-state="open"><header>${icon('seal')}<b>Alliance offer · ${esc(i.name)}</b>${time}</header><p>${esc(this.offerTerms(i))}</p><p class="cx-expiry">Open until ${clock(q?.expiresAt ?? r.tick)}</p><div class="cx-actions"><button type="button" class="cx-primary" data-do="accept" data-sfx="seal">Accept</button><button type="button" class="cx-secondary" data-do="decline" data-sfx="press">Decline</button></div></li>`;
      }
      return `<li class="cx-sys cx-letter${unread}" data-key="${esc(r.key)}" data-tier="action" data-state="open"><header>${icon(r.decision?.kind === 'war_vote' ? 'war' : 'seal')}<b>${esc(c.title)}</b>${time}</header><p>${esc(c.detail)}</p><div class="cx-actions"><button type="button" class="cx-primary" data-do="accept" data-sfx="press">${r.decision?.kind === 'peace_offer' ? 'Accept peace' : 'Approve'}</button></div></li>`;
    }
    const line = this.systemLine(r);
    return `<li class="cx-sys${unread}" data-key="${esc(r.key)}" data-tier="${r.tier}" data-state="${line.state}">${icon(line.state === 'resolved' ? 'seal' : 'ally')}<p>${esc(line.text)}</p>${time}</li>`;
  }
  /** Offer terms in game voice: who is in it and the most each member can win. */
  offerTerms(i) {
    const you = this.state.you, others = (i.roster || []).filter(id => id !== you).map(id => faction(id).short);
    const share = Math.round(100 * this.state.players.length / Math.max(1, (i.roster || []).length));
    return `Members: ${others.join(', ')} and you. Up to ${share} Prestige each if the alliance wins.`;
  }
  rowClick(e) {
    const b = e.target.closest('button'), li = e.target.closest('[data-key]');
    if (!li) return;
    if (!b) { if (li.dataset.province) this.onView({ province: li.dataset.province }); else if (li.dataset.country) this.onView({ country: li.dataset.country }); return; }
    if (b.classList.contains('cx-more-btn')) { const t = li.querySelector('.cx-text'), open = t.dataset.open === '1'; if (open) { delete t.dataset.open; this.expanded.delete(li.dataset.key); } else { t.dataset.open = '1'; this.expanded.add(li.dataset.key); } b.textContent = open ? 'More' : 'Less'; return; }
    if (b.dataset.do === 'view') return this.onView({ province: b.dataset.province });
    if (b.dataset.do) this.decide(this.box.rows.find(r => r.key === li.dataset.key), b.dataset.do);
  }
  /** Long messages clamp at four lines; "More" appears only when the text is actually cut. */
  clampCheck() { for (const t of this.panel.querySelectorAll('.cx-text')) { const btn = t.nextElementSibling; if (t.dataset.open === '1') { btn.hidden = false; btn.textContent = 'Less'; } else btn.hidden = t.scrollHeight <= t.clientHeight + 1; } }
}
