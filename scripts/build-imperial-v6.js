/** Build the published map `imperial-1910-v7` (public/imperial-map.json) from the v5 source geometry.
 *
 *   node scripts/build-imperial-v6.js           write public/imperial-map.json
 *   node scripts/build-imperial-v6.js --check   exit 1 unless the published file is exactly what this script builds
 *
 * Deterministic and dependency-free. Steps (docs/MAP-V6.md explains the design):
 * 1. Dissolve: each v6 province is a union of whole v5 provinces (scripts/map-source/, Natural Earth
 *    admin-1 unions). A segment used by two members of the same v6 province is interior and removed.
 *    Wastelands (impassable terrain, WASTELANDS below) are cut out of members first and join the topology
 *    as groups of their own: land that no province owns, so the provinces beside it share no border.
 * 2. Topology: the remaining segments form arcs between junctions (a junction is where three or more
 *    lines meet or where the pair of provinces on the two sides changes). Each arc is stored once, so
 *    both neighbours of a border draw the very same line.
 * 3. Generalise: land borders (arcs with a province on both sides) are simplified (Douglas–Peucker) and
 *    smoothed (Chaikin), endpoints fixed. Coastlines keep their detail. An arc that would cross another
 *    line is retried with a smaller tolerance, so the result stays a valid planar partition.
 * 4. Adjacency: two provinces are land neighbours exactly when they share a border arc. Every other
 *    connection is a declared sea link in SEA_LINKS below (never a pair that already shares a border).
 * 5. Anchors: each counter sits on the pole of inaccessibility of the province's home landmass (the
 *    interior point farthest from its edges), so labels and counters stay inside the shape.
 * Holdings, industry and garrisons are authored game abstractions, not a historical census.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const SOURCE = JSON.parse(readFileSync(new URL('scripts/map-source/imperial-v5-provinces.json', ROOT), 'utf8'));
const OUT = new URL('public/imperial-map.json', ROOT);

/** Regions (Risk-style continents): presentation and analysis only, no rule reads them.
 * [id, name, label x, label y] — the label sits in open water or empty land beside the region. */
const REGIONS = [
  ['north-america', 'North America', 125, 215],
  ['south-america', 'South America', 292, 572],
  ['europe', 'Europe', 560, 140],
  ['russia', 'Russia', 900, 40],
  ['middle-east', 'Near East', 862, 352],
  ['africa', 'Africa', 590, 400],
  ['asia', 'Asia', 1188, 262],
  ['oceania', 'Oceania', 1110, 612],
];

/** [id, name, region, v5 members]. The first member's published anchor picks the home landmass. */
const PROVINCES = [
  ['alaska', 'Alaska', 'north-america', ['alaska']],
  ['canada', 'Canada', 'north-america', ['east-canada', 'west-canada']],
  ['west-us', 'Pacific States', 'north-america', ['west-us']],
  ['central-us', 'Great Plains', 'north-america', ['central-us']],
  ['east-us', 'Atlantic States', 'north-america', ['east-us']],
  ['mexico', 'Mexico', 'north-america', ['mexico', 'central-america']],
  ['caribbean', 'Caribbean', 'south-america', ['caribbean']],
  ['brazil', 'Brazil', 'south-america', ['brazil', 'amazonia']],
  ['andes', 'Andes & Plata', 'south-america', ['andes', 'patagonia']],
  ['ireland', 'Ireland', 'europe', ['ireland']],
  ['england', 'Great Britain', 'europe', ['england', 'midlands', 'scotland']],
  ['iberia', 'Iberia', 'europe', ['iberia']],
  ['north-france', 'Northern France', 'europe', ['north-france', 'normandy']],
  ['south-france', 'Southern France', 'europe', ['occitania', 'south-france', 'alpine-france']],
  ['low-countries', 'Low Countries', 'europe', ['low-countries', 'belgium']],
  ['ruhr', 'Rhineland', 'europe', ['ruhr', 'rhineland']],
  ['prussia', 'Prussia', 'europe', ['brandenburg', 'prussia']],
  ['bavaria', 'Bavaria', 'europe', ['bavaria', 'saxony']],
  ['italy', 'Italy', 'europe', ['italy', 'south-italy']],
  ['scandinavia', 'Scandinavia', 'europe', ['scandinavia']],
  ['danube', 'Danube', 'europe', ['balkans']],
  ['balkans', 'Balkans', 'europe', ['serbia', 'bulgaria']],
  ['poland', 'Poland', 'russia', ['poland']],
  ['baltic', 'Baltic', 'russia', ['baltic']],
  ['west-russia', 'Moscow', 'russia', ['west-russia']],
  ['ukraine', 'Ukraine', 'russia', ['ukraine']],
  ['siberia', 'Siberia', 'russia', ['urals', 'siberia']],
  ['far-east', 'Russian Far East', 'russia', ['far-east']],
  ['central-asia', 'Central Asia', 'russia', ['central-asia']],
  ['anatolia', 'Anatolia', 'middle-east', ['anatolia']],
  ['caucasus', 'Caucasus', 'middle-east', ['east-anatolia']],
  ['levant', 'Levant', 'middle-east', ['levant']],
  ['mesopotamia', 'Mesopotamia', 'middle-east', ['mesopotamia']],
  ['arabia', 'Arabia', 'middle-east', ['arabia']],
  ['persia', 'Persia', 'middle-east', ['persia']],
  ['afghanistan', 'Afghanistan', 'middle-east', ['afghanistan']],
  ['maghreb', 'Maghreb', 'africa', ['maghreb']],
  ['egypt', 'Egypt', 'africa', ['egypt']],
  ['west-africa', 'West Africa', 'africa', ['west-africa']],
  ['sahel', 'Sahel', 'africa', ['sahara', 'sahel']],
  ['congo', 'Congo', 'africa', ['congo', 'angola']],
  ['east-africa', 'East Africa', 'africa', ['east-africa']],
  ['tanganyika', 'Tanganyika', 'africa', ['tanganyika']],
  ['namibia', 'South West Africa', 'africa', ['namibia']],
  ['south-africa', 'South Africa', 'africa', ['south-africa']],
  ['madagascar', 'Madagascar', 'africa', ['madagascar']],
  ['india', 'India', 'asia', ['north-india', 'south-india']],
  ['tibet', 'Tibet', 'asia', ['tibet']],
  ['mongolia', 'Mongolia', 'asia', ['mongolia']],
  ['manchuria', 'Manchuria', 'asia', ['manchuria']],
  ['north-china', 'Northern China', 'asia', ['north-china']],
  ['south-china', 'Southern China', 'asia', ['south-china']],
  ['korea', 'Korea', 'asia', ['korea']],
  ['japan', 'Japan', 'asia', ['south-japan', 'north-japan']],
  ['indochina', 'Indochina', 'asia', ['indochina']],
  ['east-indies', 'East Indies', 'oceania', ['east-indies']],
  ['philippines', 'Philippines', 'oceania', ['philippines']],
  ['australia', 'Australasia', 'oceania', ['australia', 'new-zealand']],
  ['hawaii', 'Hawaii', 'oceania', ['hawaii']],
];

