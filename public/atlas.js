import { journeyPoint } from './movement.js';
import { borderNetwork, insideRings, provinceRings } from './map-geometry.js';
import { allianceColors, atWar, battleColors, coalitions, formingAlliances, relationsOf, teamColor, threatening, warKey } from './relations.js';
import { faction } from './presentation.js';
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
/** Map colouring modes: country colours, or relations relative to a focus country. */
export const MAP_MODES = Object.freeze(['political', 'diplomacy']);
const RELATION = Object.freeze({ focus: '#d9b45a', ally: '#4f9e94', enemy: '#b8483c', neutral: '#8f8d80', none: '#6d716a' });
/** Where the map key sits inside the map (the host may also mount it elsewhere). */
export const LEGEND_PLACEMENTS = Object.freeze(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
/** Zoom limit in screen pixels per map unit, identical on every device (phones included). */
export const MAX_PX_PER_UNIT = 14;
/** Level of detail by on-screen pixels per map unit: country totals, merged counters, every province. */
export const LOD = Object.freeze({ far: 1.2, near: 2.6 });
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const NEUTRAL = '#a5a28c', ALLIANCE = '#f6d77f', COUNTER_H = 21, PAD = 3;
const SWORDS = 'M-6-6L5 5M2.4 6.6L6.6 2.4M6-6L-5 5M-6.6 2.4L-2.4 6.6';
const FACTORY = 'M-8 7V-1l4.5 3V-1l4.5 3V-7h3.5V7Z';
const CRACK = 'M-2-9l3 5-3 3 4 3-2 7';
const ARROW = 'M-6.5-5.5L7.5 0-6.5 5.5-3 0Z';
const counterWidth = troops => Math.max(32, String(troops).length * 7 + 15);
const networks = new WeakMap();
/** World width in map units: the map repeats horizontally at this period. */
export const WORLD = 1280;
let instances = 0;
/** Shortest horizontal offset from a to b across the wrap. */
export const wrapDelta = dx => dx - WORLD * Math.round(dx / WORLD);
export class Atlas {
  /** options.legend: { placement: one of LEGEND_PLACEMENTS (default 'bottom-left'),
   *  container: element to mount the key in instead of the map container, collapsed: boolean }. */
  constructor(svg, map, onSelect, options = {}) {
    this.svg = svg; this.map = map; this.onSelect = onSelect;
    // Optional host hooks (v0.8): `drag: { start(id, { counter }) → boolean (no side effects), begin(from), end(from, to|null), label(from, to) → string }`
    // turns a drag that starts on one of the host's provinces into an order arrow instead of a pan;
    // `onArmy(id) → boolean` handles a tap on a moving army (true = handled, no tooltip).
    this.dragHooks = options.drag || null; this.onArmy = options.onArmy || null; this.draftState = null;
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
    this.frontEls = new Map(); this.blocEls = new Map(); this.blocSeq = 0; this.mode = 'political'; this.relationFocus = null; this.hoverFocus = null;
    this.armyRects = [];
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    svg.replaceChildren(); svg.classList.add('atlas-v6');
    if (!svg.id) svg.id = `atlas-${++instances}`;
    // Horizontal wraparound: world-space layers live once in `base` (fills, borders, blocs,
    // fronts), `lines` (routes, traces) or `fx` (effects); two <use> copies repeat each at
    // ±WORLD, and <use> shadow trees add no document IDs. Counters, names, battles and moving
    // armies are single interactive overlays placed on the copy nearest the view centre.
    this.base = node('g', { id: `${svg.id}-world-base` });
    this.lines = node('g', { id: `${svg.id}-world-lines`, 'pointer-events': 'none' }); this.fx = node('g', { id: `${svg.id}-world-fx`, 'pointer-events': 'none' });
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
    this.alliedBorders = node('g', { class: 'allied-borders', 'pointer-events': 'none' });
    this.borders = network.borders.map(b => { const el = node('path', { d: b.d, 'data-border': `${b.a}|${b.b}` }); this.provinceBorders.append(el); return { ...b, el, kind: 'province' }; });
    // Alliance blocs, war fronts and hover relations sit above borders, below routes.
    this.blocs = node('g', { class: 'alliance-blocs', 'pointer-events': 'none', 'aria-hidden': 'true' });
    this.fronts = node('g', { class: 'war-fronts', 'pointer-events': 'none', 'aria-hidden': 'true' });
    this.relationLines = node('g', { class: 'relation-outlines', 'pointer-events': 'none', 'aria-hidden': 'true' });
    this.relationPaths = Object.fromEntries(['ally', 'enemy', 'focus'].map(kind => [kind, node('path', { class: `relation-${kind}` })]));
    this.relationLines.append(...Object.values(this.relationPaths));
    this.base.append(this.provinceBorders, this.alliedBorders, this.countryBorders, node('path', { d: coast, class: 'coastline', 'pointer-events': 'none' }));
    const compass = node('g', { 'aria-hidden': 'true', 'pointer-events': 'none', transform: 'translate(110 560)', opacity: .38, stroke: '#ddc591', fill: 'none' });
    compass.append(node('circle', { r: 27, 'stroke-width': .7 }), node('circle', { r: 22, 'stroke-width': .4 }), node('path', { d: 'M0-40L6-6 40 0 6 6 0 40-6 6-40 0-6-6Z', 'stroke-width': .8 }), node('path', { d: 'M0-40V0H-40L-6-6Z', fill: '#ddc591', 'stroke-width': .4 }));
    const north = node('text', { y: -46, 'text-anchor': 'middle', stroke: 'none', fill: '#eed9ac', 'font-size': 12, 'font-family': 'Georgia' }); north.textContent = 'N'; compass.append(north); this.base.append(compass);
    this.areaEffects = node('g', { class: 'map-effects map-area-effects', 'aria-hidden': 'true', 'pointer-events': 'none' });
    this.countryNames = node('g', { class: 'country-names', 'pointer-events': 'none', 'aria-hidden': 'true' });
    this.allianceNames = node('g', { class: 'alliance-names', 'pointer-events': 'none', 'aria-hidden': 'true' });
    this.connections = node('g', { 'pointer-events': 'none' }); this.routes = node('g', { 'pointer-events': 'none' });
    this.marches = node('g', { class: 'map-armies' }); this.seaFronts = node('g', { class: 'sea-fronts', 'aria-hidden': 'true' });
    this.trails = node('g', { 'pointer-events': 'none' }); this.base.append(this.areaEffects, this.blocs, this.fronts, this.relationLines);
    this.lines.append(this.seaFronts, this.connections, this.routes, this.trails);
    this.leaders = node('g', { class: 'counter-leaders', 'pointer-events': 'none', 'aria-hidden': 'true' });
    const markers = node('g', { class: 'map-counters' });
    for (const p of map.provinces) {
      const group = node('g', { id: `${this.prefix}marker-${p.id}`, 'data-province': p.id, tabindex: 0, role: 'button', class: 'map-counter' });
      const disc = node('rect', { x: -16, y: -10, width: 32, height: COUNTER_H, rx: 1, class: 'counter-body' }); const text = node('text', { x: 2, y: .5, class: 'counter-value', id: `${this.prefix}troops-${p.id}` });
      const stripe = node('rect', { x: -16, y: -10, width: 4, height: COUNTER_H, class: 'counter-stripe' });
      const bloc = node('rect', { x: -19, y: -10, width: 2.5, height: COUNTER_H, class: 'counter-bloc' });
      const label = node('text', { y: -17, class: 'province-name' }); label.textContent = p.name;
      const industry = node('g', { class: 'industry-pips', 'aria-hidden': 'true' }); group.append(industry);
      group.append(bloc, disc, stripe, text, label); markers.append(group); this.markers.set(p.id, { group, disc, stripe, bloc, text, label, industry });
    }
    this.clusterLayer = node('g', { class: 'map-clusters' }); this.battleLayer = node('g', { class: 'map-battles' });
    this.effects = node('g', { class: 'map-effects', 'aria-hidden': 'true', 'pointer-events': 'none' });
    this.fx.append(this.effects);
    // Bottom to top: ocean → fills/borders/blocs/fronts (copied) → routes (copied) → names →
    // counters → battles → effects (copied) → moving armies, drawn once above every copy.
    const copies = layer => [-WORLD, WORLD].map(x => node('use', { href: `#${layer.id}`, x, class: 'world-copy', 'aria-hidden': 'true', ...(layer === this.base ? {} : { 'pointer-events': 'none' }) }));
    svg.append(...copies(this.base), this.base, ...copies(this.lines), this.lines, this.allianceNames, this.countryNames, this.leaders, markers, this.clusterLayer, this.battleLayer,
      ...copies(this.fx), this.fx, this.draftLayer = node('g', { class: 'order-draft', 'pointer-events': 'none', 'aria-hidden': 'true' }), this.marches);
    this.tooltip = document.createElement('div'); this.tooltip.className = 'atlas-tooltip'; this.tooltip.hidden = true; svg.parentElement.append(this.tooltip);
    // Map-mode toggle and legend: plain DOM, text only via textContent.
    const legendOptions = options?.legend || {};
    this.chip = document.createElement('div'); this.chip.className = 'atlas-modes';
    this.keyButton = document.createElement('button'); this.keyButton.type = 'button'; this.keyButton.className = 'atlas-key-toggle';
    this.keyButton.addEventListener('click', () => this.setLegendCollapsed(!this.chip.classList.contains('collapsed')));
    this.modeButton = document.createElement('button'); this.modeButton.type = 'button'; this.modeButton.className = 'atlas-mode-toggle';
    this.modeButton.addEventListener('click', () => this.setMapMode(this.mode === 'political' ? 'diplomacy' : 'political'));
    this.legend = document.createElement('div'); this.legend.className = 'atlas-legend';
    this.chip.append(this.keyButton, this.legend, this.modeButton);
    this.chipDetached = legendOptions.container instanceof Element;
    (this.chipDetached ? legendOptions.container : svg.parentElement).append(this.chip);
    this.setLegendPlacement(legendOptions.placement);
    this.setLegendCollapsed(legendOptions.collapsed ?? matchMedia('(max-width: 520px)').matches);
    svg.addEventListener('focusin', event => {
      const army = event.target.closest?.('[data-army]')?.dataset.army;
      if (army) { this.showArmy(army, event.target.getBoundingClientRect()); return; }
      const id = event.target.closest?.('[data-province]')?.dataset.province;
      this.hoverCountry(this.byId?.get(id)?.owner || null);
    });
    svg.addEventListener('focusout', () => { this.hoverCountry(null); this.tooltip.hidden = true; });
    svg.addEventListener('contextmenu', event => event.preventDefault());
    svg.addEventListener('wheel', event => { event.preventDefault(); this.zoom(event.deltaY > 0 ? 1.12 : .89, event.clientX, event.clientY); }, { passive: false });
    svg.addEventListener('pointerdown', event => this.down(event));
    svg.addEventListener('pointermove', event => this.move(event));
    svg.addEventListener('pointerup', event => this.up(event));
    svg.addEventListener('pointercancel', event => { if (this.gesture?.command) this.endDraft(null); this.pointers.delete(event.pointerId); this.gesture = null; this.dragged = true; });
    svg.addEventListener('pointerleave', () => { this.tooltip.hidden = true; this.hoverCountry(null); });
    if (!svg.hasAttribute('tabindex')) svg.setAttribute('tabindex', 0);
    svg.addEventListener('keydown', event => {
      // Arrow keys pan (wrapping east–west); never while typing, since only map elements listen.
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (step) { event.preventDefault(); this.pan(step[0] * this.view.w * .15, step[1] * this.view.h * .15); return; }
      if (!['Enter', ' '].includes(event.key)) return;
      const cluster = event.target.closest('[data-cluster]')?.dataset.cluster;
      const id = event.target.closest('[data-province]')?.dataset.province;
      if (cluster) { event.preventDefault(); this.fit(cluster.split(',')); }
      else if (id) { event.preventDefault(); onSelect(id, { shiftKey: event.shiftKey, keyboard: true }); }
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
      // A drag from the host's own province draws an order arrow instead of panning.
      const g = this.gesture;
      if (g.id && !g.army && event.button === 0 && this.dragHooks?.start?.(g.id, { counter: Boolean(event.target.closest?.('.map-counter')) })) g.command = g.id;
    } else { if (this.gesture?.command) this.endDraft(null); this.dragged = true; this.gesture = null; this.pinchDistance = this.distance(); }
    if (!this.gesture?.army) this.tooltip.hidden = true;
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
    if (this.gesture.command) { if (this.dragged) this.dragTo(event.clientX, event.clientY); return; }
    if (this.dragged) {
      const scale = this.svg.getScreenCTM()?.a || 1;
      this.view.x = this.gesture.vx - dx / scale; this.view.y = this.gesture.vy - dy / scale; this.applyView();
    }
  }
  up(event) {
    const gesture = this.gesture; this.pointers.delete(event.pointerId);
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    if (gesture?.command && this.dragged) {
      this.dragTo(event.clientX, event.clientY); const to = this.dragging?.to ?? null;
      this.endDraft(gesture.command, to); if (!this.pointers.size) this.gesture = null; return;
    }
    // Double tap zooms 2× at the tap; the first tap already selected, the second does not.
    if (event.pointerType === 'touch' && !this.dragged && gesture) {
      const now = performance.now(), last = this.lastTap;
      if (last && now - last.t < 350 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 30) {
        this.lastTap = null; this.zoom(.5, event.clientX, event.clientY); if (!this.pointers.size) this.gesture = null; return;
      }
      this.lastTap = { t: now, x: event.clientX, y: event.clientY };
    }
    if (!this.dragged && gesture?.army && this.onArmy?.(gesture.army)) { this.tooltip.hidden = true; }
    else if (!this.dragged && gesture?.army) this.showArmy(gesture.army, { left: event.clientX - 14, top: event.clientY + 65, width: 0 });
    else if (!this.dragged && gesture?.cluster) this.fit(gesture.cluster.split(','));
    else if (!this.dragged && gesture?.id) this.onSelect(gesture.id, { shiftKey: gesture.shiftKey, target: gesture.target });
    if (!this.pointers.size) this.gesture = null;
  }
  /** What a pointer event is on. A click on a repeated world copy resolves to the same province. */
  hit(event) {
    const el = event.target, cluster = el.closest?.('[data-cluster]')?.dataset.cluster, army = el.closest?.('[data-army]')?.dataset.army;
    let id = el.closest?.('[data-province]')?.dataset.province;
    if (!id && !cluster && !army && el.closest?.('use.world-copy')) id = this.provinceAt(this.coordinates(event.clientX, event.clientY));
    return { cluster, id, army };
  }
  provinceAt(point) {
    const x = ((point.x % WORLD) + WORLD) % WORLD;
    for (const [id, rings] of this.rings) if (insideRings([x, point.y], rings)) return id;
    return null;
  }
  /** The x of the repeated copy nearest the view centre. */
  near(x) {
    const rect = { width: this.rectWidth || 0 }, l = this.insets?.left || 0, r = this.insets?.right || 0; // cached per view change
    const cx = rect.width > l + r ? this.view.x + (l + (rect.width - r)) / 2 * this.view.w / rect.width : this.view.x + this.view.w / 2;
    return cx + wrapDelta(x - cx);
  }
  pan(dx, dy) { this.view.x += dx; this.view.y += dy; this.applyView(); }
  hover(event) {
    const { cluster, id, army } = this.hit(event);
    const p = this.byId?.get(id);
    this.hoverCountry(cluster ? this.byId?.get(cluster.split(',')[0])?.owner || null : p?.owner || null);
    if (army) { this.showArmy(army, { left: event.clientX - 14, top: event.clientY + 65, width: 0 }); return; }
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
    this.tip(title, detail, event.clientX, event.clientY);
  }
  tip(title, detail, clientX, clientY) {
    this.tooltip.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = title;
    const span = document.createElement('span'); span.textContent = detail;
    this.tooltip.append(strong, span); this.tooltip.hidden = false;
    const rect = this.svg.parentElement.getBoundingClientRect();
    this.tooltip.style.left = `${clamp(clientX - rect.left + 14, 8, rect.width - 260)}px`;
    this.tooltip.style.top = `${Math.max(8, clientY - rect.top - 65)}px`;
  }
  showArmy(id, at) {
    const a = this.state?.armies.find(a => a.id === id);
    if (!a) return;
    const eta = Math.max(0, Math.ceil(a.arrivesAt - this.state.tick));
    this.tip(`${this.countries.get(a.country)?.name || 'Army'} · ${a.amount} troops`,
      `${this.places.get(a.from)?.name} → ${this.places.get(a.to)?.name}${a.returning ? ' · returning' : ''} · arrives in ${eta}s`, at.left + at.width / 2, at.top);
  }
  /** [min, max] view width in map units: max zoom is MAX_PX_PER_UNIT on this element's width;
   * zoom-out stops at one world width, so each province and counter is seen once. */
  widthLimits(rect = this.svg.getBoundingClientRect()) {
    // With a persistent side panel over the map (setInsets), one world width fits the uncovered part.
    const covered = Math.min(rect.width * .6, (this.insets?.left || 0) + (this.insets?.right || 0));
    return [rect.width > 0 ? Math.min(WORLD, rect.width / MAX_PX_PER_UNIT) : 135, rect.width > 0 ? WORLD * rect.width / (rect.width - covered) : WORLD];
  }
  /** Optional (v0.8.1, v0.9 adds top): screen px permanently covered by the host's panels ({left,right,top}). World view,
   * the zoom-out limit and the copy chosen for counters and names use the uncovered part of the map. */
  setInsets(insets) {
    const next = { left: Math.max(0, insets?.left || 0), right: Math.max(0, insets?.right || 0), top: Math.max(0, insets?.top || 0) };
    if (this.insets && next.left === this.insets.left && next.right === this.insets.right && next.top === this.insets.top) return;
    this.insets = next; this.applyView();
  }
  applyView() {
    const rect = this.svg.getBoundingClientRect(), aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 0;
    this.rectWidth = rect.width;
    const cx = this.view.x + this.view.w / 2, cy = this.view.y + this.view.h / 2;
    if (aspect) {
      // The viewBox takes the element's own aspect (no letterboxing), so portrait phones fill
      // the screen and px/unit is simply element width ÷ view width.
      const [minW, maxW] = this.widthLimits(rect), w = clamp(this.view.w, minW, maxW);
      this.view = { x: cx - w / 2, y: cy - w / aspect / 2, w, h: w / aspect };
    } else if (this.view.w > WORLD) {
      const k = WORLD / this.view.w;
      this.view = { x: cx - WORLD / 2, y: cy - this.view.h * k / 2, w: WORLD, h: this.view.h * k };
    }
    // Wrap: keep the view centre inside [0, WORLD); an active drag follows the same shift.
    const shift = WORLD * Math.floor((this.view.x + this.view.w / 2) / WORLD);
    if (shift) { this.view.x -= shift; if (this.gesture) this.gesture.vx -= shift; }
    const low = -this.view.h * .35, high = 680 - this.view.h * .65;
    this.view.y = low > high ? 340 - this.view.h / 2 : clamp(this.view.y, low, high);
    this.svg.setAttribute('viewBox', `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    this.requestLayout();
  }
  requestLayout() {
    if (!this.layoutFrame) this.layoutFrame = requestAnimationFrame(() => { this.layoutFrame = null; this.layout(); });
  }
  zoom(factor, clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const anchor = this.coordinates(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2);
    const [minW, maxW] = this.widthLimits(rect), w = clamp(this.view.w * factor, minW, maxW), ratio = w / this.view.w;
    this.view = { x: anchor.x - (anchor.x - this.view.x) * ratio, y: anchor.y - (anchor.y - this.view.y) * ratio, w, h: this.view.h * ratio };
    this.applyView();
  }
  world() {
    const rect = this.svg.getBoundingClientRect(), [, maxW] = this.widthLimits(rect), l = this.insets?.left || 0, t = this.insets?.top || 0;
    // v0.9: the HUD frame's top bar (insets.top) is kept clear too, so the Arctic is not under the bar.
    this.view = { x: -l * maxW / (rect.width || 1), y: -t * maxW / (rect.width || 1), w: maxW, h: 680 * maxW / WORLD }; this.applyView();
  }
  europe() { this.view = { x: 595, y: 105, w: 210, h: 111.6 }; this.applyView(); }
  /** Optional trailing `{ insets: {top,right,bottom,left} px, width: map units }`: centre the target in the
   * part of the screen the host's overlays leave uncovered; `width` sets the zoom (default 390 units). */
  focus(id, { insets, width } = {}) {
    const p = this.places.get(id); if (!p) return;
    const w = width || 390; this.view = { x: p.x - w / 2, y: p.y - w * 104 / 390, w, h: w * 208 / 390 }; this.applyView(); this.inset(p, insets);
  }
  home(country, options) { const c = this.countries.get(country); if (c) this.focus(c.start[0], options); }
  /** Shift the view so a map point sits in the centre of the uncovered screen area. */
  inset(point, insets) {
    if (!insets) return;
    const rect = this.svg.getBoundingClientRect(), px = rect.width / this.view.w;
    if (!(px > 0)) return;
    const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
    if (left + right >= rect.width * .8 || top + bottom >= rect.height * .8) return;
    this.view.x = point.x - ((left + (rect.width - right)) / 2) / px; this.view.y = point.y - ((top + (rect.height - bottom)) / 2) / px; this.applyView();
  }
  /** Zoom so every listed province anchor is in view (a cluster's members). */
  fit(ids, options) {
    const points = ids.map(id => this.places.get(id)).filter(Boolean);
    if (!points.length) return;
    const xs = points.map(p => points[0].x + wrapDelta(p.x - points[0].x)), ys = points.map(p => p.y), pad = Math.max(40, (Math.max(...xs) - Math.min(...xs)) * .2, (Math.max(...ys) - Math.min(...ys)) * .3);
    const w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, (Math.max(...ys) - Math.min(...ys) + pad * 2) * 1280 / 680);
    // Always zoom in at least one step, so a click on a merged counter is never a dead end.
    const width = Math.min(w, this.view.w * .7), h = width * 680 / 1280;
    this.view = { x: (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - h / 2, w: width, h };
    this.applyView(); this.inset({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, options?.insets);
  }
  /** 'political' (country colours) or 'diplomacy' (relations to the focus country). */
  setMapMode(mode) {
    if (!MAP_MODES.includes(mode)) return false;
    this.mode = mode; this.paintRelations(); return true;
  }
  /** Country whose relations are shown; null returns to the viewer's own country. */
  setRelationFocus(country) {
    this.relationFocus = typeof country === 'string' && this.countries.has(country) ? country : null;
    this.paintRelations(); return this.relationFocus;
  }
  hoverCountry(country) {
    if (country === this.pendingHover) return;
    this.pendingHover = country; clearTimeout(this.hoverTimer);
    if (!country) { if (this.hoverFocus) { this.hoverFocus = null; this.paintOutlines(); } return; }
    this.hoverTimer = setTimeout(() => { this.hoverFocus = country; this.paintOutlines(); }, 300);
  }
  setLegendPlacement(placement) {
    this.legendPlacement = LEGEND_PLACEMENTS.includes(placement) ? placement : 'bottom-left';
    for (const p of LEGEND_PLACEMENTS) this.chip.classList.toggle(`at-${p}`, p === this.legendPlacement);
    return this.legendPlacement;
  }
  /** Collapse the key to a single chip (the mode toggle hides with it). */
  setLegendCollapsed(collapsed) {
    this.chip.classList.toggle('collapsed', Boolean(collapsed));
    this.keyButton.setAttribute('aria-expanded', String(!collapsed));
    this.keyButton.textContent = collapsed ? 'Map key' : 'Hide key';
    return Boolean(collapsed);
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
    // Keep the mode chip inside the visible map, whatever else shares the container.
    // Expose the visible map's insets so CSS can place the key inside it, whatever shares the container.
    const box = this.svg.getBoundingClientRect(), host = this.chip.parentElement?.getBoundingClientRect();
    if (host && !this.chipDetached) for (const side of ['top', 'right', 'bottom', 'left'])
      this.chip.style.setProperty(`--atlas-map-${side}`, `${Math.max(0, side === 'top' || side === 'left' ? box[side] - host[side] : host[side] - box[side])}px`);
    for (const fx of this.pointEffects) fx.g.setAttribute('transform', `translate(${fx.x} ${fx.y}) scale(${scale})`);
    if (!this.state) {
      for (const p of this.map.provinces) this.markers.get(p.id).group.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${scale})`);
      return;
    }
    this.armyRects = this.armyObstacles(px);
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
      // The footprint reserves the industry row below every counter (pips, or a merged total), at every zoom.
      const badge = u.members.length > 1 ? 4 : 0, pips = !battle && u.owner ? (u.members.length > 1 ? 12 : 8) : 0;
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
        // Names: reserved space when zoomed in, only where uncrowded at mid, never at country level.
        // Try above the counter, then below it; otherwise the name waits for more zoom.
        const width = this.places.get(id).name.length * 5.8 + 4;
        let named = false;
        if (level !== 'far') for (const [dy, y] of [[-COUNTER_H / 2 - 15, -17], [COUNTER_H / 2 + (level === 'near' ? 8 : 1), level === 'near' ? 29 : 22]]) {
          const label = { x: u.x * px + u.dx - width / 2, y: u.y * px + u.dy + dy, w: width, h: 13 };
          const overlaps = q => label.x < q.x + q.w && q.x < label.x + label.w && label.y < q.y + q.h && q.y < label.y + label.h;
          if (u.locked && y < 0 || !placed.some(q => q !== u.rect && overlaps(q)) && !labels.some(overlaps) && !this.armyRects.some(overlaps)) {
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
    this.counterRects = placed;
    const taken = [...placed, ...labels, ...this.armyRects];
    this.paintCountryNames(level, px, scale, taken);
    this.paintAllianceNames(level, px, scale, taken);
    this.positions();
  }
  cluster(key) {
    if (!this.clusters.has(key)) {
      const group = node('g', { class: 'map-counter map-cluster', 'data-cluster': key, tabindex: 0, role: 'button' });
      const disc = node('rect', { y: -10, height: COUNTER_H, rx: 1, class: 'counter-body' }), stripe = node('rect', { y: -10, width: 4, height: COUNTER_H, class: 'counter-stripe' });
      const text = node('text', { x: 2, y: .5, class: 'counter-value' }), badge = node('g', { class: 'cluster-badge' }), bloc = node('rect', { y: -10, width: 2.5, height: COUNTER_H, class: 'counter-bloc' });
      const badgeBody = node('rect', { y: -16, height: 12, rx: 6 }), badgeText = node('text', { y: -9.6 });
      badge.append(badgeBody, badgeText);
      // Merged industry: one pip and the members' combined development, where single counters show pips.
      const industry = node('g', { class: 'industry-pips cluster-industry', 'aria-hidden': 'true' });
      const industryBody = node('rect', { y: 12, height: 10, rx: 2, class: 'cluster-industry-body' });
      const industryText = node('text', { y: 17.4, class: 'cluster-industry-value' });
      // A drawn factory (saw-tooth roof and stack): no font glyph dependency.
      const factory = node('path', { class: 'cluster-industry-icon', d: 'M0,21V16l2,-1.5V16l2,-1.5V16l2,-1.5V13h1.2V21Z' });
      industry.append(industryBody, factory, industryText);
      group.append(bloc, disc, stripe, text, badge, industry); this.clusterLayer.append(group);
      this.clusters.set(key, { group, disc, stripe, bloc, text, badgeBody, badgeText, industry, industryText, industryBody, factory });
    }
    return this.clusters.get(key);
  }
  paintCluster(cluster, u) {
    const width = counterWidth(u.troops), color = this.countries.get(u.owner)?.color || NEUTRAL, count = String(u.members.length);
    cluster.disc.setAttribute('width', width); cluster.disc.setAttribute('x', -width / 2); cluster.disc.setAttribute('stroke', color);
    cluster.stripe.setAttribute('x', -width / 2); cluster.stripe.setAttribute('fill', color);
    const blocColor = this.blocColor?.(u.owner); cluster.bloc.style.display = blocColor ? '' : 'none';
    if (blocColor) { cluster.bloc.setAttribute('fill', blocColor); cluster.bloc.setAttribute('x', -width / 2 - 3); }
    cluster.text.textContent = u.troops; cluster.badgeText.textContent = count;
    const bw = 6 + count.length * 6; cluster.badgeBody.setAttribute('width', bw); cluster.badgeBody.setAttribute('x', width / 2 - bw + 4);
    cluster.badgeText.setAttribute('x', width / 2 - bw / 2 + 4);
    const industry = u.owner ? u.members.reduce((n, id) => n + (this.state.provinces.find(p => p.id === id)?.development || 0), 0) : 0;
    cluster.industry.style.display = industry ? '' : 'none'; cluster.industryText.textContent = industry;
    const tagW = 12 + String(industry).length * 5.4, left = -tagW / 2;
    cluster.industryBody.setAttribute('x', left); cluster.industryBody.setAttribute('width', tagW);
    cluster.factory.setAttribute('transform', `translate(${left + 2} 0)`); cluster.industryText.setAttribute('x', left + 10.5);
    cluster.group.dataset.total = u.troops; cluster.group.dataset.owner = u.owner || ''; cluster.group.dataset.industry = industry;
    cluster.group.classList.toggle('owned', Boolean(u.owner && u.owner === this.state.you));
    cluster.group.setAttribute('aria-label', `${this.countries.get(u.owner)?.name || 'Uncontrolled'}: ${u.members.length} provinces, ${u.troops} troops${industry ? `, industry ${industry}` : ''} combined. Activate to zoom in.`);
  }
  /** Screen rectangles swept by each visible army over the next interpolation window. */
  armyObstacles(px) {
    if (!this.state) return [];
    const speed = this.state.status === 'running' && !this.reducedMotion ? this.state.speed || 1 : 0, rects = [];
    for (const army of this.state.armies) {
      if (army.engaged) continue;
      const size = this.armies.get(army.id)?.large ? 1.3 : 1;
      const at = t => journeyPoint(army, this.positionsById, Math.min(t, army.arrivesAt - .01));
      const a = at(this.state.tick), b = at(this.state.tick + 2 * speed), ax = this.near(a.x), bx = ax + wrapDelta(b.x - a.x);
      const x0 = Math.min(ax, bx) * px - 12 * size, x1 = Math.max(ax, bx) * px + 12 * size;
      const y0 = Math.min(a.y, b.y) * px - 24 * size, y1 = Math.max(a.y, b.y) * px + 9 * size;
      rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    return rects;
  }
  /** Largest land-contiguous group of provinces among `ids`. */
  region(ids) {
    const pool = new Set(ids), seen = new Set(); let best = [];
    for (const start of ids) {
      if (seen.has(start)) continue;
      const group = [], queue = [start]; seen.add(start);
      while (queue.length) { const id = queue.shift(); group.push(id); for (const n of this.landNeighbors.get(id) || []) if (pool.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); } }
      if (group.length > best.length) best = group;
    }
    return best;
  }
  /** Coalition names across each bloc (player text: textContent only, length capped). */
  paintAllianceNames(level, px, scale, taken) {
    this.allianceNames.replaceChildren();
    if (level === 'near') return;
    const overlaps = r => taken.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    for (const bloc of this.blocInfo || []) {
      const members = new Set(bloc.members), owned = this.state.provinces.filter(p => members.has(p.owner)).map(p => p.id);
      const best = this.region(owned);
      if (!best.length) continue;
      const raw = bloc.name.length > 28 ? `${bloc.name.slice(0, 27)}…` : bloc.name, text = raw.toUpperCase();
      const width = text.length * 10.8 + 14, height = 28;
      const mx = best.reduce((n, id) => n + this.places.get(id).x, 0) / best.length, my = best.reduce((n, id) => n + this.places.get(id).y, 0) / best.length;
      const anchors = [{ x: mx, y: my }, ...best.map(id => this.places.get(id)).sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my) || a.id.localeCompare(b.id))];
      const onLand = (x, y) => owned.some(id => insideRings([x, y], this.rings.get(id)));
      search: for (const { x, y } of anchors) for (const dy of [0, 30, -30, 48, -48]) {
        const sx = this.near(x), r = { x: sx * px - width / 2, y: y * px + dy - 11, w: width, h: height };
        if (!onLand(x, y + dy * scale) || overlaps(r)) continue;
        const g = node('g', { class: 'alliance-name', 'data-bloc': bloc.id, transform: `translate(${sx} ${y + dy * scale}) scale(${scale})` });
        const label = node('text', { class: 'alliance-label', fill: bloc.color }); label.textContent = text;
        g.append(label);
        bloc.members.slice(0, 8).forEach((id, i, all) => g.append(node('rect', { class: 'alliance-pip', x: (i - all.length / 2) * 11 + 1, y: 9, width: 9, height: 5, fill: this.countries.get(id)?.color || NEUTRAL })));
        this.allianceNames.append(g); taken.push(r); break search;
      }
    }
  }
  paintCountryNames(level, px, scale, taken) {
    this.countryNames.replaceChildren();
    if (level !== 'far') return;
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
    // Provinces of the viewer that an army at war with it is marching on get a red ring (v0.8: no alert stack).
    const threatened = new Set(me ? state.armies.filter(a => threatening(state, a, state.you)).map(a => a.to) : []);
    for (const p of state.provinces) {
      const shape = this.shapes.get(p.id), marker = this.markers.get(p.id);
      if (!shape) continue;
      const role = p.id === source ? 'selected' : p.id === destination ? 'destination' : neighbors.includes(p.id) ? 'neighbor' : '';
      shape.setAttribute('class', `province ${role}${p.owner ? ' occupied' : ''}${threatened.has(p.id) ? ' threatened' : ''}`);
      marker.group.setAttribute('class', `map-counter ${role}${p.owner === state.you && state.you ? ' owned' : ''}${threatened.has(p.id) ? ' threatened' : ''}`);
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
    this.paintRelations();
    for (const c of this.map.countries) {
      const owned = state.provinces.filter(p => p.owner === c.id).map(p => p.id);
      if (owned.length) this.lastOwned.set(c.id, owned);
    }
    for (const edge of this.seas.children) edge.classList.toggle('selected-connection', edge.dataset.edge.split('|').includes(source));
    this.connections.replaceChildren();
    for (const id of neighbors) this.connections.append(node('path', { d: this.path(source, id), class: id === destination ? 'target-connection' : 'adjacent-connection', ...(id === destination ? { 'marker-end': `url(#${this.prefix}march-head)` } : {}) }));
    this.routes.replaceChildren();
    for (const p of state.provinces) if (p.route && (p.owner === state.you || p.id === source)) this.routes.append(node('path', { d: this.path(p.id, p.route), class: 'recruit-connection', 'marker-end': `url(#${this.prefix}march-head)` }));
    // Your rally points (private to you): a dashed arrow in your colour from source to rally province.
    for (const r of state.rallies || []) this.routes.append(node('path', { d: this.path(r.from, r.to), class: 'rally-halo' }), node('path', { d: this.path(r.from, r.to), stroke: this.countries.get(r.country)?.color || NEUTRAL,
      class: `rally-connection${r.status === 'paused' ? ' paused' : ''}`, 'data-rally': r.from, 'marker-end': `url(#${this.prefix}march-head)` }));
    this.trails.replaceChildren();
    for (const a of state.armies) if (a.amount >= 5 && !a.engaged && (a.country === state.you || a.to === destination || a.from === source)) {
      this.trails.append(node('path', { d: this.pointPath(a.startPoint || this.places.get(a.from), this.places.get(a.to)), class: `army-trail${a.returning ? ' returning' : ''}` }));
    }
    const ids = new Set(state.armies.map(a => a.id));
    for (const [id, entry] of this.armies) if (!ids.has(id)) { entry.group.remove(); this.armies.delete(id); }
    // Moving armies: the top map layer, drawn once on the copy nearest the view centre.
    const strength = new Map();
    for (const p of state.provinces) if (p.owner) strength.set(p.owner, (strength.get(p.owner) || 0) + p.troops);
    for (const a of state.armies) strength.set(a.country, (strength.get(a.country) || 0) + a.amount);
    const biggest = new Set(state.armies.filter(a => !a.engaged && a.amount >= 5).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id)).slice(0, 3).map(a => a.id));
    for (const army of state.armies) {
      if (!this.armies.has(army.id)) {
        const group = node('g', { class: 'moving-army', 'data-army': army.id, tabindex: 0, role: 'button' });
        const body = node('g'), halo = node('path', { class: 'army-halo', d: ARROW }), disc = node('path', { class: 'army-arrow', d: ARROW });
        const pill = node('rect', { class: 'army-pill', y: -22, height: 13, rx: 2 }), label = node('text', { class: 'army-count', y: -15.3 });
        body.append(halo, disc); group.append(body, pill, label, node('circle', { class: 'army-hit', r: 6.5 })); this.marches.append(group);
        this.armies.set(army.id, { group, body, disc, pill, label });
      }
      const entry = this.armies.get(army.id), hostile = Boolean(me) && threatening(state, army, state.you);
      const origin = army.startPoint || this.places.get(army.from), target = this.places.get(army.to), dx = wrapDelta(target.x - origin.x);
      entry.body.setAttribute('transform', `rotate(${Math.atan2(target.y - origin.y, dx) * 180 / Math.PI})`);
      const color = this.countries.get(army.country)?.color || NEUTRAL;
      entry.disc.setAttribute('fill', color); entry.pill.setAttribute('stroke', color);
      // Engaged armies are shown by the battle marker at their target, not as a moving arrow.
      entry.group.classList.toggle('hostile', Boolean(hostile)); entry.group.classList.toggle('engaged', Boolean(army.engaged));
      entry.group.classList.toggle('returning', Boolean(army.returning));
      entry.group.classList.toggle('minor', army.amount < 20 && !hostile && army.country !== state.you);
      entry.large = !army.engaged && army.amount >= 5 && (army.amount >= .25 * (strength.get(army.country) || Infinity) || biggest.has(army.id));
      entry.group.classList.toggle('large', entry.large);
      const count = army.amount >= 3 ? String(army.amount) : '', w = count.length * 6.6 + 7;
      entry.label.textContent = count; entry.pill.style.display = count ? '' : 'none';
      entry.pill.setAttribute('width', w); entry.pill.setAttribute('x', -w / 2);
      entry.group.setAttribute('aria-label', `${this.countries.get(army.country)?.name || 'Army'}: ${army.amount} troops, ${this.places.get(army.from)?.name} to ${this.places.get(army.to)?.name}${army.returning ? ', returning' : ''}`);
    }
    this.paintBattles(state);
    this.paintDraft();
    this.layout();
    if (!this.frame && !this.reducedMotion && state.status === 'running') this.frame = requestAnimationFrame(() => this.animate());
  }
  /** Colours, border classes, war fronts, alliance blocs, hover outlines and the legend. */
  paintRelations() {
    const state = this.state;
    if (!state) { this.paintLegend({}, null); return; }
    const colors = allianceColors(state), sideOf = new Map(state.players.map(p => [p.id, p.side])), owner = id => this.byId.get(id)?.owner || null;
    this.blocColor = country => country ? colors[sideOf.get(country)] || null : null;
    const focus = this.mode === 'diplomacy' ? this.relationFocus || state.you || this.hoverFocus || null : null;
    const rel = focus ? relationsOf(state, focus) : null;
    const fill = country => !rel ? this.countries.get(country)?.color || '#aaa994' : !country ? RELATION.none : country === focus ? RELATION.focus :
      rel.allies.includes(country) ? RELATION.ally : rel.enemies.includes(country) ? RELATION.enemy : RELATION.neutral;
    for (const p of state.provinces) {
      this.shapes.get(p.id)?.setAttribute('fill', fill(p.owner));
      const marker = this.markers.get(p.id), bloc = this.blocColor(p.owner);
      if (!marker) continue;
      marker.bloc.style.display = bloc ? '' : 'none';
      if (bloc) { marker.bloc.setAttribute('fill', bloc); marker.bloc.setAttribute('x', -counterWidth(p.troops) / 2 - 3); }
    }
    this.svg.dataset.mode = rel ? 'diplomacy' : 'political'; this.svg.dataset.relationFocus = focus || '';
    // Province borders (same owner), softened allied borders (same coalition), country borders.
    for (const b of this.borders) {
      const oa = owner(b.a), ob = owner(b.b);
      const kind = oa === ob ? 'province' : oa && ob && sideOf.get(oa) === sideOf.get(ob) ? 'allied' : 'country';
      if (kind !== b.kind) { b.kind = kind; ({ province: this.provinceBorders, allied: this.alliedBorders, country: this.countryBorders })[kind].append(b.el); }
    }
    // War fronts: every land border between owners at war; sea links only where no land contact.
    const want = new Map(), contact = new Set();
    for (const b of this.borders) {
      const oa = owner(b.a), ob = owner(b.b);
      if (oa && ob && oa !== ob && atWar(state, oa, ob)) { want.set(`${b.a}|${b.b}`, b); contact.add(warKey(oa, ob)); }
    }
    for (const [key, el] of this.frontEls) if (!want.has(key)) { el.remove(); this.frontEls.delete(key); }
    for (const [key, b] of want) if (!this.frontEls.has(key)) {
      const el = node('g', { class: 'war-front', 'data-front': key });
      el.append(node('path', { d: b.d, class: 'war-front-glow' }), node('path', { d: b.d, class: 'war-front-teeth' }));
      this.fronts.append(el); this.frontEls.set(key, el);
    }
    this.seaFronts.replaceChildren();
    for (const e of this.map.edges) {
      const oa = owner(e.from), ob = owner(e.to);
      if (e.sea && oa && ob && oa !== ob && atWar(state, oa, ob) && !contact.has(warKey(oa, ob)))
        this.seaFronts.append(node('path', { d: this.path(e.from, e.to), class: 'sea-front', 'data-sea-front': `${e.from}|${e.to}` }));
    }
    // Alliance blocs: one outline around the union of the members' land, inner glow via a clip.
    const live = new Set();
    this.blocInfo = [];
    for (const c of coalitions(state)) {
      const members = new Set(c.members), ids = state.provinces.filter(p => members.has(p.owner)).map(p => p.id).sort();
      if (!ids.length) continue;
      live.add(c.id); this.blocInfo.push({ ...c, color: colors[c.id] });
      let e = this.blocEls.get(c.id);
      if (!e) {
        const clipId = `${this.svg.id}-bloc-${++this.blocSeq}`, clip = node('clipPath', { id: clipId }), shape = node('path');
        const band = node('path', { class: 'bloc-band', 'clip-path': `url(#${clipId})` }), line = node('path', { class: 'bloc-line' }), g = node('g', { class: 'alliance-bloc' });
        clip.append(shape); g.append(clip, band, line); this.blocs.append(g); e = { g, shape, band, line }; this.blocEls.set(c.id, e);
      }
      const key = ids.join(',');
      if (e.key !== key) {
        e.key = key; const d = this.outline(new Set(ids));
        e.shape.setAttribute('d', ids.map(id => this.places.get(id).path).join('')); e.band.setAttribute('d', d); e.line.setAttribute('d', d);
      }
      e.g.dataset.bloc = c.id; e.g.dataset.members = c.members.join(','); e.g.dataset.provinces = key;
      e.band.setAttribute('stroke', colors[c.id]); e.line.setAttribute('stroke', colors[c.id]);
    }
    // Forming alliances (approved, inside the activation delay): dashed outline in the future colour.
    this.formingInfo = [];
    for (const f of formingAlliances(state)) {
      const members = new Set(f.members), ids = state.provinces.filter(p => members.has(p.owner)).map(p => p.id).sort();
      if (!ids.length || !colors[f.id]) continue;
      const key = `forming:${f.id}`; live.add(key); this.formingInfo.push({ ...f, color: colors[f.id] });
      let e = this.blocEls.get(key);
      if (!e) { const g = node('g', { class: 'alliance-bloc forming' }), line = node('path', { class: 'bloc-line bloc-forming' }); g.append(line); this.blocs.append(g); e = { g, line }; this.blocEls.set(key, e); }
      const provinces = ids.join(',');
      if (e.key !== provinces) { e.key = provinces; e.line.setAttribute('d', this.outline(new Set(ids))); }
      e.g.dataset.forming = f.id; e.g.dataset.members = f.members.join(','); e.g.dataset.provinces = provinces;
      e.line.setAttribute('stroke', colors[f.id]);
    }
    for (const [id, e] of this.blocEls) if (!live.has(id)) { e.g.remove(); this.blocEls.delete(id); }
    this.paintOutlines(); this.paintLegend(colors, focus);
  }
  /** Temporary relation outlines for a hovered/focused country or the chosen relation focus. */
  paintOutlines() {
    if (this.mode === 'diplomacy' && !this.relationFocus && !this.state?.you && this.state) { this.paintRelationsSoon(); }
    const who = this.state ? this.hoverFocus || this.relationFocus : null;
    const rel = who ? relationsOf(this.state, who) : null;
    const land = countries => this.state.provinces.filter(p => countries.includes(p.owner)).map(p => p.id);
    for (const [kind, list] of [['focus', rel ? [who] : []], ['ally', rel?.allies || []], ['enemy', rel?.enemies || []]])
      this.relationPaths[kind].setAttribute('d', list.length ? this.outline(new Set(land(list))) : '');
    this.svg.dataset.outlineFocus = who || '';
  }
  paintRelationsSoon() {
    if (this.relationsFrame) return;
    this.relationsFrame = requestAnimationFrame(() => { this.relationsFrame = null; if (this.svg.dataset.relationFocus !== (this.hoverFocus || '')) this.paintRelations(); });
  }
  paintLegend(colors, focus) {
    const diplomacy = this.mode === 'diplomacy';
    this.modeButton.textContent = diplomacy ? 'Political view' : 'Diplomacy view';
    this.modeButton.setAttribute('aria-pressed', String(diplomacy)); this.chip.classList.toggle('diplomacy', diplomacy);
    this.legend.replaceChildren();
    const heading = text => { const b = document.createElement('b'); b.textContent = text; this.legend.append(b); };
    const item = (color, text, kind) => {
      const row = document.createElement('span'), swatch = document.createElement('i'), label = document.createElement('span');
      row.className = `legend-item legend-${kind}`; swatch.style.background = color; swatch.style.color = color; label.textContent = text; row.append(swatch, label); this.legend.append(row);
    };
    if (diplomacy) {
      heading(focus ? `Relations of ${this.countries.get(focus)?.name || focus}` : 'Hover a country');
      item(RELATION.focus, focus ? this.countries.get(focus)?.name || 'Focus' : 'Focus', 'focus'); item(RELATION.ally, 'Allies', 'ally');
      item(RELATION.enemy, 'At war', 'enemy'); item(RELATION.neutral, 'Neutral', 'neutral'); item(RELATION.none, 'Uncontrolled', 'none');
    } else {
      const cap = name => name.length > 28 ? `${name.slice(0, 27)}…` : name;
      if ((this.blocInfo || []).length || (this.formingInfo || []).length) heading('Alliances');
      for (const bloc of this.blocInfo || []) item(bloc.color, cap(bloc.name), 'bloc');
      for (const f of this.formingInfo || []) item(f.color, `${cap(f.name)} · forming`, 'forming');
      const wars = this.state?.wars || [];
      if (wars.length) heading('At war');
      for (const pair of wars.slice(0, 4)) item('#d8342a', pair.split(':').map(id => faction(id).short).join(' – '), 'war');
      if (wars.length > 4) heading(`+${wars.length - 4} more wars`);
    }
    this.legend.hidden = !this.legend.childElementCount;
    this.keyButton.hidden = this.legend.hidden; this.chip.classList.toggle('empty', this.legend.hidden);
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
      // Tug of war: team colours (coalition colour, else country fill), split at the troop share.
      const colors = battleColors(teamColor(state, lead, this.countries.get(lead)?.color), teamColor(state, p.owner, this.countries.get(p.owner)?.color));
      this.battleInfo.set(p.id, { battle, attack, defend, lead, width, colors, ratio: this.battleRatio(attack, defend) });
    }
    for (const [id, mark] of this.battleMarks) if (!this.battleInfo.has(id) && !mark.resolved) this.resolveBattle(id, mark);
    for (const [id, info] of this.battleInfo) {
      if (this.battleMarks.get(id)?.resolved) { this.battleMarks.get(id).group.remove(); this.battleMarks.delete(id); }
      if (!this.battleMarks.has(id)) {
        const group = node('g', { class: 'battle-counter', 'data-province': id, tabindex: 0, role: 'button' });
        const pulse = node('rect', { class: 'battle-pulse', y: -16, height: 32, rx: 3 });
        // Plain rects (no gradient/clip IDs): defender bar, attacker bar scaled from the left, divider, frame.
        const right = node('rect', { class: 'battle-defend-bar', y: -12, height: 24 }), left = node('rect', { class: 'battle-attack-bar', y: -12, height: 24 });
        const divider = node('rect', { class: 'battle-divider', x: -1, y: -12, width: 2, height: 24 }), body = node('rect', { class: 'battle-body', y: -12, height: 24, rx: 1 });
        const attack = node('text', { class: 'battle-value attack', y: .5 }), defend = node('text', { class: 'battle-value defend', y: .5 });
        const swords = node('path', { class: 'battle-swords', d: SWORDS }), flashes = node('g', { class: 'battle-flashes', 'aria-hidden': 'true' });
        const name = node('text', { class: 'province-name battle-name', y: -20 }); name.textContent = this.places.get(id).name;
        group.append(pulse, right, left, divider, body, attack, swords, defend, name, flashes); this.battleLayer.append(group);
        this.battleMarks.set(id, { group, pulse, body, left, right, divider, attack, defend, flashes });
      }
      const mark = this.battleMarks.get(id), w = info.width, aw = String(info.attack).length * 7.5 + 8, dw = String(info.defend).length * 7.5 + 8;
      mark.pulse.setAttribute('x', -w / 2 - 3); mark.pulse.setAttribute('width', w + 6);
      mark.body.setAttribute('x', -w / 2); mark.body.setAttribute('width', w);
      mark.info = info; mark.w = w;
      mark.left.setAttribute('fill', info.colors.attacker); mark.right.setAttribute('fill', info.colors.defender);
      this.setSplit(mark, info.ratio);
      const swordsAt = -w / 2 + 5 + aw + 11;
      mark.attack.setAttribute('x', -w / 2 + 5 + aw / 2); mark.attack.textContent = info.attack;
      mark.group.querySelector('.battle-swords').setAttribute('transform', `translate(${swordsAt} 0)`);
      mark.defend.setAttribute('x', w / 2 - 5 - dw / 2); mark.defend.textContent = info.defend;
      mark.group.dataset.attack = info.attack; mark.group.dataset.defend = info.defend; mark.group.dataset.ratio = info.ratio.toFixed(4);
      mark.group.dataset.attackColor = info.colors.attacker; mark.group.dataset.defendColor = info.colors.defender;
      mark.group.setAttribute('aria-label', `Battle at ${this.places.get(id).name}: ${info.attack} attacking, ${info.defend} defending`);
      // Flash only a round this atlas has not shown yet; a fresh load never replays old rounds.
      const round = info.battle.lastRound, key = info.battle.id || id, seen = this.seenRounds.get(key);
      if (round && seen !== undefined && round.tick > seen) this.roundFlash(mark, round, w, aw);
      this.seenRounds.set(key, round?.tick ?? -1);
    }
  }
  /** Attacker share of the bar; each side keeps at least 6% while it has troops. */
  battleRatio(attack, defend) {
    if (attack + defend <= 0) return .5;
    let r = attack / (attack + defend);
    if (attack > 0) r = Math.max(r, .06);
    if (defend > 0) r = Math.min(r, .94);
    return r;
  }
  setSplit(mark, ratio) {
    const w = mark.w;
    for (const bar of [mark.left, mark.right]) { bar.setAttribute('x', -w / 2); bar.setAttribute('width', w); }
    mark.left.style.transform = `scaleX(${ratio})`;
    mark.divider.style.transform = `translateX(${-w / 2 + ratio * w}px)`;
    mark.divider.style.display = ratio <= 0 || ratio >= 1 ? 'none' : '';
  }
  /** A finished battle fills with the winner's colour for a final flash, then disappears. */
  resolveBattle(id, mark) {
    mark.resolved = true;
    const won = (this.byId.get(id)?.owner || null) !== (mark.info?.battle.previousOwner || null);
    mark.group.classList.add('resolved', 'battle-hit'); mark.group.removeAttribute('tabindex'); mark.group.removeAttribute('data-province');
    this.setSplit(mark, won ? 1 : 0);
    this.later(() => { mark.group.remove(); if (this.battleMarks.get(id) === mark) this.battleMarks.delete(id); }, this.reducedMotion ? 600 : 900);
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
        const outline = this.outline(new Set(members.flatMap(c => this.territory(c)))), color = this.blocColor?.(members[0]) || ALLIANCE;
        if (outline) g.append(node('path', { class: 'fx-glow', d: outline, stroke: color }), node('path', { class: 'fx-glow-core', d: outline }));
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
    const px = this.svg.getScreenCTM()?.a || 1, scale = 1 / px, counters = this.counterRects || [];
    for (const army of this.state.armies) {
      const point = journeyPoint(army, this.positionsById, Math.min(this.state.tick + elapsed, army.arrivesAt - .01));
      const entry = this.armies.get(army.id);
      if (!entry) continue;
      const size = entry.large ? 1.3 : 1, x = this.near(point.x);
      entry.group.setAttribute('transform', `translate(${x} ${point.y}) scale(${scale * size})`);
      // Taps on a province counter always win: an army's small hit target (≤17 px) switches off
      // while it overlaps any counter or battle box. Keyboard focus (Tab) is unaffected.
      const r = 6.5 * size, sx = x * px, sy = point.y * px;
      const blocked = counters.some(q => sx + r > q.x && sx - r < q.x + q.w && sy + r > q.y && sy - r < q.y + q.h);
      if (entry.blocked !== blocked) { entry.blocked = blocked; entry.group.classList.toggle('tap-blocked', blocked); }
    }
  }
  /** Order arrows (v0.8): `{ sources: [id], to: id|null, label }` drawn from each source to the target,
   * or null. During a drag the atlas draws its own arrow to the pointer, snapped to adjacent targets. */
  setDraft(draft) { this.draftState = draft && draft.sources?.length ? draft : null; this.paintDraft(); }
  paintDraft() {
    const layer = this.draftLayer; if (!layer) return;
    layer.replaceChildren();
    const drag = this.dragging, draft = drag ? { sources: [drag.from], to: drag.to, point: drag.to ? null : drag.point, label: drag.label } : this.draftState;
    this.svg.classList.toggle('command-drag', Boolean(drag));
    if (!draft) return;
    const px = this.svg.getScreenCTM()?.a || 1, target = draft.to ? this.places.get(draft.to) : draft.point;
    if (!target) return;
    const first = this.places.get(draft.sources[0]); if (!first) return;
    const tx = draft.to ? this.near(target.x) : target.x, ty = target.y;
    for (const id of draft.sources) {
      const s = this.places.get(id); if (!s) continue;
      const sx = tx + wrapDelta(s.x - tx), len = Math.hypot(tx - sx, ty - s.y), back = draft.to ? Math.min(len * .35, 12 / px) : 0;
      const ex = len ? tx - (tx - sx) * back / len : tx, ey = len ? ty - (ty - s.y) * back / len : ty;
      layer.append(node('path', { class: `draft-arrow${draft.to ? ' snapped' : ''}`, d: `M${sx},${s.y}L${ex},${ey}`, 'marker-end': `url(#${this.prefix}march-head)` }));
    }
    if (draft.label) {
      const g = node('g', { class: 'draft-label', transform: `translate(${tx} ${ty - 18 / px}) scale(${1 / px})` });
      const text = node('text', { y: 4 }); text.textContent = draft.label; // host-authored (numbers and times), never player text
      const w = draft.label.length * 6.4 + 12; g.append(node('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 3 }), text); layer.append(g);
    }
  }
  /** Pointer position during an order drag: snap to the adjacent province under (or within 28 px of) it. */
  dragTo(clientX, clientY) {
    const from = this.gesture?.command; if (!from) return;
    if (!this.dragging) this.dragHooks?.begin?.(from);
    const neighbors = this.places.get(from)?.neighbors || [], point = this.coordinates(clientX, clientY), px = this.svg.getScreenCTM()?.a || 1;
    const el = document.elementFromPoint(clientX, clientY);
    let to = el?.closest?.('[data-province]')?.dataset.province || null;
    const cluster = el?.closest?.('[data-cluster]')?.dataset.cluster;
    if (!to && cluster) to = cluster.split(',').find(id => neighbors.includes(id)) || null;
    if (!to && this.svg.contains(el)) to = this.provinceAt(point);
    if (!neighbors.includes(to)) {
      to = null; let best = 28 / px;
      for (const id of neighbors) { const q = this.places.get(id), d = Math.hypot(point.x - (point.x + wrapDelta(q.x - point.x)), point.y - q.y); if (d < best) { best = d; to = id; } }
    }
    this.dragging = { from, to, point, label: to ? this.dragHooks?.label?.(from, to) || '' : '' };
    this.paintDraft();
  }
  endDraft(from, to = null) {
    const was = this.dragging; this.dragging = null; this.paintDraft();
    if (from && was) this.dragHooks?.end?.(from, to);
  }
  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;
    if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame); this.layoutFrame = null;
    for (const t of this.timers) clearTimeout(t); this.timers.clear();
    clearTimeout(this.hoverTimer); if (this.relationsFrame) cancelAnimationFrame(this.relationsFrame);
    this.resize.disconnect(); this.tooltip.remove(); this.chip.remove();
  }
  animate() { this.frame = null; this.positions(); if (this.state?.status === 'running') this.frame = requestAnimationFrame(() => this.animate()); }
}
