/** v0.6 headline banners (Herald) and the banner/effect plan for live headlines. Presentation only.
 * v0.9: the history rail and the notice stack moved into Messages (comms.js); this module keeps the banners.
 * Headlines come from the engine's `event.headline`; this module never reclassifies them.
 * Player text (alliance names) is written with textContent only.
 */
import { headlineCopy, affectsViewer } from './feed-model.js';
import { insignia } from './presentation.js';

const MAX_QUEUE = 5;
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
    box.className = `declaration herald ${b.kind}`;
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
    box.querySelector('#fallen-kind').textContent = b.kind === 'defeat' ? 'Defeat' : 'A power has fallen';
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
    case 'war': banner = { kind: 'war', label: 'Declaration', title: 'War declared', detail: `${copy.detail.replace(/\.$/, '')}. Both sides may now attack.` };
      effects.push(['war', { from: h.from, to: h.to }]); break;
    case 'peace': banner = { kind: 'peace', label: 'Treaty', title: 'Peace agreed', detail: `${copy.detail.replace(/\.$/, '')}. Attacking armies are returning.` };
      effects.push(['peace', { from: h.from, to: h.to }]); break;
    case 'alliance': banner = { kind: 'alliance', name: item.name ?? names.side(h.side), countries: h.countries.map(id => ({ id, name: names.country(id) })) };
      effects.push(['alliance', { countries: h.countries }]); break;
    case 'departure': case 'dissolved': banner = { kind: 'broken', label: 'Dispatch', title: copy.title, detail: copy.detail }; break;
    case 'eliminated': {
      const own = h.country === you;
      banner = { kind: own ? 'defeat' : 'fallen', country: h.country, name: names.country(h.country),
        title: own ? 'Your country has fallen' : copy.title,
        detail: own ? `${names.country(h.country)} has no provinces or armies left. Your earned share is frozen; you may keep watching the council.` : copy.detail };
      effects.push(['eliminated', { country: h.country }]); break;
    }
    case 'dominance': banner = { kind: 'dominance', label: 'Victory countdown', title: `${names.side(h.side)} holds 60%`, detail: copy.detail }; break;
    case 'major_battle': banner = { kind: 'battle', label: 'Major battle', title: copy.title, detail: `${h.casualties} troops lost${h.captured ? ` · ${h.owner ? names.country(h.owner) : 'nobody'} takes ${names.province(h.province)}` : ' · defenders hold'}.` };
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