/** Impassable terrain, as Crusader Kings draws it: land that belongs to no province, cannot be owned or crossed,
 * and is painted as mountains, desert or ice. No new rule: a wasteland simply sits between provinces, so they no
 * longer share a border and are not neighbours. Each is a set of polygons in map units, traced from the Natural
 * Earth physical regions by scripts/map-source/trace-wastelands.py (scripts/map-source/wastelands.json), and cut out
 * of every v5 member it overlaps. Most are scenery inside or across provinces; the Himalayas, Urals, Alps and Sahara
 * also create chokepoints (docs/MAP-V6.md, "Impassable terrain"); SEPARATED below proves it. `reassign` moves the
 * pieces of a member left inside its polygons to another province (the Russian land west of the Urals joins Moscow). */
const TERRAIN_SOURCE = JSON.parse(readFileSync(new URL('scripts/map-source/wastelands.json', ROOT), 'utf8'));
const WASTELANDS = TERRAIN_SOURCE.wastelands;
/** Province pairs a wasteland must keep apart (the build fails if they still share a border). */
const SEPARATED = [['india', 'tibet'], ['west-russia', 'siberia'], ['italy', 'south-france'], ['maghreb', 'sahel']];
/** Borders redrawn by hand where the source line is a survey artefact (a staircase, a ruler-straight line):
 * [v5 member, v5 member, [shared start vertex, …new points…, shared end vertex]]. Both members get the same line. */
const REDRAWN = [
  // The Western Sahara staircase between the Maghreb and West Africa.
  ['maghreb', 'west-africa', [[580.6, 293.7], [585.5, 292.2], [590.5, 290.2], [595.5, 286.4], [599.6, 281.6], [604.5, 278.4], [611, 276.6], [616, 275.9], [620.2, 274.5]]],
];
/** Counters placed by hand where the pole of inaccessibility would put them somewhere unrepresentative (Egypt's
 * widest land is the Sudan; its counter stays in the Nile delta). The build checks each one's clearance. */
const ANCHORS = { egypt: [749.3, 252.6] };

/** Every connection that is not a shared land border. [a, b, why]. Travel time follows map distance. */
const SEA_LINKS = [
  ['canada', 'ireland', 'North Atlantic lane'],
  ['east-us', 'caribbean', 'Florida Straits'],
  ['brazil', 'west-africa', 'South Atlantic narrows'],
  ['england', 'ireland', 'Irish Sea'],
  ['england', 'north-france', 'English Channel'],
  ['england', 'low-countries', 'North Sea'],
  ['england', 'scandinavia', 'North Sea'],
  ['england', 'egypt', 'Imperial lane: Gibraltar to Suez'],
  ['iberia', 'maghreb', 'Strait of Gibraltar'],
  ['south-france', 'maghreb', 'Marseille to Algiers'],
  ['italy', 'maghreb', 'Strait of Sicily'],
  ['italy', 'balkans', 'Strait of Otranto'],
  ['ruhr', 'namibia', 'German colonial lane'],
  ['namibia', 'tanganyika', 'German colonial lane'],
  ['egypt', 'arabia', 'Red Sea'],
  ['arabia', 'east-africa', 'Bab-el-Mandeb'],
  ['arabia', 'persia', 'Strait of Hormuz'],
  ['egypt', 'india', 'Suez to Bombay'],
  ['india', 'australia', 'Indian Ocean lane'],
  ['tanganyika', 'madagascar', 'Mozambique Channel'],
  ['south-africa', 'madagascar', 'Mozambique Channel'],
  ['west-africa', 'madagascar', 'French lane round the Cape'],
  ['madagascar', 'indochina', 'French Indian Ocean lane'],
  ['east-indies', 'australia', 'Timor Sea'],
  ['east-indies', 'philippines', 'Celebes Sea'],
  ['philippines', 'south-china', 'South China Sea'],
  ['philippines', 'japan', 'Ryukyu chain'],
  ['korea', 'north-china', 'Yellow Sea'],
  ['korea', 'japan', 'Tsushima Strait'],
  ['japan', 'far-east', 'Sakhalin'],
  ['alaska', 'far-east', 'Bering Strait'],
  ['west-us', 'hawaii', 'Pacific crossing'],
  ['hawaii', 'japan', 'Pacific crossing'],
  ['hawaii', 'philippines', 'Pacific crossing'],
];

