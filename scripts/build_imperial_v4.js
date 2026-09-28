// Development-only: derive the published imperial-1910-v4 map from the frozen v3 map.
// v4 = v3 + one neutral, development-1 Hawaii province with three sea links (user-requested
// published-map change). v3 stays byte-identical in public/maps/ for existing rooms.
// Usage: node scripts/build_imperial_v4.js [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { travelTicks } from '../public/movement.js';
import { RULES } from '../src/engine.js';

const root = new URL('../', import.meta.url);
const v3 = JSON.parse(readFileSync(new URL('public/maps/imperial-1910-v3.json', root)));
import { provinceRings } from '../public/map-geometry.js';
// In v3 the real Hawaiian islands were three small rings inside west-us (Pacific States), a
// by-product of the nearest-seed partition. v4 moves exactly those rings into Hawaii, each
// enlarged 1.5× about its own centroid so the chain stays visible and tappable.
const westUs = v3.provinces.find(p => p.id === 'west-us');
const inHawaii = ring => ring.every(([x, y]) => x < 110 && y > 280 && y < 315);
const rings = provinceRings(westUs.path), islands = rings.filter(inHawaii);
if (islands.length !== 3) throw new Error(`expected 3 Hawaiian rings in west-us, found ${islands.length}`);
const path = rs => rs.map(r => 'M' + r.map(([x, y]) => `${x},${y}`).join('L') + 'Z').join('');
const enlarge = ring => {
  const pts = ring.slice(0, -1), cx = pts.reduce((n, p) => n + p[0], 0) / pts.length, cy = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  return ring.map(([x, y]) => [+(cx + (x - cx) * 1.5).toFixed(2), +(cy + (y - cy) * 1.5).toFixed(2)]);
};
const bigIsland = islands.reduce((a, b) => (Math.max(...a.map(p => p[0])) > Math.max(...b.map(p => p[0])) ? a : b)); // easternmost
const anchor = bigIsland.slice(0, -1).reduce((n, p) => [n[0] + p[0], n[1] + p[1]], [0, 0]).map(v => v / (bigIsland.length - 1));
const [x, y] = anchor;
const LINKS = ['west-us', 'south-japan', 'philippines'];
const hawaii = { id: 'hawaii', name: 'Hawaii', x: +x.toFixed(2), y: +y.toFixed(2), path: path(islands.map(enlarge)), neighbors: [...LINKS].sort() };

const v4 = structuredClone(v3);
v4.id = 'imperial-1910-v4';
v4.notice = `${v3.notice} v4 adds a neutral Hawaii stepping stone in the Pacific.`;
for (const p of v4.provinces) if (LINKS.includes(p.id)) p.neighbors = [...p.neighbors, 'hawaii'].sort();
v4.provinces.find(p => p.id === 'west-us').path = path(rings.filter(r => !inHawaii(r)));
v4.provinces.push(hawaii);
for (const to of LINKS) v4.edges.push({ from: 'hawaii', to, sea: true });

const byId = new Map(v4.provinces.map(p => [p.id, p]));
const ticks = (a, b) => travelTicks(byId.get(a), byId.get(b), RULES);
for (const [a, b] of [['west-us', 'hawaii'], ['hawaii', 'south-japan'], ['hawaii', 'philippines'], ['west-us', 'south-japan'], ['west-us', 'philippines'], ['alaska', 'far-east']])
  console.log(`${a} → ${b}: ${ticks(a, b)} ticks`);
const out = JSON.stringify(v4, null, 0) + '\n', target = new URL('public/imperial-map.json', root);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== out) { console.error('public/imperial-map.json is not the v4 build output'); process.exit(1); }
  console.log('v4 map matches the builder.');
} else { writeFileSync(target, out); console.log(`Wrote ${v4.id}: ${v4.provinces.length} provinces, ${v4.edges.length} links.`); }
