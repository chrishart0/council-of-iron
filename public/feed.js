/** v0.6 World feed panel and headline banners. Presentation only: no rules, no orders.
 * Headlines come from the engine's `event.headline`; this module never reclassifies them.
 * Player text (chat, alliance names) is written with textContent only.
 */
import { headlineCopy, affectsViewer, systemCopy, isPersonal } from './feed-model.js';
import { icon, insignia } from './presentation.js';

// The history column keeps the whole match (a full 30-minute match stays well below this).
const MAX_ROWS = 2000, MAX_QUEUE = 5;
/** How long a new row stays expanded (≤4 lines) before shrinking to the compact clamp. */
export const FRESH_MS = 7000;
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const itemKey = item => item.id === null ? `b${item.seq}:${item.side}` : `e${item.id}`;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The history rail (v0.7, v0.8 filters): headlines, world chat and, for a seated player, their own
 * alliance chat, DMs, diplomatic rows and threats — exactly the events this seat received (commsItems).
 * Rows are appended, never re-rendered, so scroll position, focus and screen-reader position survive
 * polling. New live rows arrive expanded (clamped to four lines), then shrink to two; any clamped text
 * expands on click, Enter or Space. Three filters: All, World, Mine. Private rows link to the country
 * or alliance card where the actions live. Read state is per item (`read`, a set of seq numbers). */