/** Starting holdings: province → [industry level, troops]. Unlisted provinces start neutral (industry I, 2 troops). */
const COUNTRIES = [
  ['britain', 'British Empire', '#bc6b52', ['england', 'ireland'], {
    england: [3, 16], ireland: [1, 8], canada: [2, 22],
    india: [2, 16], egypt: [2, 12], 'south-africa': [1, 8], australia: [1, 8] }],
  ['france', 'French Republic', '#668dac', ['north-france', 'south-france'], {
    'north-france': [3, 16], 'south-france': [3, 14], maghreb: [1, 8], 'west-africa': [1, 7], indochina: [1, 7], madagascar: [1, 6] }],
  ['germany', 'German Empire', '#76808c', ['ruhr', 'prussia', 'bavaria'], {
    ruhr: [3, 16], prussia: [2, 15], bavaria: [3, 15], tanganyika: [1, 7], namibia: [1, 6] }],
  ['russia', 'Russian Empire', '#859361', ['west-russia', 'baltic', 'poland', 'ukraine', 'siberia', 'central-asia', 'far-east'], {
    'west-russia': [3, 16], baltic: [2, 12], poland: [2, 14], ukraine: [2, 12], siberia: [1, 10], 'central-asia': [1, 10], 'far-east': [1, 10] }],
  ['ottoman', 'Ottoman Empire', '#c49a53', ['anatolia', 'levant', 'mesopotamia', 'arabia'], {
    anatolia: [3, 16], levant: [1, 10], mesopotamia: [2, 10], arabia: [1, 6] }],
  ['qing', 'Qing Empire', '#ba9c65', ['manchuria', 'north-china', 'south-china', 'tibet'], {
    manchuria: [2, 12], 'north-china': [3, 14], 'south-china': [2, 12], tibet: [1, 6] }],
  ['japan', 'Empire of Japan', '#ab7890', ['japan', 'korea'], {
    japan: [3, 24], korea: [3, 20] }],
  ['usa', 'United States', '#6d9f96', ['west-us', 'central-us', 'east-us', 'alaska'], {
    'west-us': [2, 12], 'central-us': [2, 12], 'east-us': [3, 14], alaska: [1, 6], philippines: [1, 6] }],
];

// Generalisation of land borders, in map units (1 unit ≈ 0.29° longitude).
const TOLERANCE = 1.6, SMOOTHING = 2, MIN_BORDER = 1;

// ---------------------------------------------------------------------------------------------------
const groupOf = new Map(), members = new Map();
for (const [id, , , from] of PROVINCES) { members.set(id, from); for (const m of from) { if (groupOf.has(m)) throw new Error(`${m} used twice`); groupOf.set(m, id); } }
const unused = SOURCE.provinces.map(p => p.id).filter(id => !groupOf.has(id));
if (unused.length) throw new Error(`Unassigned v5 provinces: ${unused}`);
const sourceById = new Map(SOURCE.provinces.map(p => [p.id, p]));
const ringsOf = path => (String(path).match(/M[^MZ]+Z/g) || []).map(r => r.slice(1, -1).split('L').map(xy => xy.split(',').map(Number)));
const K = 100, key = ([x, y]) => `${Math.round(x * K)},${Math.round(y * K)}`;
const point = new Map(); // node key -> [x, y]
const segments = new Map(); // "a|b" (sorted) -> { a, b, count: Map(group -> n) }
const segKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

// Wastelands: every v5 member is clipped by each wasteland polygon it overlaps; the parts inside join the wasteland.
const wastelandIds = new Set(WASTELANDS.map(w => w.id));
for (const id of wastelandIds) if (members.has(id)) throw new Error(`wasteland ${id} shares an id with a province`);
const ringArea = r => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const bbox = r => r.reduce(([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)], [Infinity, Infinity, -Infinity, -Infinity]);
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
/** Greiner–Hormann clipping of a simple ring by a simple polygon: the rings of its parts inside and outside it.
 * A crossing is computed from the subject edge in a canonical direction and rounded to the key grid, so two
 * neighbouring members, which share their border vertices, get the very same crossing point. Touching (a vertex
 * on the other outline) is not handled: the build fails and the polygon is nudged at its source. */
