import { journeyPoint } from './movement.js';
import { borderNetwork, insideRings, provinceRings } from './map-geometry.js';
/** Presentation only: the server decides every movement, battle and ownership change.
 * Every SVG fragment below is an authored constant; player text never enters map markup.
 */
const NS = 'http://www.w3.org/2000/svg';
function node(tag, attributes = {}) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
/** Decorative on-map effects other modules may request with `atlas.effect(kind, data)`. */
export const MAP_EFFECTS = Object.freeze(['industry_up', 'industry_down', 'captured', 'alliance', 'war', 'peace', 'eliminated']);
/** Level of detail by on-screen pixels per map unit: country totals, merged counters, every province. */
export const LOD = Object.freeze({ far: 1.2, near: 2.6 });
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const NEUTRAL = '#a5a28c', ALLIANCE = '#f6d77f', COUNTER_H = 21, PAD = 3;
const SWORDS = 'M-6-6L5 5M2.4 6.6L6.6 2.4M6-6L-5 5M-6.6 2.4L-2.4 6.6';
const FACTORY = 'M-8 7V-1l4.5 3V-1l4.5 3V-7h3.5V7Z';
const CRACK = 'M-2-9l3 5-3 3 4 3-2 7';
const counterWidth = troops => Math.max(32, String(troops).length * 7 + 15);
const networks = new WeakMap();
/** World width in map units: the map repeats horizontally at this period. */
export const WORLD = 1280;
let instances = 0;
/** Shortest horizontal offset from a to b across the wrap. */
export const wrapDelta = dx => dx - WORLD * Math.round(dx / WORLD);
export class Atlas {
  constructor(svg, map, onSelect) {
    this.svg = svg; this.map = map; this.onSelect = onSelect;
    this.positionsById = Object.fromEntries(map.provinces.map(p => [p.id, { x: p.x, y: p.y }]));
    this.places = new Map(map.provinces.map(p => [p.id, p]));
    this.rings = new Map(map.provinces.map(p => [p.id, provinceRings(p.path)]));
    this.countries = new Map(map.countries.map(c => [c.id, c]));
    this.landNeighbors = new Map(map.provinces.map(p => [p.id, []]));
    for (const e of map.edges) if (!e.sea) { this.landNeighbors.get(e.from)?.push(e.to); this.landNeighbors.get(e.to)?.push(e.from); }
    this.view = { x: 0, y: 0, w: 1280, h: 680 };
    this.shapes = new Map(); this.prefix = svg.id === 'map' ? '' : `${svg.id}-`;
    this.markers = new Map(); this.armies = new Map(); this.pointers = new Map();
    this.clusters = new Map(); this.battleMarks = new Map(); this.seenRounds = new Map();
    this.lastOwned = new Map(); this.timers = new Set(); this.pointEffects = new Set();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    svg.replaceChildren(); svg.classList.add('atlas-v6');
    if (!svg.id) svg.id = `atlas-${++instances}`;
    // Horizontal wraparound: every world-space layer lives once in `base` (under counters) or
    // `top` (routes, armies, effects); two <use> copies repeat each at ±WORLD. <use> shadow
    // trees add no document IDs. Counters stay single, interactive and placed on the copy
    // nearest the view centre.
    this.base = node('g', { id: `${svg.id}-world-base` }); this.top = node('g', { id: `${svg.id}-world-top`, 'pointer-events': 'none' });
    const defs = node('defs');
    defs.innerHTML = '<radialGradient id="ocean-light"><stop stop-color="#284d59"/><stop offset="1" stop-color="#112833"/></radialGradient><marker id="march-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#f2d59b"/></marker>';
    defs.innerHTML = defs.innerHTML.replaceAll('ocean-light', `${this.prefix}ocean-light`).replaceAll('march-head', `${this.prefix}march-head`);
    svg.append(defs, node('rect', { x: -1800, y: -1000, width: 4800, height: 3000, fill: `url(#${this.prefix}ocean-light)` }));
    const grid = node('g', { class: 'atlas-grid', 'pointer-events': 'none' }), meridians = node('g', { class: 'atlas-grid', 'pointer-events': 'none' });
    for (let x = 0; x < WORLD; x += WORLD / 10) meridians.append(node('path', { d: `M${x},-800V1600` }));
    for (let y = 0; y <= 680; y += 92) grid.append(node('path', { d: `M-3000,${y}H4300` }));
    svg.append(grid); this.base.append(meridians);
    const oceans = node('g', { class: 'ocean-names', 'pointer-events': 'none' });
    for (const [label, x, y] of [['NORTH ATLANTIC', 435, 235], ['SOUTH ATLANTIC', 525, 485], ['PACIFIC OCEAN', 105, 380], ['INDIAN OCEAN', 830, 487]]) {
      const text = node('text', { x, y }); text.textContent = label; oceans.append(text);
    }
    this.base.append(oceans); this.seas = node('g', { class: 'sea-connections', 'pointer-events': 'none' });
    for (const edge of map.edges.filter(e => e.sea)) this.seas.append(node('path', { d: this.path(edge.from, edge.to), 'data-edge': `${edge.from}|${edge.to}` }));
    this.base.append(this.seas);
    // Borders are classified once per map: shared province edges versus coastline.
    if (!networks.has(map)) networks.set(map, borderNetwork(map));
    const network = networks.get(map), coast = [...network.coast.values()].flat().join('');
    this.base.append(node('path', { d: coast, class: 'coast-shelf', 'pointer-events': 'none' }));
    this.territories = node('g');
    for (const p of map.provinces) {
      const shape = node('path', { d: p.path, id: `${this.prefix}province-${p.id}`, 'data-province': p.id, class: 'province', fill: '#b9b6a3' });
      this.territories.append(shape); this.shapes.set(p.id, shape);
    }
    this.base.append(this.territories);
    // Fine engraved land grain, authored once. No raster textures or per-frame filters.
    const hatch = node('pattern', { id: `${this.prefix}land-grain`, width: 5, height: 5, patternUnits: 'userSpaceOnUse' });
    hatch.append(node('circle', { cx: 1, cy: 1, r: .45, fill: '#132832', opacity: .22 })); defs.append(hatch); this.grain = hatch;
    this.base.append(node('path', { d: map.provinces.map(p => p.path).join(' '), fill: `url(#${this.prefix}land-grain)`, 'pointer-events': 'none' }));
    this.provinceBorders = node('g', { class: 'province-borders', 'pointer-events': 'none' });
    this.countryBorders = node('g', { class: 'country-borders', 'pointer-events': 'none' });
    this.borders = network.borders.map(b => { const el = node('path', { d: b.d, 'data-border': `${b.a}|${b.b}` }); this.provinceBorders.append(el); return { ...b, el, country: false }; });
    this.base.append(this.provinceBorders, this.countryBorders, node('path', { d: coast, class: 'coastline', 'pointer-events': 'none' }));
    const compass = node('g', { 'aria-hidden': 'true', 'pointer-events': 'none', transform: 'translate(110 560)', opacity: .38, stroke: '#ddc591', fill: 'none' });
    compass.append(node('circle', { r: 27, 'stroke-width': .7 }), node('circle', { r: 22, 'stroke-width': .4 }), node('path', { d: 'M0-40L6-6 40 0 6 6 0 40-6 6-40 0-6-6Z', 'stroke-width': .8 }), node('path', { d: 'M0-40V0H-40L-6-6Z', fill: '#ddc591', 'stroke-width': .4 }));
    const north = node('text', { y: -46, 'text-anchor': 'middle', stroke: 'none', fill: '#eed9ac', 'font-size': 12, 'font-family': 'Georgia' }); north.textContent = 'N'; compass.append(north); this.base.append(compass);
    this.areaEffects = node('g', { class: 'map-effects map-area-effects', 'aria-hidden': 'true', 'pointer-events': 'none' });
    this.countryNames = node('g', { class: 'country-names', 'pointer-events': 'none', 'aria-hidden': 'true' });
    this.connections = node('g', { 'pointer-events': 'none' }); this.routes = node('g', { 'pointer-events': 'none' }); this.marches = node('g', { 'pointer-events': 'none' });
    this.trails = node('g', { 'pointer-events': 'none' }); this.base.append(this.areaEffects);
    this.top.append(this.connections, this.routes, this.trails, this.marches);
    this.leaders = node('g', { class: 'counter-leaders', 'pointer-events': 'none', 'aria-hidden': 'true' });
    const markers = node('g', { class: 'map-counters' });
    for (const p of map.provinces) {
      const group = node('g', { id: `${this.prefix}marker-${p.id}`, 'data-province': p.id, tabindex: 0, role: 'button', class: 'map-counter' });
      const disc = node('rect', { x: -16, y: -10, width: 32, height: COUNTER_H, rx: 1, class: 'counter-body' }); const text = node('text', { x: 2, y: .5, class: 'counter-value', id: `${this.prefix}troops-${p.id}` });
      const stripe = node('rect', { x: -16, y: -10, width: 4, height: COUNTER_H, class: 'counter-stripe' });
      const label = node('text', { y: -17, class: 'province-name' }); label.textContent = p.name;
      const industry = node('g', { class: 'industry-pips', 'aria-hidden': 'true' }); group.append(industry);
      group.append(disc, stripe, text, label); markers.append(group); this.markers.set(p.id, { group, disc, stripe, text, label, industry });
    }
    this.clusterLayer = node('g', { class: 'map-clusters' }); this.battleLayer = node('g', { class: 'map-battles' });
    this.effects = node('g', { class: 'map-effects', 'aria-hidden': 'true', 'pointer-events': 'none' });
    this.top.append(this.effects);
    const copies = layer => [-WORLD, WORLD].map(x => node('use', { href: `#${layer.id}`, x, class: 'world-copy', 'aria-hidden': 'true', ...(layer === this.top ? { 'pointer-events': 'none' } : {}) }));
    svg.append(...copies(this.base), this.base, ...copies(this.top), this.top, this.countryNames, this.leaders, markers, this.clusterLayer, this.battleLayer);
    this.tooltip = document.createElement('div'); this.tooltip.className = 'atlas-tooltip'; this.tooltip.hidden = true; svg.parentElement.append(this.tooltip);
    svg.addEventListener('contextmenu', event => event.preventDefault());
    svg.addEventListener('wheel', event => { event.preventDefault(); this.zoom(event.deltaY > 0 ? 1.12 : .89, event.clientX, event.clientY); }, { passive: false });
    svg.addEventListener('pointerdown', event => this.down(event));
    svg.addEventListener('pointermove', event => this.move(event));
    svg.addEventListener('pointerup', event => this.up(event));
    svg.addEventListener('pointercancel', event => { this.pointers.delete(event.pointerId); this.gesture = null; this.dragged = true; });
    svg.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
    if (!svg.hasAttribute('tabindex')) svg.setAttribute('tabindex', 0);
    svg.addEventListener('keydown', event => {
      // Arrow keys pan (wrapping east–west); never while typing, since only map elements listen.
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (step) { event.preventDefault(); this.pan(step[0] * this.view.w * .15, step[1] * this.view.h * .15); return; }
      if (!['Enter', ' '].includes(event.key)) return;
      const cluster = event.target.closest('[data-cluster]')?.dataset.cluster;
      const id = event.target.closest('[data-province]')?.dataset.province;
      if (cluster) { event.preventDefault(); this.fit(cluster.split(',')); }
      else if (id) { event.preventDefault(); onSelect(id, { shiftKey: event.shiftKey }); }
    });
    this.resize = new ResizeObserver(() => this.applyView()); this.resize.observe(svg);
    this.applyView();
  }
  path(from, to) {
    return this.pointPath(this.places.get(from), this.places.get(to));
  }
  /** One segment, the short way round; the repeated copies show the part past the seam. */
  pointPath(a, b) {
    return `M${a.x},${a.y}L${a.x + wrapDelta(b.x - a.x)},${b.y}`;
  }
  coordinates(clientX, clientY) {
    const transform = this.svg.getScreenCTM();
    return transform ? new DOMPoint(clientX, clientY).matrixTransform(transform.inverse()) : { x: 0, y: 0 };
  }
  down(event) {
    if (event.button !== 0 && event.button !== 2) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.svg.setPointerCapture(event.pointerId);
    if (this.pointers.size === 1) {
      this.gesture = { x: event.clientX, y: event.clientY, vx: this.view.x, vy: this.view.y,
        ...this.hit(event), shiftKey: event.shiftKey, target: event.button === 2 }; this.dragged = false;
    } else { this.dragged = true; this.gesture = null; this.pinchDistance = this.distance(); }
    this.tooltip.hidden = true;
  }
  distance() { const [a, b] = this.pointers.values(); return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
  move(event) {
    if (!this.pointers.has(event.pointerId)) { this.hover(event); return; }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const points = [...this.pointers.values()], distance = this.distance();
      if (this.pinchDistance && distance) this.zoom(this.pinchDistance / distance, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
      this.pinchDistance = distance; return;
    }
    if (!this.gesture) return;
    const dx = event.clientX - this.gesture.x, dy = event.clientY - this.gesture.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) this.dragged = true;
    if (this.dragged) {
      const scale = this.svg.getScreenCTM()?.a || 1;
      this.view.x = this.gesture.vx - dx / scale; this.view.y = this.gesture.vy - dy / scale; this.applyView();
    }
  }
  up(event) {
    const gesture = this.gesture; this.pointers.delete(event.pointerId);
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    if (!this.dragged && gesture?.cluster) this.fit(gesture.cluster.split(','));
    else if (!this.dragged && gesture?.id) this.onSelect(gesture.id, { shiftKey: gesture.shiftKey, target: gesture.target });
    if (!this.pointers.size) this.gesture = null;
  }
  /** What a pointer event is on. A click on a repeated world copy resolves to the same province. */
  hit(event) {
    const el = event.target, cluster = el.closest?.('[data-cluster]')?.dataset.cluster;
    let id = el.closest?.('[data-province]')?.dataset.province;
    if (!id && !cluster && el.closest?.('use.world-copy')) id = this.provinceAt(this.coordinates(event.clientX, event.clientY));
    return { cluster, id };
  }
  provinceAt(point) {
    const x = ((point.x % WORLD) + WORLD) % WORLD;
    for (const [id, rings] of this.rings) if (insideRings([x, point.y], rings)) return id;
    return null;
  }
  /** The x of the repeated copy nearest the view centre. */
  near(x) { const cx = this.view.x + this.view.w / 2; return cx + wrapDelta(x - cx); }
  pan(dx, dy) { this.view.x += dx; this.view.y += dy; this.applyView(); }
  hover(event) {
    const { cluster, id } = this.hit(event);
    const p = this.byId?.get(id);
    let title, detail;
    if (cluster && this.state) {
      const members = cluster.split(',').map(id => this.byId.get(id)).filter(Boolean);
      title = this.countries.get(members[0]?.owner)?.name || 'Uncontrolled';
      detail = `${members.length} provinces · ${members.reduce((n, p) => n + p.troops, 0)} troops · click to zoom in`;
    } else if (p) {
      title = this.places.get(id).name;
      const battle = this.battleInfo?.get(id);
      detail = battle ? `Battle in progress · attackers ${battle.attack} vs defenders ${battle.defend}` :
        `${this.countries.get(p.owner)?.name || 'Uncontrolled'} · ${p.troops} troops · industry ${p.development}`;
    } else { this.tooltip.hidden = true; return; }
    this.tooltip.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = title;
    const span = document.createElement('span'); span.textContent = detail;
    this.tooltip.append(strong, span); this.tooltip.hidden = false;
    const rect = this.svg.parentElement.getBoundingClientRect();
    this.tooltip.style.left = `${clamp(event.clientX - rect.left + 14, 8, rect.width - 260)}px`;
    this.tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 65)}px`;
  }
  applyView() {
    // Never more than one world width on screen, so each province and counter is seen once.
    const rect = this.svg.getBoundingClientRect(), aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 0;
    const visible = Math.max(this.view.w, this.view.h * aspect);
    if (visible > WORLD) {
      const k = WORLD / visible, cx = this.view.x + this.view.w / 2, cy = this.view.y + this.view.h / 2;
      this.view = { x: cx - this.view.w * k / 2, y: cy - this.view.h * k / 2, w: this.view.w * k, h: this.view.h * k };
    }
    // Wrap: keep the view centre inside [0, WORLD); an active drag follows the same shift.
    const shift = WORLD * Math.floor((this.view.x + this.view.w / 2) / WORLD);
    if (shift) { this.view.x -= shift; if (this.gesture) this.gesture.vx -= shift; }
    this.view.y = clamp(this.view.y, -this.view.h * .35, 680 - this.view.h * .65);
    this.svg.setAttribute('viewBox', `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    this.requestLayout();
  }
  requestLayout() {
    if (!this.layoutFrame) this.layoutFrame = requestAnimationFrame(() => { this.layoutFrame = null; this.layout(); });
  }
  zoom(factor, clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const anchor = this.coordinates(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2);
    const w = clamp(this.view.w * factor, 135, WORLD), ratio = w / this.view.w;
    this.view = { x: anchor.x - (anchor.x - this.view.x) * ratio, y: anchor.y - (anchor.y - this.view.y) * ratio, w, h: this.view.h * ratio };
    this.applyView();
  }
  world() { this.view = { x: 0, y: 0, w: 1280, h: 680 }; this.applyView(); }
  europe() { this.view = { x: 595, y: 105, w: 210, h: 111.6 }; this.applyView(); }
  focus(id) { const p = this.places.get(id); if (!p) return; this.view = { x: p.x - 195, y: p.y - 104, w: 390, h: 208 }; this.applyView(); }
  home(country) { const c = this.countries.get(country); if (c) this.focus(c.start[0]); }
  /** Zoom so every listed province anchor is in view (a cluster's members). */
  fit(ids) {
    const points = ids.map(id => this.places.get(id)).filter(Boolean);
    if (!points.length) return;
    const xs = points.map(p => points[0].x + wrapDelta(p.x - points[0].x)), ys = points.map(p => p.y), pad = Math.max(40, (Math.max(...xs) - Math.min(...xs)) * .2, (Math.max(...ys) - Math.min(...ys)) * .3);
    const w = clamp(Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, (Math.max(...ys) - Math.min(...ys) + pad * 2) * 1280 / 680), 135, 1450);
    // Always zoom in at least one step, so a click on a merged counter is never a dead end.
    const width = Math.min(w, this.view.w * .7), h = width * 680 / 1280;
    this.view = { x: (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - h / 2, w: width, h };
    this.applyView();
  }
  level(px) { return px < LOD.far ? 'far' : px < LOD.near ? 'mid' : 'near'; }
  /** Units to draw before screen placement: single provinces, or same-owner merges. */
  units(level, px) {
    const state = this.state, locked = id => this.battleInfo.has(id) || id === this.source || id === this.destination;
    const single = p => ({ members: [p.id], owner: p.owner || null, x: this.near(this.places.get(p.id).x), y: this.places.get(p.id).y, troops: p.troops, locked: locked(p.id) });
    let units = [];
    if (level === 'far') {
      // Country aggregation: one counter per contiguous same-owner land region.
      const seen = new Set();
      for (const p of state.provinces) {
        if (seen.has(p.id)) continue;
        if (locked(p.id)) { seen.add(p.id); units.push(single(p)); continue; }
        const members = [], queue = [p.id]; seen.add(p.id);
        while (queue.length) {
          const id = queue.shift(); members.push(id);
          for (const n of this.landNeighbors.get(id) || []) {
            const q = this.byId.get(n);
            if (q && !seen.has(n) && !locked(n) && (q.owner || null) === (p.owner || null)) { seen.add(n); queue.push(n); }
          }
        }
        const mx = members.reduce((n, id) => n + this.places.get(id).x, 0) / members.length, my = members.reduce((n, id) => n + this.places.get(id).y, 0) / members.length;
        const anchor = members.map(id => this.places.get(id)).sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my) || a.id.localeCompare(b.id))[0];
        units.push({ members, owner: p.owner || null, x: this.near(anchor.x), y: anchor.y, troops: members.reduce((n, id) => n + this.byId.get(id).troops, 0), locked: false });
      }
    } else units = state.provinces.map(single);
    if (level === 'near') return units;
    // Screen-space merge: a counter joins an overlapping counter of the SAME owner only.
    const touching = (c, u) => !c.locked && !u.locked && c.owner === u.owner &&
      Math.abs(c.x - u.x) * px < (counterWidth(c.troops) + counterWidth(u.troops)) / 2 + 10 && Math.abs(c.y - u.y) * px < COUNTER_H + 8;
    let merged = [...units].sort((a, b) => this.rank(b) - this.rank(a) || a.members[0].localeCompare(b.members[0])).map(u => ({ ...u, members: [...u.members] }));
    // Repeat until stable: a grown cluster may now touch another cluster of the same owner.
    for (let changed = true, pass = 0; changed && pass < 6; pass++) {
      changed = false; const next = [];
      for (const u of merged) {
        const into = next.find(c => touching(c, u));
        if (into) { into.members.push(...u.members); into.troops += u.troops; changed = true; } else next.push(u);
      }
      merged = next;
    }
    return merged;
  }
  rank(u) {
    const id = u.members[0];
    return (this.battleInfo?.has(id) ? 4e6 : 0) + (u.locked ? 2e6 : 0) + (u.owner && u.owner === this.state?.you ? 1e6 : 0) + (u.owner ? 5e5 : 0) + u.troops;
  }
  layout() {
    const matrix = this.svg.getScreenCTM(); if (!matrix || matrix.a <= 0) return;
    const px = matrix.a, scale = 1 / px, level = this.level(px);
    this.grain.setAttribute('patternTransform', `scale(${scale})`);
    this.svg.dataset.lod = level; this.svg.classList.toggle('atlas-zoomed', level === 'near');
    for (const fx of this.pointEffects) fx.g.setAttribute('transform', `translate(${fx.x} ${fx.y}) scale(${scale})`);
    if (!this.state) {
      for (const p of this.map.provinces) this.markers.get(p.id).group.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${scale})`);
      return;
    }
    const units = this.units(level, px).sort((a, b) => this.rank(b) - this.rank(a) || a.members[0].localeCompare(b.members[0]));
    // Deterministic screen placement: keep each counter at its anchor, or nudge it outward
    // until it overlaps nothing already placed; a leader line points back to the anchor.
    const placed = [], leaders = [], offsets = [[0, 0]];
    for (let ring = 1; ring <= 16; ring++) for (let k = 0; k < 12; k++) {
      const angle = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6;
      offsets.push([Math.round(Math.cos(angle) * ring * 9), Math.round(Math.sin(angle) * ring * 9)]);
    }
    const hits = r => placed.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    for (const u of units) {
      const battle = u.members.length === 1 && this.battleInfo.get(u.members[0]);
      // Zoomed in, the footprint also reserves the industry pips below the counter.
      const badge = u.members.length > 1 ? 4 : 0, pips = level === 'near' && !battle && u.members.length === 1 ? 8 : 0;
      const titled = battle && level !== 'far';
      u.w = battle ? Math.max(battle.width + 6, titled ? this.places.get(u.members[0]).name.length * 5.8 + 4 : 0) : counterWidth(u.troops) + badge * 1.5;
      u.h = (battle ? 32 : COUNTER_H) + badge + pips + (titled ? 14 : 0);
      const top = -(battle ? (titled ? 30 : 16) : COUNTER_H / 2) - badge;
      let spot = offsets[0];
      for (const offset of offsets) {
        const r = { x: u.x * px + offset[0] - u.w / 2 - PAD / 2, y: u.y * px + offset[1] + top - PAD / 2, w: u.w + PAD, h: u.h + PAD };
        if (!hits(r)) { spot = offset; break; }
      }
      u.dx = spot[0]; u.dy = spot[1];
      u.rect = { x: u.x * px + u.dx - u.w / 2 - PAD / 2, y: u.y * px + u.dy + top - PAD / 2, w: u.w + PAD, h: u.h + PAD };
      placed.push(u.rect);
      if (Math.hypot(u.dx, u.dy) > 3) leaders.push(`M${u.x},${u.y}L${u.x + u.dx * scale},${u.y + u.dy * scale}`);
    }
    this.leaders.replaceChildren();
    if (leaders.length) this.leaders.append(node('path', { d: leaders.join(''), class: 'counter-leader' }));
    // Paint: single provinces reuse their persistent, focusable counters; merges get cluster counters.
    const shownMarkers = new Set(), usedClusters = new Set(), labels = [];
    for (const u of units) {
      const at = `translate(${u.x + u.dx * scale} ${u.y + u.dy * scale}) scale(${scale})`;
      if (u.members.length === 1) {
        const id = u.members[0];
        if (this.battleInfo.has(id)) { const mark = this.battleMarks.get(id); mark?.group.setAttribute('transform', at); mark?.group.classList.toggle('named', level !== 'far'); continue; }
        const marker = this.markers.get(id); shownMarkers.add(id);
        marker.group.setAttribute('transform', at);
        marker.industry.style.display = level === 'near' ? '' : 'none';
        // Names: reserved space when zoomed in, only where uncrowded at mid, never at country level.
        // Try above the counter, then below it; otherwise the name waits for more zoom.
        const width = this.places.get(id).name.length * 5.8 + 4;
        let named = false;
        if (level !== 'far') for (const [dy, y] of [[-COUNTER_H / 2 - 15, -17], [COUNTER_H / 2 + (level === 'near' ? 8 : 1), level === 'near' ? 29 : 22]]) {
          const label = { x: u.x * px + u.dx - width / 2, y: u.y * px + u.dy + dy, w: width, h: 13 };
          const overlaps = q => label.x < q.x + q.w && q.x < label.x + label.w && label.y < q.y + q.h && q.y < label.y + label.h;
          if (u.locked && y < 0 || !placed.some(q => q !== u.rect && overlaps(q)) && !labels.some(overlaps)) {
            named = true; labels.push(label); marker.label.setAttribute('y', y); break;
          }
        }
        marker.label.style.display = named ? '' : 'none';
      } else {
        const key = [...u.members].sort().join(','); usedClusters.add(key);
        const cluster = this.cluster(key); cluster.group.setAttribute('transform', at);
        this.paintCluster(cluster, u);
      }
    }
    for (const [id, marker] of this.markers) marker.group.classList.toggle('counter-merged', !shownMarkers.has(id));
    for (const [key, cluster] of this.clusters) if (!usedClusters.has(key)) { cluster.group.remove(); this.clusters.delete(key); }
    this.paintCountryNames(level, px, scale, placed);
    this.positions();
  }
  cluster(key) {
    if (!this.clusters.has(key)) {
      const group = node('g', { class: 'map-counter map-cluster', 'data-cluster': key, tabindex: 0, role: 'button' });
      const disc = node('rect', { y: -10, height: COUNTER_H, rx: 1, class: 'counter-body' }), stripe = node('rect', { y: -10, width: 4, height: COUNTER_H, class: 'counter-stripe' });
      const text = node('text', { x: 2, y: .5, class: 'counter-value' }), badge = node('g', { class: 'cluster-badge' });
      const badgeBody = node('rect', { y: -16, height: 12, rx: 6 }), badgeText = node('text', { y: -9.6 });
      badge.append(badgeBody, badgeText); group.append(disc, stripe, text, badge); this.clusterLayer.append(group);
      this.clusters.set(key, { group, disc, stripe, text, badgeBody, badgeText });
    }
    return this.clusters.get(key);
  }
  paintCluster(cluster, u) {
    const width = counterWidth(u.troops), color = this.countries.get(u.owner)?.color || NEUTRAL, count = String(u.members.length);
    cluster.disc.setAttribute('width', width); cluster.disc.setAttribute('x', -width / 2); cluster.disc.setAttribute('stroke', color);
    cluster.stripe.setAttribute('x', -width / 2); cluster.stripe.setAttribute('fill', color);
    cluster.text.textContent = u.troops; cluster.badgeText.textContent = count;
    const bw = 6 + count.length * 6; cluster.badgeBody.setAttribute('width', bw); cluster.badgeBody.setAttribute('x', width / 2 - bw + 4);
    cluster.badgeText.setAttribute('x', width / 2 - bw / 2 + 4);
    cluster.group.dataset.total = u.troops; cluster.group.dataset.owner = u.owner || '';
    cluster.group.classList.toggle('owned', Boolean(u.owner && u.owner === this.state.you));
    cluster.group.setAttribute('aria-label', `${this.countries.get(u.owner)?.name || 'Uncontrolled'}: ${u.members.length} provinces, ${u.troops} troops combined. Activate to zoom in.`);
  }
  paintCountryNames(level, px, scale, placed) {
    this.countryNames.replaceChildren();
    if (level !== 'far') return;
    const taken = [...placed];
    for (const c of this.map.countries) {
      const owned = this.state.provinces.filter(p => p.owner === c.id).map(p => p.id);
      if (!owned.length) continue;
      // Largest contiguous holding carries the name.
      let best = [];
      const seen = new Set();
      for (const start of owned) {
        if (seen.has(start)) continue;
        const group = [], queue = [start]; seen.add(start);
        while (queue.length) { const id = queue.shift(); group.push(id); for (const n of this.landNeighbors.get(id) || []) if (!seen.has(n) && this.byId.get(n)?.owner === c.id) { seen.add(n); queue.push(n); } }
        if (group.length > best.length) best = group;
      }
      // The name must sit on the country's own land and clear of every counter and other name.
      const mx = best.reduce((n, id) => n + this.places.get(id).x, 0) / best.length, my = best.reduce((n, id) => n + this.places.get(id).y, 0) / best.length;
      const anchors = [{ x: mx, y: my }, ...best.map(id => this.places.get(id)).sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my) || a.id.localeCompare(b.id))];
      const text = c.name.toUpperCase(), width = text.length * 8.4 + 8, height = 15;
      const onLand = (x, y) => best.some(id => insideRings([x, y], this.rings.get(id)));
      search: for (const { x, y } of anchors) for (const dy of [0, -24, 24, -36, 36]) {
        const sx = this.near(x), r = { x: sx * px - width / 2, y: y * px + dy - height / 2, w: width, h: height };
        if (!onLand(x, y + dy * scale) || taken.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;
        const label = node('text', { transform: `translate(${sx} ${y + dy * scale}) scale(${scale})`, class: 'country-name', 'data-country': c.id });
        label.textContent = text; this.countryNames.append(label); taken.push(r); break search;
      }
    }
  }
  update(state, source, destination) {
    if (!this.state || this.state.tick !== state.tick) this.receivedAt = performance.now();
    this.state = state; this.source = source; this.destination = destination;
    this.byId = new Map(state.provinces.map(p => [p.id, p]));
    const me = state.players.find(p => p.id === state.you), sides = new Map(state.players.map(p => [p.id, p.side]));
    const neighbors = this.places.get(source)?.neighbors || [];
    for (const p of state.provinces) {
      const shape = this.shapes.get(p.id), marker = this.markers.get(p.id);
      if (!shape) continue;
      shape.setAttribute('fill', this.countries.get(p.owner)?.color || '#aaa994');
      const role = p.id === source ? 'selected' : p.id === destination ? 'destination' : neighbors.includes(p.id) ? 'neighbor' : '';
      shape.setAttribute('class', `province ${role}${p.owner ? ' occupied' : ''}`);
      marker.group.setAttribute('class', `map-counter ${role}${p.owner === state.you && state.you ? ' owned' : ''}`);
      marker.disc.setAttribute('stroke', this.countries.get(p.owner)?.color || NEUTRAL);
      marker.stripe.setAttribute('fill', this.countries.get(p.owner)?.color || NEUTRAL);
      const width = counterWidth(p.troops); marker.disc.setAttribute('width', width); marker.disc.setAttribute('x', -width / 2); marker.stripe.setAttribute('x', -width / 2);
      marker.text.textContent = p.troops;
      // Industry as drawn pips (font-independent): one per level, a small arrow while building.
      const level = p.owner ? clamp(p.development || 1, 0, 5) : 0, key = `${level}${p.developing ? '+' : ''}`;
      if (marker.industry.dataset.level !== key) {
        marker.industry.dataset.level = key; marker.industry.replaceChildren();
        const span = level * 6 + (p.developing ? 6 : 0) - 2;
        for (let i = 0; i < level; i++) marker.industry.append(node('rect', { x: -span / 2 + i * 6, y: 13, width: 4, height: 4 }));
        if (p.developing) marker.industry.append(node('path', { class: 'industry-rising', d: `M${span / 2 - 4},17.5l2-5 2 5Z` }));
      }
      marker.group.setAttribute('aria-label', `${this.places.get(p.id).name}, ${p.troops} troops, ${this.countries.get(p.owner)?.name || 'uncontrolled'}${p.owner ? `, industry ${p.development}` : ''}`);
    }
    // Province borders are thin; a border between two different owners is a country border.
    for (const b of this.borders) {
      const country = (this.byId.get(b.a)?.owner || null) !== (this.byId.get(b.b)?.owner || null);
      if (country !== b.country) { b.country = country; (country ? this.countryBorders : this.provinceBorders).append(b.el); }
    }
    for (const c of this.map.countries) {
      const owned = state.provinces.filter(p => p.owner === c.id).map(p => p.id);
      if (owned.length) this.lastOwned.set(c.id, owned);
    }
    for (const edge of this.seas.children) edge.classList.toggle('selected-connection', edge.dataset.edge.split('|').includes(source));
    this.connections.replaceChildren();
    for (const id of neighbors) this.connections.append(node('path', { d: this.path(source, id), class: id === destination ? 'target-connection' : 'adjacent-connection', ...(id === destination ? { 'marker-end': `url(#${this.prefix}march-head)` } : {}) }));
    this.routes.replaceChildren();
    for (const p of state.provinces) if (p.route && (p.owner === state.you || p.id === source)) this.routes.append(node('path', { d: this.path(p.id, p.route), class: 'recruit-connection', 'marker-end': `url(#${this.prefix}march-head)` }));
    this.trails.replaceChildren();
    for (const a of state.armies) if (a.amount >= 5 && !a.engaged && (a.country === state.you || a.to === destination || a.from === source)) {
      this.trails.append(node('path', { d: this.pointPath(a.startPoint || this.places.get(a.from), this.places.get(a.to)), class: `army-trail${a.returning ? ' returning' : ''}` }));
    }
    const ids = new Set(state.armies.map(a => a.id));
    for (const [id, entry] of this.armies) if (!ids.has(id)) { entry.group.remove(); this.armies.delete(id); }
    for (const army of state.armies) {
      if (!this.armies.has(army.id)) {
        const group = node('g', { class: 'moving-army' }), disc = node('path', { d: 'M-5-4L6 0-5 4-2 0Z' }), label = node('text', { y: -10 });
        group.append(disc, label); this.marches.append(group); this.armies.set(army.id, { group, disc, label });
      }
      const entry = this.armies.get(army.id), hostile = me && sides.get(army.country) !== me.side && state.provinces.some(p => p.id === army.to && p.owner === state.you);
      const origin = army.startPoint || this.places.get(army.from), target = this.places.get(army.to); let dx = target.x - origin.x; if (dx > 640) dx -= 1280; if (dx < -640) dx += 1280;
      entry.disc.setAttribute('transform', `rotate(${Math.atan2(target.y - origin.y, dx) * 180 / Math.PI})`);
      entry.disc.setAttribute('fill', hostile ? '#ee987a' : this.countries.get(army.country)?.color || NEUTRAL);
      // Engaged armies are shown by the battle marker at their target, not as a moving arrow.
      entry.group.classList.toggle('hostile', Boolean(hostile)); entry.group.classList.toggle('engaged', Boolean(army.engaged));
      entry.group.classList.toggle('minor', army.amount < 20 && !hostile && army.country !== state.you);
      entry.label.textContent = army.amount >= 3 ? army.amount : '';
    }
    this.paintBattles(state);
    this.layout();
    if (!this.frame && !this.reducedMotion && state.status === 'running') this.frame = requestAnimationFrame(() => this.animate());
  }
  /** Persistent clash markers for phased battles: attacker strength vs defending garrison. */
  paintBattles(state) {
    this.battleInfo = new Map();
    for (const battle of state.battles || []) {
      const p = this.byId.get(battle.province);
      if (!p || !this.places.has(p.id)) continue;
      const engaged = (state.armies || []).filter(a => a.engaged && a.to === p.id);
      const byCountry = new Map(); for (const a of engaged) byCountry.set(a.country, (byCountry.get(a.country) || 0) + a.amount);
      const lead = [...byCountry].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      const attack = engaged.reduce((n, a) => n + a.amount, 0), defend = p.troops;
      const width = 10 + (String(attack).length * 7.5 + 8) + 22 + (String(defend).length * 7.5 + 8);
      this.battleInfo.set(p.id, { battle, attack, defend, lead, width });
    }
    for (const [id, mark] of this.battleMarks) if (!this.battleInfo.has(id)) { mark.group.remove(); this.battleMarks.delete(id); }
    for (const [id, info] of this.battleInfo) {
      if (!this.battleMarks.has(id)) {
        const group = node('g', { class: 'battle-counter', 'data-province': id, tabindex: 0, role: 'button' });
        const pulse = node('rect', { class: 'battle-pulse', y: -16, height: 32, rx: 3 });
        const body = node('rect', { class: 'battle-body', y: -12, height: 24, rx: 1 });
        const left = node('rect', { class: 'battle-stripe', y: -12, width: 5, height: 24 }), right = node('rect', { class: 'battle-stripe', y: -12, width: 5, height: 24 });
        const attack = node('text', { class: 'battle-value attack', y: .5 }), defend = node('text', { class: 'battle-value defend', y: .5 });
        const swords = node('path', { class: 'battle-swords', d: SWORDS }), flashes = node('g', { class: 'battle-flashes', 'aria-hidden': 'true' });
        const name = node('text', { class: 'province-name battle-name', y: -20 }); name.textContent = this.places.get(id).name;
        group.append(pulse, body, left, right, attack, swords, defend, name, flashes); this.battleLayer.append(group);
        this.battleMarks.set(id, { group, pulse, body, left, right, attack, defend, flashes });
      }
      const mark = this.battleMarks.get(id), w = info.width, aw = String(info.attack).length * 7.5 + 8, dw = String(info.defend).length * 7.5 + 8;
      mark.pulse.setAttribute('x', -w / 2 - 3); mark.pulse.setAttribute('width', w + 6);
      mark.body.setAttribute('x', -w / 2); mark.body.setAttribute('width', w);
      mark.left.setAttribute('x', -w / 2); mark.left.setAttribute('fill', this.countries.get(info.lead)?.color || NEUTRAL);
      mark.right.setAttribute('x', w / 2 - 5); mark.right.setAttribute('fill', this.countries.get(this.byId.get(id).owner)?.color || NEUTRAL);
      const swordsAt = -w / 2 + 5 + aw + 11;
      mark.attack.setAttribute('x', -w / 2 + 5 + aw / 2); mark.attack.textContent = info.attack;
      mark.group.querySelector('.battle-swords').setAttribute('transform', `translate(${swordsAt} 0)`);
      mark.defend.setAttribute('x', w / 2 - 5 - dw / 2); mark.defend.textContent = info.defend;
      mark.group.dataset.attack = info.attack; mark.group.dataset.defend = info.defend;
      mark.group.setAttribute('aria-label', `Battle at ${this.places.get(id).name}: ${info.attack} attacking, ${info.defend} defending`);
      // Flash only a round this atlas has not shown yet; a fresh load never replays old rounds.
      const round = info.battle.lastRound, key = info.battle.id || id, seen = this.seenRounds.get(key);
      if (round && seen !== undefined && round.tick > seen) this.roundFlash(mark, round, w, aw);
      this.seenRounds.set(key, round?.tick ?? -1);
    }
  }
  roundFlash(mark, round, w, aw) {
    mark.group.classList.remove('battle-hit'); void mark.group.getBBox?.(); mark.group.classList.add('battle-hit');
    mark.flashes.replaceChildren();
    for (const [loss, x] of [[round.attackerLoss, -w / 2 + 4 + aw / 2], [round.defenderLoss, w / 2 - 14]]) {
      if (!(loss > 0)) continue;
      const text = node('text', { class: 'round-loss', x, y: 27 }); text.textContent = `−${loss}`; mark.flashes.append(text);
    }
    this.later(() => { mark.flashes.replaceChildren(); mark.group.classList.remove('battle-hit'); }, 1300);
  }
  later(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); }
  /** Decorative, aria-hidden map animation. Unknown kinds or ids are a no-op; never throws. */
  effect(kind, data) {
    try {
      if (!MAP_EFFECTS.includes(kind) || !data || typeof data !== 'object') return false;
      const still = this.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
      const known = ids => Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && this.countries.has(id)))] : [];
      const province = typeof data.province === 'string' && this.places.get(data.province);
      const g = node('g', { class: `map-effect fx-${kind.replace('_', '-')}${still ? ' still' : ''}` });
      let point = null;
      if (kind === 'industry_up' || kind === 'industry_down') {
        if (!province) return false;
        const up = kind === 'industry_up';
        // Ring around the counter; the badge rises above it so the troop number stays readable.
        g.append(node('circle', { class: 'fx-ring', r: 24 }));
        const badge = node('g', { transform: 'translate(0 -34)' }), icon = node('g', { class: up ? 'fx-rise' : 'fx-burst' });
        icon.append(node('circle', { class: 'fx-disc', r: 13 }));
        if (!up) for (const [cx, cy, r] of [[-6, -5, 7], [6, -8, 6], [0, 2, 8]]) icon.append(node('circle', { class: 'fx-smoke', cx, cy, r }));
        icon.append(node('path', { class: up ? 'fx-icon' : 'fx-crack', d: up ? FACTORY : CRACK, transform: 'scale(1.25)' }));
        badge.append(icon); g.append(badge);
        const level = Number(data.level);
        if (Number.isInteger(level) && ROMAN[level]) { const t = node('text', { class: 'fx-level', y: -54 }); t.textContent = `Industry ${ROMAN[level]}`; g.append(t); }
        point = province;
      } else if (kind === 'captured') {
        const color = this.countries.get(data.owner)?.color;
        if (!province || !color) return false;
        g.append(node('path', { class: 'fx-fill', d: province.path, fill: color }), node('path', { class: 'fx-outline', d: province.path, stroke: color }));
        const ring = node('g', { class: 'fx-captured-ring' });
        ring.append(node('circle', { class: 'fx-ring fx-shadow', r: 22 }), node('circle', { class: 'fx-ring', r: 22, stroke: color }), node('circle', { class: 'fx-ring fx-late', r: 22, stroke: color }));
        this.pointEffect(ring, province, still);
      } else if (kind === 'alliance') {
        const members = known(data.countries);
        if (members.length < 2) return false;
        const outline = this.outline(new Set(members.flatMap(c => this.territory(c))));
        if (outline) g.append(node('path', { class: 'fx-glow', d: outline, stroke: ALLIANCE }), node('path', { class: 'fx-glow-core', d: outline }));
        const capitals = members.map(c => this.places.get(this.capital(c))).filter(Boolean);
        for (const other of capitals.slice(1)) g.append(node('path', { class: 'fx-link', d: this.pointPath(capitals[0], other) }));
        for (const capital of capitals) { const ring = node('g'); ring.append(node('circle', { class: 'fx-ring', r: 18, stroke: ALLIANCE })); this.pointEffect(ring, capital, still); }
      } else if (kind === 'war' || kind === 'peace') {
        const from = known(data.from), to = known(data.to).filter(c => !from.includes(c));
        if (!from.length || !to.length) return false;
        g.append(node('path', { class: 'fx-front', d: this.front(new Set(from), new Set(to)) }));
      } else if (kind === 'eliminated') {
        const c = typeof data.country === 'string' && this.countries.get(data.country);
        if (!c) return false;
        const region = this.lastOwned.get(c.id) || [];
        const ids = region.length ? region : [this.capital(c.id)];
        g.append(node('path', { class: 'fx-ash', d: ids.map(id => this.places.get(id)?.path || '').join('') }));
        const outline = this.outline(new Set(ids));
        if (outline) g.append(node('path', { class: 'fx-fade-border', d: outline, stroke: c.color }));
      }
      if (point) this.pointEffect(g, point, still);
      else this.areaEffects.append(g);
      this.later(() => g.remove(), still ? 1600 : 2400);
      return true;
    } catch { return false; }
  }
  pointEffect(g, at, still) {
    const entry = { g, x: at.x, y: at.y }; this.pointEffects.add(entry);
    g.classList.add('map-effect'); if (still) g.classList.add('still');
    g.setAttribute('transform', `translate(${at.x} ${at.y}) scale(${1 / (this.svg.getScreenCTM()?.a || 1)})`);
    this.effects.append(g);
    this.later(() => { g.remove(); this.pointEffects.delete(entry); }, still ? 1600 : 2400);
  }
  territory(country) {
    const now = this.state?.provinces.filter(p => p.owner === country).map(p => p.id) || [];
    return now.length ? now : this.lastOwned.get(country) || [this.capital(country)];
  }
  capital(country) {
    const c = this.countries.get(country), owner = id => this.byId?.get(id)?.owner;
    const home = [...(c?.homeland || []), ...(c?.start || [])].find(id => owner(id) === country);
    if (home) return home;
    const strongest = this.state?.provinces.filter(p => p.owner === country).sort((a, b) => b.troops - a.troops || a.id.localeCompare(b.id))[0];
    return strongest?.id || c?.start?.[0];
  }
  /** Outer outline of a province set: coastline plus borders facing outside the set. */
  outline(ids) {
    const network = networks.get(this.map), parts = [];
    for (const id of ids) parts.push(...(network.coast.get(id) || []));
    for (const b of this.borders) if (ids.has(b.a) !== ids.has(b.b)) parts.push(b.d);
    return parts.join('');
  }
  /** The contact line between two groups of countries: land borders, else sea links, else capitals. */
  front(from, to) {
    const owner = id => this.byId?.get(id)?.owner;
    const faces = (a, b) => from.has(owner(a)) && to.has(owner(b)) || to.has(owner(a)) && from.has(owner(b));
    const land = this.borders.filter(b => faces(b.a, b.b)).map(b => b.d);
    if (land.length) return land.join('');
    const sea = this.map.edges.filter(e => e.sea && faces(e.from, e.to)).map(e => this.path(e.from, e.to));
    if (sea.length) return sea.join('');
    const a = this.places.get(this.capital([...from][0])), b = this.places.get(this.capital([...to][0]));
    return a && b ? this.pointPath(a, b) : '';
  }
  positions() {
    if (!this.state) return;
    const elapsed = this.reducedMotion || this.state.status !== 'running' ? 0 : Math.min(2, (performance.now() - this.receivedAt) / 1000) * this.state.speed;
    const scale = 1 / (this.svg.getScreenCTM()?.a || 1);
    for (const army of this.state.armies) {
      const point = journeyPoint(army, this.positionsById, Math.min(this.state.tick + elapsed, army.arrivesAt - .01));
      this.armies.get(army.id)?.group.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${scale})`);
    }
  }
  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;
    if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame); this.layoutFrame = null;
    for (const t of this.timers) clearTimeout(t); this.timers.clear();
    this.resize.disconnect(); this.tooltip.remove();
  }
  animate() { this.frame = null; this.positions(); if (this.state?.status === 'running') this.frame = requestAnimationFrame(() => this.animate()); }
}