export const FEED_FILTERS = Object.freeze(['all', 'world', 'mine']);
/** Is a row "mine" (anything beyond the public world stream)? */
export const isMine = threads => (threads || ['world']).some(t => t !== 'world');
export class WorldFeed {
  constructor({ list, unread, toggle, body, jump }, names) {
    Object.assign(this, { list, unread, toggle, body, jump, names });
    this.keys = new Set(); this.count = 0; this.lastSeq = 0; this.caughtUp = false; this.below = 0; this.timers = new Set();
    this.filter = 'all'; this.read = new Set(); this.onRead = null;
    list.addEventListener('click', event => { const clamp = event.target.closest('.feed-clamp[aria-expanded]'); if (clamp) this.expand(clamp); });
    list.addEventListener('keydown', event => {
      const clamp = event.target.closest('.feed-clamp[aria-expanded]');
      if (clamp && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.expand(clamp); }
    });
    list.addEventListener('scroll', () => { if (this.atBottom()) this.showJump(0); }, { passive: true });
    jump?.addEventListener('click', () => { this.list.scrollTop = this.list.scrollHeight; this.showJump(0); });
    // A personal row counts as read once it has actually been visible in the open rail.
    this.seen = globalThis.IntersectionObserver ? new IntersectionObserver(entries => {
      if (!this.open) return;
      const seen = entries.filter(e => e.isIntersecting && !e.target.hidden && e.target.dataset.personal).map(e => Number(e.target.dataset.seq));
      this.markRead(seen);
    }, { root: list, threshold: .6 }) : null;
  }
  reset() {
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    this.seen?.disconnect(); this.room = null; this.filter = 'all';
    this.list.replaceChildren(); this.keys.clear(); this.count = 0; this.lastSeq = 0; this.caughtUp = false; this.read = new Set();
    this.showUnread(); this.showJump(0);
  }
  get open() { return this.toggle.getAttribute('aria-expanded') === 'true'; }
  setOpen(open) {
    this.toggle.setAttribute('aria-expanded', String(open)); this.body.hidden = !open;
    this.toggle.closest('.world-feed')?.classList.toggle('collapsed', !open);
    if (open) { this.count = 0; this.showUnread(); this.list.scrollTop = this.list.scrollHeight; this.showJump(0); this.measureAll(); }
  }
  atBottom() { return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40; }
  showUnread() {
    this.unread.textContent = this.count ? String(this.count) : '';
    this.unread.setAttribute('aria-label', this.count ? `${this.count} unread` : '');
  }
  /** "N new ↓": newer rows arrived while the reader was scrolled up; never yank them down. */
  showJump(n) {
    this.below = n; if (!this.jump) return;
    this.jump.hidden = !n; this.jump.textContent = n ? `${n} new ↓` : '';
  }
  /** Mark personal rows read by seq (per item, never a single cursor); returns the newly read seqs. */
  markRead(seqs) {
    const fresh = [...new Set(seqs)].filter(seq => Number.isSafeInteger(seq) && !this.read.has(seq));
    if (!fresh.length) return [];
    for (const seq of fresh) this.read.add(seq);
    for (const li of this.list.querySelectorAll('.unread')) if (this.read.has(Number(li.dataset.seq))) li.classList.remove('unread');
    this.onRead?.(fresh); return fresh;
  }
  /** Filter: 'all', 'world' (public stream) or 'mine' (alliance, DMs, diplomacy, threats). */
  setFilter(filter) {
    this.filter = FEED_FILTERS.includes(filter) ? filter : 'all';
    for (const li of this.list.children) this.applyFilter(li);
    this.list.scrollTop = this.list.scrollHeight; this.measureAll();
  }
  applyFilter(li) {
    const f = this.filter, threads = (li.dataset.threads || 'world').split(' ');
    li.hidden = !(f === 'all' || li.classList.contains('feed-empty') || (f === 'mine' ? isMine(threads) : threads.includes(f)));
  }
  /** `items` = commsItems(...); `live` marks items that arrived after catch-up (they flash, start
   * expanded and count as unread while the rail is collapsed). Returns the newly added live items. */
  update(items, { live, you }) {
    const atBottom = this.atBottom(), added = [], fresh = [];
    for (const item of items) {
      const key = itemKey(item); if (this.keys.has(key)) continue;
      const li = this.row(item, live, you); this.keys.add(key); this.list.append(li); this.applyFilter(li); added.push(li);
      if (live) fresh.push(item);
      if (live && !this.open && !(item.type === 'message' && item.from === you)) this.count++;
    }
    while (this.list.children.length > MAX_ROWS) { this.list.firstElementChild.remove(); }
    if (!this.list.children.length) this.list.append(node('li', 'feed-empty', 'No headlines or messages yet.'));
    else if (this.list.children.length > 1) this.list.querySelector('.feed-empty')?.remove();
    if (added.length) {
      if (atBottom || !live) this.list.scrollTop = this.list.scrollHeight;
      else this.showJump(this.below + added.length);
      for (const li of added) this.measure(li.querySelector('.feed-clamp'));
    }
    this.showUnread();
    return fresh;
  }
  /** Expand or collapse one clamped text. */
  expand(clamp) {
    const open = clamp.getAttribute('aria-expanded') !== 'true';
    clamp.setAttribute('aria-expanded', String(open)); clamp.closest('.feed-row')?.classList.toggle('expanded', open);
    if (!open) this.measure(clamp);
  }
  /** Make a text a toggle only while its clamp actually hides something (or it is expanded). */
  measure(clamp) {
    if (!clamp || !clamp.isConnected || clamp.getAttribute('aria-expanded') === 'true') return;
    const clipped = clamp.scrollHeight > clamp.clientHeight + 1;
    if (clipped) { clamp.setAttribute('role', 'button'); clamp.tabIndex = 0; clamp.setAttribute('aria-expanded', 'false'); clamp.title = 'Show the full text'; }
    else { clamp.removeAttribute('role'); clamp.removeAttribute('tabindex'); clamp.removeAttribute('aria-expanded'); clamp.removeAttribute('title'); }
  }
  measureAll() { for (const clamp of this.list.querySelectorAll('.feed-clamp')) this.measure(clamp); }
  /** New rows: four lines for a moment, then the compact clamp. Reduced motion: compact at once. */
  settle(li) {
    if (reducedMotion()) return;
    li.classList.add('feed-new');
    const timer = setTimeout(() => {
      this.timers.delete(timer); const pinned = this.atBottom();
      li.classList.remove('feed-new'); this.measure(li.querySelector('.feed-clamp'));
      if (pinned) this.list.scrollTop = this.list.scrollHeight;
    }, FRESH_MS);
    this.timers.add(timer);
  }
  row(item, live, you) {
    const n = this.names, li = node('li', `feed-row${live ? ' fresh' : ''}`);
    li.dataset.feedKey = itemKey(item); li.dataset.seq = String(item.seq); li.dataset.threads = (item.threads || ['world']).join(' ');
    if (isPersonal(item, you)) { li.dataset.personal = 'true'; this.seen?.observe(li); if (!this.read.has(item.seq)) li.classList.add('unread'); }
    if (live) this.settle(li);
    // Private rows link to the card that holds their actions and conversation.
    const link = this.link?.(item);
    const open = () => { const b = node('button', 'feed-open', link.label); b.type = 'button'; b.dataset[link.key] = link.value; b.setAttribute('aria-label', link.aria || link.label); return b; };
    if (item.type === 'threat') {
      li.classList.add('feed-headline', 'feed-threat'); li.dataset.tone = 'war'; li.dataset.kind = 'threat';
      const target = node('button'); target.type = 'button'; target.dataset.feedProvince = item.to; target.title = 'Show on the map';
      const mark = node('span', 'feed-icon'); mark.innerHTML = icon('military');
      const words = node('span', 'feed-words'); words.append(node('b', '', `Incoming: ${item.amount} troops → ${n.province(item.to)}`), node('time', '', n.time(item.tick)));
      target.append(mark, words); li.append(target, node('p', 'feed-detail feed-clamp', `${n.country(item.country)} marches on ${n.province(item.to)}; arrives ${n.time(item.arrivesAt)}.`));
      return li;
    }
    if (item.type === 'message') {
      li.classList.add('feed-chat'); li.dataset.channel = item.channel || 'world';
      const header = node('header'), who = node('b', '', n.country(item.from));
      const flag = node('span', 'feed-flag'); flag.innerHTML = insignia(item.from); // authored constant SVG
      header.append(flag, who);
      if (item.channel === 'alliance') { const badge = node('span', 'feed-channel alliance', n.side(item.side) || 'Alliance'); const color = n.sideColor?.(item.side); if (color) badge.style.setProperty('--band', color); header.append(badge); }
      if (item.channel === 'dm') header.append(node('span', 'feed-channel dm', item.from === you ? `DM → ${n.country(item.with)}` : 'DM'));
      header.append(node('time', '', n.time(item.tick)));
      if (link) header.append(open());
      li.append(header, node('p', 'feed-text feed-clamp', item.text)); // player text: textContent only
      return li;
    }
    if (item.system) {
      const copy = systemCopy(item, n);
      li.classList.add('feed-headline', 'feed-system'); li.dataset.tone = copy.tone; li.dataset.kind = `system-${item.system}`;
      if (item.proposalId) li.dataset.proposal = item.proposalId; if (item.motionId) li.dataset.motion = item.motionId;
      const head = node('div'), mark = node('span', 'feed-icon'); mark.innerHTML = icon(copy.icon);
      const words = node('span', 'feed-words'); words.append(node('b', '', copy.title), node('time', '', n.time(item.tick)));
      head.append(mark, words);
      if (link) head.append(open());
      li.append(head, node('p', 'feed-detail feed-clamp', copy.detail));
      return li;
    }
    const copy = headlineCopy(item, n);
    li.classList.add('feed-headline'); li.dataset.tone = copy.tone; li.dataset.kind = item.headline.kind;
    // Alliance formed/changed/dissolved rows take that alliance's map colour (palette constant, never player text).
    const allianceTone = ['alliance', 'dissolved', 'departure'].includes(item.headline.kind) && n.sideColor?.(item.headline.side);
    if (allianceTone) { li.style.setProperty('--tone', allianceTone); li.dataset.side = item.headline.side; }
    const target = copy.focus ? node('button') : node('div');
    if (copy.focus) {
      target.type = 'button';
      if (copy.focus.province) target.dataset.feedProvince = copy.focus.province;
      else target.dataset.feedCountry = copy.focus.country;
      target.title = 'Show on the map';
    }
    const mark = node('span', 'feed-icon'); mark.innerHTML = icon(copy.icon);
    const words = node('span', 'feed-words');
    words.append(node('b', '', copy.title), node('time', '', n.time(item.tick)));
    target.append(mark, words);
    li.append(target, node('p', 'feed-detail feed-clamp', copy.detail));
    return li;
  }
}