function clipRing(subject, clip, what) {
  const E = 1e-9, sAt = subject.map(() => []), cAt = clip.map(() => []);
  for (let i = 0; i < subject.length; i++) {
    let a = subject[i], b = subject[(i + 1) % subject.length];
    const flip = key(a) > key(b); if (flip) [a, b] = [b, a];
    for (let j = 0; j < clip.length; j++) {
      const c = clip[j], d = clip[(j + 1) % clip.length];
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      if (Math.abs(den) < E) { if (segDist(c, a, b) < 1e-6 || segDist(d, a, b) < 1e-6) throw new Error(`${what}: an edge runs along the outline at ${c}`); continue; }
      const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
      const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
      if (t < -E || t > 1 + E || u < -E || u > 1 + E) continue;
      if (t < E || t > 1 - E || u < E || u > 1 - E) throw new Error(`${what}: the outlines touch at ${c} / ${a}`);
      const p = [Math.round((a[0] + t * (b[0] - a[0])) * K) / K, Math.round((a[1] + t * (b[1] - a[1])) * K) / K];
      const s = { p, alpha: flip ? 1 - t : t, inter: true }, o = { p, alpha: u, inter: true };
      s.other = o; o.other = s; sAt[i].push(s); cAt[j].push(o);
    }
  }
  const list = (ring, at) => ring.flatMap((p, i) => [{ p, inter: false }, ...at[i].sort((x, y) => x.alpha - y.alpha)]);
  const S = list(subject, sAt), C = list(clip, cAt);
  if (S.length === subject.length) { // no crossing: one contains the other, or they are apart
    if (inside(subject[0], clip)) return { inside: [subject], outside: [] };
    if (inside(clip[0], subject)) return { inside: [clip], outside: [subject], hole: clip };
    return { inside: [], outside: [subject] };
  }
  for (const [nodes, other] of [[S, clip], [C, subject]]) {
    let within = inside(nodes[0].p, other);
    nodes.forEach((n, i) => { n.list = nodes; n.i = i; if (n.inter) { n.entry = !within; within = !within; } });
  }
  const trace = away => { // away: walk the subject outside the clip (the difference) instead of inside it
    for (const n of [...S, ...C]) n.seen = false;
    const rings = [];
    for (const start of S) {
      if (!start.inter || start.seen) continue;
      const ring = []; let n = start;
      do {
        n.seen = n.other.seen = true;
        const forward = n.list === S ? n.entry !== away : n.entry, step = forward ? 1 : -1, nodes = n.list;
        ring.push(n.p);
        for (let k = n.i; ;) {
          k = (k + step + nodes.length) % nodes.length;
          if (nodes[k].inter) { n = nodes[k].other; break; }
          ring.push(nodes[k].p);
        }
      } while (!n.seen);
      rings.push(ring);
    }
    return rings;
  };
  const result = { inside: trace(false), outside: trace(true) };
  const total = r => r.reduce((s, x) => s + Math.abs(ringArea(x)), 0), whole = Math.abs(ringArea(subject));
  if (Math.abs(total(result.inside) + total(result.outside) - whole) > .05 + whole * 1e-4) throw new Error(`${what}: clipping lost area`);
  return result;
}
/** Pieces smaller than this (map units²) are slivers: they stay with, or go to, the shape around them. */
const SLIVER = 4;
// Hand-drawn borders: the chain of vertices two members share between the two ends is replaced in both.
const sourceRings = new Map(SOURCE.provinces.map(p => [p.id, ringsOf(p.path)]));
for (const [a, b, line] of REDRAWN) {
  const ends = [key(line[0]), key(line[line.length - 1])], inner = line.slice(1, -1);
  const vertices = id => new Set(sourceRings.get(id).flat().map(key)), ofA = vertices(a), ofB = vertices(b);
  for (const [member, other] of [[a, ofB], [b, ofA]]) {
    const rings = sourceRings.get(member), ri = rings.findIndex(r => ends.every(e => r.some(v => key(v) === e)));
    if (ri < 0) throw new Error(`redrawn ${a}–${b}: ${member} has no ring with both ends`);
    const ring = rings[ri], n = ring.length, i = ring.findIndex(v => key(v) === ends[0]), j = ring.findIndex(v => key(v) === ends[1]);
    const walk = (s, e) => { const out = [ring[s]]; for (let k = s; k !== e;) { k = (k + 1) % n; out.push(ring[k]); } return out; };
    const onBorder = chain => chain.slice(1, -1).every(v => other.has(key(v)));
    // The shared chain runs i→j or j→i along the ring; keep the other way round and put the new line in its place.
    const next = onBorder(walk(i, j)) ? [...walk(j, i), ...inner] : onBorder(walk(j, i)) ? [...walk(i, j), ...[...inner].reverse()] : null;
    if (!next) throw new Error(`redrawn ${a}–${b}: the ends are not joined by a shared border in ${member}`);
    rings[ri] = next;
  }
}
// Shapes that enter the topology: every v5 member (less the wastelands) and every wasteland part.
const reassignOf = new Map(TERRAIN_SOURCE.reassign.map(r => [r.member, r]));
for (const r of TERRAIN_SOURCE.reassign) if (!sourceById.has(r.member) || !members.has(r.province)) throw new Error(`reassign ${r.member} → ${r.province}: unknown`);
const parts = [];
for (const p of SOURCE.provinces) {
  const own = groupOf.get(p.id), rings = sourceRings.get(p.id);
  // Enclaves (a ring inside another ring of the member) and holes are left alone; no wasteland may cross them.
  let land = rings.map((ring, i) => ({ ring, fixed: rings.some((o, j) => j !== i && Math.abs(ringArea(o)) > Math.abs(ringArea(ring)) && inside(ring[0], o)), by: null }));
  let carved = [];
  for (const w of WASTELANDS) for (const polygon of w.polygons) {
    const box = bbox(polygon), next = [];
    for (const piece of land) {
      if (!overlaps(bbox(piece.ring), box)) { next.push(piece); continue; }
      if (piece.fixed) {
        if (piece.ring.some(v => inside(v, polygon)) || polygon.some(v => inside(v, piece.ring))) throw new Error(`${w.id} reaches an enclave or hole of ${p.id}`);
        next.push(piece); continue;
      }
      const cut = clipRing(piece.ring, polygon, `${w.id} in ${p.id}`);
      for (const ring of cut.inside) carved.push({ ring, group: w.id, hole: Boolean(cut.hole) });
      for (const ring of cut.outside) next.push({ ring, by: cut.inside.length ? w.id : piece.by });
      if (cut.hole) next.push({ ring: cut.hole, fixed: true });
    }
    land = next;
  }
  // Slivers: a scrap of land cut off by a wasteland joins it; a scrap of wasteland (not a hole) stays land.
  const scrap = piece => !piece.fixed && !piece.hole && Math.abs(ringArea(piece.ring)) < SLIVER;
  const kept = land.filter(piece => !(piece.by && scrap(piece))).concat(carved.filter(scrap));
  carved = carved.filter(c => !scrap(c)).concat(land.filter(piece => piece.by && scrap(piece)).map(piece => ({ ring: piece.ring, group: piece.by })));
  const move = reassignOf.get(p.id), moved = [];
  for (const piece of move ? [...kept] : []) {
    if (piece.fixed) continue;
    if (!move.polygons.some(poly => piece.ring.every(v => inside(v, poly)))) {
      if (move.polygons.some(poly => piece.ring.some(v => inside(v, poly)))) throw new Error(`reassign ${p.id}: a piece crosses the outline`);
      continue;
    }
    kept.splice(kept.indexOf(piece), 1); moved.push(piece.ring);
  }
  parts.push({ group: own, rings: kept.map(k => k.ring) });
  if (moved.length) parts.push({ group: move.province, rings: moved });
  for (const c of carved) parts.push({ group: c.group, rings: [c.ring] });
}
for (const part of parts) for (const ring of part.rings) {
  const keys = ring.map(v => { const k = key(v); if (!point.has(k)) point.set(k, v.map(n => Math.round(n * K) / K)); return k; });
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i], b = keys[(i + 1) % keys.length];
    if (a === b) continue;
    const s = segKey(a, b);
    if (!segments.has(s)) segments.set(s, { a: a < b ? a : b, b: a < b ? b : a, count: new Map() });
    const count = segments.get(s).count, g = part.group;
    count.set(g, (count.get(g) || 0) + 1);
  }
}
// Boundary segments and their labels (the v6 provinces on each side).
const boundary = new Map();
for (const [s, seg] of segments) {
  const label = [...seg.count].filter(([, n]) => n % 2).map(([g]) => g).sort();
  if (label.length > 2) throw new Error(`segment ${s} borders ${label}`);
  if (label.length) boundary.set(s, { ...seg, label: label.join('|') });
}
const incident = new Map();
for (const [s, seg] of boundary) for (const n of [seg.a, seg.b]) { if (!incident.has(n)) incident.set(n, []); incident.get(n).push(s); }
const junction = n => { const list = incident.get(n); return list.length !== 2 || boundary.get(list[0]).label !== boundary.get(list[1]).label; };
// Arcs: maximal chains of same-label segments between junctions.
const arcs = [], arcOf = new Map();
const other = (s, n) => { const seg = boundary.get(s); return seg.a === n ? seg.b : seg.a; };
for (const s of [...boundary.keys()].sort()) {
  if (arcOf.has(s)) continue;
  const seg = boundary.get(s), id = arcs.length, chain = [seg.a, seg.b], used = [s];
  arcOf.set(s, id);
  // Extend forward from b and backward from a through non-junction nodes.
  for (const forward of [true, false]) {
    for (;;) {
      const end = forward ? chain[chain.length - 1] : chain[0];
      if (junction(end)) break;
      const next = incident.get(end).find(t => !arcOf.has(t));
      if (!next) break; // closed loop
      arcOf.set(next, id); used.push(next);
      const n = other(next, end);
      if (forward) chain.push(n); else chain.unshift(n);
    }
  }
  const closed = chain[0] === chain[chain.length - 1];
  arcs.push({ id, keys: chain, label: seg.label, closed, shared: seg.label.includes('|') });
}
// Canonical start for closed loops without a junction: the smallest key, so output is order-independent.
for (const arc of arcs) if (arc.closed && !junction(arc.keys[0])) {
  const ring = arc.keys.slice(0, -1), start = ring.indexOf([...ring].sort()[0]);
  arc.keys = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
}

