/** v0.6 World feed panel and headline banners. Presentation only: no rules, no orders.
 * Headlines come from the engine's `event.headline`; this module never reclassifies them.
 * Player text (chat, alliance names) is written with textContent only.
 */
import { feedItems, headlineCopy } from './feed-model.js';
import { icon, insignia } from './presentation.js';

const MAX_ROWS = 150, MAX_QUEUE = 5;
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const itemKey = item => item.id === null ? `b${item.seq}:${item.side}` : `e${item.id}`;

/** Chronological public feed. Rows are appended, never re-rendered, so focus and
 * screen-reader position survive polling. */
export class WorldFeed {
  constructor({ list, unread, toggle, body }, names) {
    Object.assign(this, { list, unread, toggle, body, names });
    this.keys = new Set(); this.count = 0; this.lastSeq = 0; this.caughtUp = false;
  }
  reset() { this.list.replaceChildren(); this.keys.clear(); this.count = 0; this.lastSeq = 0; this.caughtUp = false; this.showUnread(); }
  get open() { return this.toggle.getAttribute('aria-expanded') === 'true'; }
  setOpen(open) {
    this.toggle.setAttribute('aria-expanded', String(open)); this.body.hidden = !open;
    this.toggle.closest('.world-feed')?.classList.toggle('collapsed', !open);
    if (open) { this.count = 0; this.showUnread(); this.list.scrollTop = this.list.scrollHeight; }
  }
  showUnread() {
    this.unread.textContent = this.count ? String(this.count) : '';
    this.unread.setAttribute('aria-label', this.count ? `${this.count} unread` : '');
  }
  /** `live` marks items that arrived after catch-up: only those count as unread or flash. */
  update(events, breaks, { live, you }) {
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    let added = 0;
    for (const item of feedItems(events, breaks)) {
      const key = itemKey(item); if (this.keys.has(key)) continue;
      this.keys.add(key); this.list.append(this.row(item, live)); added++;
      if (live && !this.open && !(item.type === 'message' && item.from === you)) this.count++;
    }
    while (this.list.children.length > MAX_ROWS) { this.list.firstElementChild.remove(); }
    if (!this.list.children.length) this.list.append(node('li', 'feed-empty', 'No headlines or public messages yet.'));
    else this.list.querySelector('.feed-empty')?.remove();
    if (added && (atBottom || !live)) this.list.scrollTop = this.list.scrollHeight;
    this.showUnread();
  }
  row(item, live) {
    const n = this.names, li = node('li', `feed-row${live ? ' fresh' : ''}`);
    li.dataset.feedKey = itemKey(item);
    if (!item.headline) {
      li.classList.add('feed-chat');
      const header = node('header'), who = node('b', '', n.country(item.from));
      const flag = node('span', 'feed-flag'); flag.innerHTML = insignia(item.from); // authored constant SVG
      header.append(flag, who, node('time', '', n.time(item.tick)));
      li.append(header, node('p', 'feed-text', item.text));
      return li;
    }
    const copy = headlineCopy(item, n);
    li.classList.add('feed-headline'); li.dataset.tone = copy.tone; li.dataset.kind = item.headline.kind;
    const target = copy.focus ? node('button') : node('div');
    if (copy.focus) {
      target.type = 'button';
      if (copy.focus.province) target.dataset.feedProvince = copy.focus.province;
      else target.dataset.feedCountry = copy.focus.country;
      target.title = 'Show on the map';
    }
    const mark = node('span', 'feed-icon'); mark.innerHTML = icon(copy.icon);
    const words = node('span', 'feed-words');
    const title = node('b', '', copy.title);
    words.append(title, node('time', '', n.time(item.tick)), node('span', 'feed-detail', copy.detail));
    target.append(mark, words); li.append(target);
    return li;
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
    // Shorter when more is waiting, so a burst does not lag far behind the board.
    const duration = (b.kind === 'battle' ? 3200 : b.kind === 'alliance' || b.kind === 'fallen' || b.kind === 'defeat' ? 4800 : 4400) * (this.queue.length > 1 ? .7 : 1);
    target.style.setProperty('--banner-duration', `${duration}ms`);
    this.timer = setTimeout(() => this.next(), duration);
  }
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

/** Banner and map-effect plan for one live headline. Low-importance items return no banner. */
export function presentHeadline(item, names, you) {
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
  if (banner) {
    banner.seq = item.seq ?? item.id;
    banner.mine = Boolean(you) && [h.from, h.to, h.countries, [h.country, h.owner, h.previousOwner]].flat().includes(you);
  }
  return { banner, effects };
}