/** Compact, non-blocking notices for things addressed to this seat (a DM, an alliance message, an
 * offer or vote waiting for you). One at a time; ≤3 s unless it carries a decision, which stays until
 * acted on or dismissed (✕, swipe up or Escape). Text only via textContent; standards are authored SVG. */
export class Notifier {
  constructor(root) {
    this.root = root; this.queue = []; this.current = null; this.timer = null;
    root.addEventListener('click', event => { if (event.target.closest('button')) setTimeout(() => this.dismiss()); });
    let startY = null;
    root.addEventListener('pointerdown', event => { startY = event.clientY; });
    root.addEventListener('pointerup', event => { if (startY !== null && startY - event.clientY > 30) this.dismiss(); startY = null; });
  }
  reset() { clearTimeout(this.timer); this.queue = []; this.current = null; this.root.hidden = true; this.root.replaceChildren(); }
  push(notice) {
    if (this.queue.some(q => q.key === notice.key) || this.current?.key === notice.key) return;
    this.queue.push(notice); while (this.queue.length > 4) this.queue.shift();
    if (!this.current) this.next();
  }
  dismiss() { if (!this.current) return false; clearTimeout(this.timer); this.next(); return true; }
  next() {
    this.current = this.queue.shift() || null; this.root.hidden = !this.current;
    if (!this.current) { this.root.replaceChildren(); return; }
    const n = this.current, card = node('div', 'notice-card'), flag = node('span', 'notice-flag');
    if (n.standard) flag.innerHTML = insignia(n.standard); // authored SVG
    const words = node('div', 'notice-words'); words.append(node('b', 'notice-title', n.title), node('span', 'notice-detail', n.detail || ''));
    const close = node('button', 'notice-close', '✕'); close.type = 'button'; close.dataset.noticeClose = ''; close.setAttribute('aria-label', 'Dismiss notice');
    card.append(flag, words);
    if (n.buttons?.length) {
      const row = node('div', 'notice-actions');
      for (const b of n.buttons) { const button = node('button', b.primary ? 'primary' : '', b.label); button.type = 'button'; for (const [k, v] of Object.entries(b.data)) button.dataset[k] = v; row.append(button); }
      card.append(row);
    }
    card.append(close); this.root.replaceChildren(card); this.root.dataset.kind = n.kind || '';
    if (!n.sticky) this.timer = setTimeout(() => this.next(), 3000);
  }
}