// ---------------------------------------------------------------------------------------------------
// Generalisation.
function douglasPeucker(pts, tolerance) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let best = -1, at = -1;
    for (let k = i + 1; k < j; k++) { const d = segDist(pts[k], pts[i], pts[j]); if (d > best) { best = d; at = k; } }
    if (best > tolerance) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function chaikin(pts, iterations) {
  for (let n = 0; n < iterations; n++) {
    if (pts.length < 3) return pts;
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      if (i > 0) next.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
      if (i < pts.length - 2) next.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    next.push(pts[pts.length - 1]); pts = next;
  }
  return pts;
}
const round = v => [Math.round(v[0] * K) / K, Math.round(v[1] * K) / K];
function generalise(arc, tolerance) {
  const pts = arc.keys.map(k => point.get(k));
  if (!arc.shared || tolerance <= 0) return pts;
  if (arc.closed) { // split a loop in two halves so both halves keep their far point
    const half = Math.floor(pts.length / 2);
    const a = chaikin(douglasPeucker(pts.slice(0, half + 1), tolerance), SMOOTHING), b = chaikin(douglasPeucker(pts.slice(half), tolerance), SMOOTHING);
    return [...a, ...b.slice(1)].map(round);
  }
  return chaikin(douglasPeucker(pts, tolerance), SMOOTHING).map(round);
}
function crossings() {
  const CELL = 6, grid = new Map(), bad = new Set();
  const cross = (p, q, r, s) => {
    const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
  };
  for (const arc of arcs) for (let i = 0; i < arc.points.length - 1; i++) {
    const a = arc.points[i], b = arc.points[i + 1];
    const cells = new Set();
    for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) cells.add(`${x},${y}`);
    for (const c of cells) {
      for (const o of grid.get(c) || []) {
        if (o.arc === arc.id && Math.abs(o.i - i) < 2) continue;
        if (cross(a, b, o.a, o.b)) bad.add(arc.id < o.arc ? `${arc.id}|${o.arc}` : `${o.arc}|${arc.id}`);
      }
      if (!grid.has(c)) grid.set(c, []);
      grid.get(c).push({ arc: arc.id, i, a, b });
    }
  }
  // Near misses count too: a vertex may lie on another line (a junction) or clearly apart from it, never
  // a hair away, which would draw as a sliver.
  for (const arc of arcs) for (const p of arc.points) {
    for (const o of grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) || []) {
      if (o.arc === arc.id) continue;
      const d = segDist(p, o.a, o.b);
      if (d > 1e-6 && d < .12) bad.add(arc.id < o.arc ? `${arc.id}|${o.arc}` : `${o.arc}|${arc.id}`);
    }
  }
  return bad;
}
for (const arc of arcs) { arc.tolerance = arc.shared ? TOLERANCE : 0; arc.points = generalise(arc, arc.tolerance); }
// Planarity: a generalised border may not cross or nearly touch another line. Offending borders are retried
// with half the tolerance, down to the source line itself; the source's own coastline specks stay as they were.
for (let pass = 0; ; pass++) {
  const bad = [...new Set([...crossings()].flatMap(k => k.split('|').map(Number)))].map(id => arcs[id]).filter(a => a.tolerance > 0);
  if (!bad.length) break;
  if (pass > 12) throw new Error(`Cannot untangle arcs ${bad.map(a => a.label)}`);
  for (const arc of bad) { arc.tolerance = arc.tolerance > .1 ? arc.tolerance / 2 : 0; arc.points = generalise(arc, arc.tolerance); }
}
const kept = arcs.filter(a => a.shared && a.tolerance < TOLERANCE);
if (kept.length) console.log(`Borders kept closer to the source to stay clear of other lines: ${kept.map(a => `${a.label} (${a.tolerance})`).join(', ')}`);

// ---------------------------------------------------------------------------------------------------
// Rings of a group set: walk the boundary segments with exactly one side in the set, then substitute the generalised arcs.
function provinceRingKeys(ids) {
  const id = ids.join('+'), set = new Set(ids);
  const mine = [...boundary].filter(([, seg]) => seg.label.split('|').filter(g => set.has(g)).length === 1).map(([s]) => s).sort();
  const at = new Map();
  for (const s of mine) for (const n of [boundary.get(s).a, boundary.get(s).b]) { if (!at.has(n)) at.set(n, []); at.get(n).push(s); }
  const done = new Set(), rings = [];
  for (const start of mine) {
    if (done.has(start)) continue;
    const first = boundary.get(start), ring = [first.a]; let node = first.b, prev = first.a, s = start; done.add(s);
    while (node !== first.a) {
      ring.push(node);
      const options = at.get(node).filter(t => !done.has(t));
      if (!options.length) throw new Error(`open ring in ${id}`);
      // At a pinch point take the sharpest left turn, so touching rings separate cleanly.
      const [px, py] = point.get(prev), [nx, ny] = point.get(node), heading = Math.atan2(ny - py, nx - px);
      const turn = t => { const [x, y] = point.get(other(t, node)); let d = Math.atan2(y - ny, x - nx) - heading; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI; return d; };
      s = options.length === 1 ? options[0] : options.sort((a, b) => turn(a) - turn(b) || (a < b ? -1 : 1))[0];
      done.add(s); prev = node; node = other(s, node);
    }
    rings.push(ring);
  }
  return rings;
}
function substitute(ring) {
  const n = ring.length, starts = ring.map((k, i) => i).filter(i => junction(ring[i]));
  const piece = (i) => { // arc starting at ring[i] toward ring[i+1]
    const arc = arcs[arcOf.get(segKey(ring[i % n], ring[(i + 1) % n]))];
    const forward = arc.keys[0] === ring[i % n] && arc.keys[1] === ring[(i + 1) % n];
    return { arc, pts: forward ? arc.points : [...arc.points].reverse() };
  };
  if (!starts.length) { // the whole ring is one closed arc, possibly starting elsewhere
    const arc = arcs[arcOf.get(segKey(ring[0], ring[1]))], at = arc.keys.indexOf(ring[0]);
    const pts = arc.points.slice(0, -1);
    return arc.keys[at + 1] === ring[1] ? pts : pts.reverse();
  }
  const out = []; let i = starts[0]; const end = starts[0] + n;
  while (i < end) {
    const { arc, pts } = piece(i);
    out.push(...pts.slice(0, -1));
    i += arc.keys.length - 1;
  }
  if (i !== end) throw new Error('arc walk misaligned');
  return out;
}
const signedArea = r => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Pole of inaccessibility (polylabel): the interior point farthest from the polygon's edges. */
function polylabel(polygon, precision = .1) {
  const outer = polygon[0], xs = outer.map(p => p[0]), ys = outer.map(p => p[1]);
  const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const dist = (x, y) => {
    let d = Infinity; for (const r of polygon) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist([x, y], r[i], r[(i + 1) % r.length]));
    const isIn = inside([x, y], outer) && !polygon.slice(1).some(h => inside([x, y], h));
    return isIn ? d : -d;
  };
  const cell = (x, y, h) => { const d = dist(x, y); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
  const size = Math.min(maxX - minX, maxY - minY); let h = size / 2;
  const queue = [];
  if (size === 0) return [minX, minY, 0];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(cell(x + h, y + h, h));
  const c = polygon[0].reduce(([sx, sy, sa], a, i, r) => { const b = r[(i + 1) % r.length], f = a[0] * b[1] - b[0] * a[1]; return [sx + (a[0] + b[0]) * f, sy + (a[1] + b[1]) * f, sa + f * 3]; }, [0, 0, 0]);
  let best = cell(c[0] / c[2], c[1] / c[2], 0);
  const box = cell(minX + (maxX - minX) / 2, minY + (maxY - minY) / 2, 0); if (box.d > best.d) best = box;
  while (queue.length) {
    queue.sort((a, b) => a.max - b.max || a.x - b.x || a.y - b.y); const q = queue.pop();
    if (q.d > best.d) best = q;
    if (q.max - best.d <= precision) continue;
    h = q.h / 2; queue.push(cell(q.x - h, q.y - h, h), cell(q.x + h, q.y - h, h), cell(q.x - h, q.y + h, h), cell(q.x + h, q.y + h, h));
  }
  return [best.x, best.y, best.d];
}