const PRIORITY = { fallen: 3, war: 3, peace: 3, alliance: 3, defeat: 4, dominance: 2, broken: 2, battle: 1 };
// Headlines naming the viewer's own country outrank the rest of the world's news.
const rank = b => (PRIORITY[b.kind] ?? 0) + (b.mine ? 2 : 0);
/** One queue for every banner so simultaneous headlines never overlap. The most important
 * waiting banner shows next (oldest first within a rank). Bounded: when full, the least
 * important, then oldest, waiting banner is dropped; the feed still lists it. */
export class Herald {
  constructor(elements) { this.el = elements; this.queue = []; this.timer = null; this.current = null; }
  reset() {
    clearTimeout(this.timer); this.timer = null; this.queue = []; this.current = null;
    for (const element of Object.values(this.el)) element.hidden = true;
  }
  push(banner) {
    this.queue.push(banner);
    while (this.queue.length > MAX_QUEUE) {
      const lowest = Math.min(...this.queue.map(rank));
      this.queue.splice(this.queue.findIndex(b => rank(b) === lowest), 1);
    }
    if (!this.current) this.next();
  }
  next() {
    for (const element of Object.values(this.el)) element.hidden = true;
    const top = Math.max(...this.queue.map(rank));
    this.current = this.queue.length ? this.queue.splice(this.queue.findIndex(b => rank(b) === top), 1)[0] : null;
    if (!this.current) return;
    const b = this.current, target = b.kind === 'alliance' ? this.alliance(b) : b.kind === 'fallen' || b.kind === 'defeat' ? this.fallen(b) : this.decree(b);
    target.dataset.seq = String(b.seq ?? ''); // which headline is showing (tests assert no stale replay)
    target.hidden = false; target.style.animation = 'none'; void target.offsetWidth; target.style.animation = '';
    // Brief (≤3 s) and shorter when more is waiting, so a burst does not lag behind the board.
    const duration = (b.kind === 'battle' ? 2600 : 3000) * (this.queue.length > 1 ? .7 : 1);
    target.style.setProperty('--banner-duration', `${duration}ms`);
    this.timer = setTimeout(() => this.next(), duration);
  }
  /** Escape (or a new room) dismisses the current banner at once; the next waiting one follows. */
  dismiss() { if (!this.current) return false; clearTimeout(this.timer); this.next(); return true; }
  decree(b) {
    const box = this.el.declaration;
    box.className = `declaration ${b.kind}`;
    box.querySelector('#declaration-kind').textContent = b.label;
    box.querySelector('#declaration-title').textContent = b.title;
    box.querySelector('#declaration-detail').textContent = b.detail;
    return box;
  }
  alliance(b) {
    const box = this.el.alliance, standards = box.querySelector('#alliance-standards');
    standards.replaceChildren(...b.countries.map((c, i) => {
      const figure = node('figure', 'alliance-standard');
      // Spread outward, then draw together. Final (reduced-motion) position is the base style.
      figure.style.setProperty('--from', `${Math.round((i - (b.countries.length - 1) / 2) * 90 + (i < b.countries.length / 2 ? -80 : 80))}px`);
      figure.innerHTML = insignia(c.id); // authored constant SVG, never player text
      figure.append(node('figcaption', '', c.name));
      return figure;
    }));
    box.querySelector('#alliance-name').textContent = b.name; // player text: textContent only
    box.querySelector('#alliance-members').textContent = b.countries.map(c => c.name).join(' + ');
    return box;
  }
  fallen(b) {
    const box = this.el.fallen;
    box.classList.toggle('own', b.kind === 'defeat');
    box.querySelector('#fallen-insignia').innerHTML = insignia(b.country); // authored constant SVG
    box.querySelector('#fallen-name').textContent = b.name;
    box.querySelector('#fallen-kind').textContent = b.kind === 'defeat' ? 'DEFEAT' : 'A POWER HAS FALLEN';
    box.querySelector('#fallen-title').textContent = b.title;
    box.querySelector('#fallen-detail').textContent = b.detail;
    return box;
  }
}

/** Banner and map-effect plan for one live headline. Only headlines that directly affect the viewer
 * (affectsViewer) get a banner; the rest are rail rows with their map effect. `viewer` is viewerOf(). */
export function presentHeadline(item, names, viewer = {}) {
  if (typeof viewer === 'string' || viewer === null) viewer = { you: viewer };
  const you = viewer.you ?? null;
  const h = item.headline, copy = headlineCopy(item, names);
  const effects = [];
  let banner = null;
  switch (h.kind) {
    case 'war': banner = { kind: 'war', label: 'THE COUNCIL’S SEAL', title: 'WAR DECLARED', detail: `${copy.detail.replace(/\.$/, '')}. Both sides may now attack.` };
      effects.push(['war', { from: h.from, to: h.to }]); break;
    case 'peace': banner = { kind: 'peace', label: 'TREATY RATIFIED', title: 'PEACE AGREED', detail: `${copy.detail.replace(/\.$/, '')}. Attacking armies are returning.` };
      effects.push(['peace', { from: h.from, to: h.to }]); break;
    case 'alliance': banner = { kind: 'alliance', name: item.name ?? names.side(h.side), countries: h.countries.map(id => ({ id, name: names.country(id) })) };
      effects.push(['alliance', { countries: h.countries }]); break;
    case 'departure': case 'dissolved': banner = { kind: 'broken', label: 'COUNCIL DISPATCH', title: copy.title.toUpperCase(), detail: copy.detail }; break;
    case 'eliminated': {
      const own = h.country === you;
      banner = { kind: own ? 'defeat' : 'fallen', country: h.country, name: names.country(h.country),
        title: own ? 'Your country has fallen' : copy.title,
        detail: own ? `${names.country(h.country)} has no provinces or armies left. Your earned share is frozen; you may keep watching the council.` : copy.detail };
      effects.push(['eliminated', { country: h.country }]); break;
    }
    case 'dominance': banner = { kind: 'dominance', label: 'VICTORY COUNTDOWN', title: `${names.side(h.side).toUpperCase()} HOLDS 60%`, detail: copy.detail }; break;
    case 'major_battle': banner = { kind: 'battle', label: 'MAJOR BATTLE', title: copy.title, detail: `${h.casualties} troops lost${h.captured ? ` · ${h.owner ? names.country(h.owner) : 'nobody'} takes ${names.province(h.province)}` : ' · defenders hold'}.` };
      if (h.captured && h.owner) effects.push(['captured', { province: h.province, owner: h.owner }]); break;
    case 'industry_up': effects.push(['industry_up', { province: h.province, level: h.level }]); break;
    case 'industry_down': effects.push(['industry_down', { province: h.province, level: h.level }]); break;
    default: break;
  }
  if (banner && !affectsViewer(item, viewer)) banner = null;
  if (banner) {
    banner.seq = item.seq ?? item.id;
    banner.mine = Boolean(you) && [h.from, h.to, h.countries, [h.country, h.owner, h.previousOwner]].flat().includes(you);
  }
  return { banner, effects };
}