const f2 = n => (Math.round(n * K) / K).toFixed(2);
/** Oriented rings, path and label point of a group of shapes (one province, one wasteland, or a province with its
 * holes filled back in). `anchor` picks the home landmass. */
function shape(ids, anchor) {
  const rings = provinceRingKeys(ids).map(substitute).filter(r => r.length >= 3);
  // Orientation: exteriors positive, holes (odd nesting depth) negative, so the default nonzero fill is right.
  const oriented = rings.map((r, i) => {
    const probe = r[0], depth = rings.filter((o, j) => j !== i && Math.abs(signedArea(o)) > Math.abs(signedArea(r)) && inside(probe, o)).length;
    const hole = depth % 2 === 1, area = signedArea(r);
    return (hole ? area > 0 : area < 0) ? [...r].reverse() : r;
  });
  // Home landmass: the exterior containing the anchor (so Scandinavia's counter stays in Sweden, not Greenland),
  // unless that is a minor island (under 60 units², e.g. Kyushu); then the largest landmass.
  const exteriors = oriented.filter(r => signedArea(r) > 0).sort((a, b) => signedArea(b) - signedArea(a));
  const anchored = anchor && exteriors.find(r => inside(anchor, r));
  const home = anchored && signedArea(anchored) >= 60 ? anchored : exteriors[0];
  const holes = oriented.filter(r => signedArea(r) < 0 && inside(r[0], home));
  const [x, y, clearance] = polylabel([home, ...holes]);
  const path = oriented.map(r => 'M' + r.map(v => `${f2(v[0])},${f2(v[1])}`).join('L') + 'Z').join('');
  return { x: +f2(x), y: +f2(y), clearance: +clearance.toFixed(1), path, rings: oriented, home };
}
const provinces = PROVINCES.map(([id, name, region, from]) => {
  const primary = sourceById.get(from[0]), own = shape([id], [primary.x, primary.y]);
  let { x, y, clearance } = own;
  if (ANCHORS[id]) {
    [x, y] = ANCHORS[id];
    const holes = own.rings.filter(r => signedArea(r) < 0), home = own.rings.find(r => signedArea(r) > 0 && inside([x, y], r));
    if (!home || holes.some(h => inside([x, y], h))) throw new Error(`${id}: its authored counter lies outside the province`);
    clearance = +Math.min(...own.rings.flatMap(r => r.map((a, i) => segDist([x, y], a, r[(i + 1) % r.length])))).toFixed(1);
  }
  return { id, name, region, x, y, clearance, path: own.path, neighbors: [] };
});
/** Direction of a shape's long axis in degrees (principal axis of its outline), for a label along it; 0 when the
 * shape is not clearly elongated. */
function axis(ring) {
  const n = ring.length, mx = ring.reduce((s, p) => s + p[0], 0) / n, my = ring.reduce((s, p) => s + p[1], 0) / n;
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of ring) { xx += (x - mx) ** 2; yy += (y - my) ** 2; xy += (x - mx) * (y - my); }
  const spread = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy), long = (xx + yy + spread) / 2, short = (xx + yy - spread) / 2;
  if (long < 2.5 * short) return 0;
  let angle = Math.atan2(2 * xy, xx - yy) / 2 * 180 / Math.PI;
  if (angle > 90) angle -= 180; if (angle <= -90) angle += 180;
  return Math.round(angle);
}
/** Room for a label: the length of the line through (x, y) at `angle` that stays inside the shape. */
function span(ring, x, y, angle) {
  const dx = Math.cos(angle * Math.PI / 180), dy = Math.sin(angle * Math.PI / 180);
  const reach = sign => { let t = 0; while (t < 200 && inside([x + sign * (t + .25) * dx, y + sign * (t + .25) * dy], ring)) t += .25; return t; };
  return +(reach(1) + reach(-1)).toFixed(1);
}
const terrain = WASTELANDS.map(({ id, name, terrain: kind }) => {
  if (!['mountains', 'desert', 'ice'].includes(kind)) throw new Error(`wasteland ${id}: unknown terrain ${kind}`);
  const s = shape([id], null), angle = axis(s.home);
  return { id, name, terrain: kind, x: s.x, y: s.y, angle, span: span(s.home, s.x, s.y, angle), path: s.path, rings: s.rings };
});
// Counters stay clear of every wasteland.
for (const p of provinces) for (const t of terrain) {
  const near = t.rings.some(r => inside([p.x, p.y], r) || r.some((a, i) => segDist([p.x, p.y], a, r[(i + 1) % r.length]) < 4));
  if (near) throw new Error(`${p.id}'s counter lies on or within 4 units of the ${t.name}`);
}

// Adjacency.
const byId = new Map(provinces.map(p => [p.id, p])), edges = new Map();
const pair = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const borderLength = new Map();
for (const arc of arcs) if (arc.shared && !arc.label.split('|').some(g => wastelandIds.has(g))) {
  let length = 0; for (let i = 0; i < arc.points.length - 1; i++) length += Math.hypot(arc.points[i + 1][0] - arc.points[i][0], arc.points[i + 1][1] - arc.points[i][1]);
  borderLength.set(arc.label, (borderLength.get(arc.label) || 0) + length);
}
const short = [...borderLength].filter(([, l]) => l < MIN_BORDER);
if (short.length) throw new Error(`Borders too short to read: ${short.map(([k, l]) => `${k} ${l.toFixed(2)}`)}`);
for (const [a, b] of SEPARATED) if (borderLength.has(pair(a, b))) throw new Error(`${a} and ${b} still share a border: extend the wasteland between them`);
for (const k of [...borderLength.keys()].sort()) { const [from, to] = k.split('|'); edges.set(k, { from, to, sea: false }); }
for (const [a, b, why] of SEA_LINKS) {
  if (!byId.has(a) || !byId.has(b)) throw new Error(`sea link ${a}–${b}: unknown province`);
  const k = pair(a, b);
  if (edges.has(k)) throw new Error(`sea link ${a}–${b} (${why}) already shares a land border`);
  const [from, to] = k.split('|'); edges.set(k, { from, to, sea: true, strait: why });
}
for (const e of edges.values()) { byId.get(e.from).neighbors.push(e.to); byId.get(e.to).neighbors.push(e.from); }
for (const p of provinces) p.neighbors.sort();
const reached = new Set([provinces[0].id]);
for (let grew = true; grew;) { grew = false; for (const e of edges.values()) if (reached.has(e.from) !== reached.has(e.to)) { reached.add(e.from); reached.add(e.to); grew = true; } }
if (reached.size !== provinces.length) throw new Error(`Unreachable: ${provinces.filter(p => !reached.has(p.id)).map(p => p.id)}`);

const countries = COUNTRIES.map(([id, name, color, homeland, holdings]) => {
  for (const p of Object.keys(holdings)) if (!byId.has(p)) throw new Error(`${id}: unknown ${p}`);
  const start = Object.keys(holdings);
  return { id, name, color, start, homeland, colonies: start.filter(p => !homeland.includes(p)),
    development: Object.fromEntries(start.map(p => [p, holdings[p][0]])), garrisons: Object.fromEntries(start.map(p => [p, holdings[p][1]])) };
});
const starts = countries.flatMap(c => c.start);
if (new Set(starts).size !== starts.length) throw new Error('A province starts with two owners.');
const regions = REGIONS.map(([id, name, x, y]) => ({ id, name, x, y, provinces: provinces.filter(p => p.region === id).map(p => p.id) }));
if (provinces.some(p => !regions.some(r => r.id === p.region))) throw new Error('Province without a region.');

const map = {
  name: 'Industry & Empire · 1910', width: 1280, height: 680,
  notice: '1910-inspired holdings and colonial footholds. Province borders, industry and military strength are authored game abstractions, not a historical census. Mountains, deserts and ice drawn as terrain are wasteland: no one can hold or cross them.',
  source: 'Natural Earth public-domain boundaries (via the v5 province geometry); Council of Iron authored provinces, generalised borders and connections.',
  regions, countries,
  provinces: provinces.map(({ id, name, region, x, y, path, neighbors }) => ({ id, name, region, x, y, path, neighbors })),
  edges: [...edges.values()], terrain: terrain.map(({ id, name, terrain, x, y, angle, span, path }) => ({ id, name, terrain, x, y, angle, span, path })),
  id: 'imperial-1910-v7', rulesVersion: 3,
};
const text = JSON.stringify(map) + '\n';
if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== text) { console.error('public/imperial-map.json is not the output of scripts/build-imperial-v6.js; run it and commit.'); process.exit(1); }
  console.log('public/imperial-map.json matches scripts/build-imperial-v6.js.');
} else {
  writeFileSync(OUT, text);
  const land = [...edges.values()].filter(e => !e.sea).length;
  console.log(`Built ${provinces.length} provinces, ${land} land borders, ${edges.size - land} sea links, ${text.length} bytes.`);
  const smallest = [...provinces].sort((a, b) => a.clearance - b.clearance).slice(0, 8);
  console.log('Tightest counters (clearance in map units):', smallest.map(p => `${p.id} ${p.clearance}`).join(', '));
  for (const c of countries) console.log(`${c.id}: ${c.start.length} provinces, industry ${Object.values(c.development).reduce((a, b) => a + b, 0)}, troops ${Object.values(c.garrisons).reduce((a, b) => a + b, 0)}`);
}
