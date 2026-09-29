/** Static Risk-lens statistics for a map: exposure, neighbours, expansion race, depth, reach.
 *   node scripts/map-stats.js [public/imperial-map.json] [--json]
 * Distances use the engine's own travel table (createGame), foreign-link speed, from the opening position.
 * Numbers describe geometry and starts only; they say nothing about how humans play (docs/MAP-V6.md).
 */
import { readFileSync } from 'node:fs';
import { createGame } from '../src/engine.js';
import { provinceRings } from '../public/map-geometry.js';

const file = process.argv.slice(2).find(a => !a.startsWith('--')) || 'public/imperial-map.json';
const map = JSON.parse(readFileSync(file, 'utf8'));
const g = createGame({ id: 'stats', name: 'Stats', hostId: 'stats' }, map);
const owner = new Map(), dev = new Map(), troops = new Map();
for (const c of map.countries) for (const id of c.start) { owner.set(id, c.id); dev.set(id, c.development?.[id] ?? 1); troops.set(id, c.garrisons?.[id] ?? 10); }
const byId = new Map(map.provinces.map(p => [p.id, p]));
const sea = new Set(map.edges.filter(e => e.sea).flatMap(e => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
/** Travel ticks from a set of provinces to every province (multi-source Dijkstra on the foreign-speed table). */
function reach(sources) {
  const d = new Map(sources.map(id => [id, 0])), done = new Set();
  for (;;) {
    let best = null;
    for (const [id, v] of d) if (!done.has(id) && (best === null || v < d.get(best))) best = id;
    if (best === null) return d;
    done.add(best);
    for (const n of byId.get(best).neighbors) { const v = d.get(best) + g.travelTimes[best][n]; if (v < (d.get(n) ?? Infinity)) d.set(n, v); }
  }
}
const area = ring => Math.abs(ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
const neutral = map.provinces.filter(p => !owner.has(p.id)).map(p => p.id);
const reachOf = new Map(map.countries.map(c => [c.id, reach(c.start)]));
// Expansion race: each neutral province goes to the power that reaches it first (ties split).
const race = new Map(map.countries.map(c => [c.id, 0]));
for (const id of neutral) {
  const times = map.countries.map(c => [c.id, reachOf.get(c.id).get(id)]), best = Math.min(...times.map(t => t[1]));
  const winners = times.filter(t => t[1] === best); for (const [c] of winners) race.set(c, race.get(c) + 1 / winners.length);
}
const rows = map.countries.map(c => {
  const own = new Set(c.start), frontier = new Set(), rivals = new Set(), seaLinks = new Set();
  for (const id of c.start) for (const n of byId.get(id).neighbors) {
    if (sea.has(`${id}|${n}`)) seaLinks.add([id, n].sort().join('|'));
    if (!own.has(n)) { frontier.add(n); if (owner.has(n)) rivals.add(owner.get(n)); }
  }
  const exposed = c.start.filter(id => byId.get(id).neighbors.some(n => !own.has(n)));
  const capital = c.homeland?.[0] ?? c.start[0], fromCapital = reach([capital]);
  const nearestRival = Math.min(...[...owner].filter(([, o]) => o !== c.id).map(([id]) => fromCapital.get(id)));
  const d = reachOf.get(c.id), within = t => neutral.filter(id => d.get(id) <= t);
  return {
    country: c.id, provinces: c.start.length, industry: c.start.reduce((n, id) => n + dev.get(id), 0),
    troops: c.start.reduce((n, id) => n + troops.get(id), 0), exposedProvinces: exposed.length, interior: c.start.length - exposed.length,
    attackable: frontier.size, attackableNeutral: [...frontier].filter(id => !owner.has(id)).length, attackableRival: [...frontier].filter(id => owner.has(id)).length,
    rivalPowersAdjacent: rivals.size, seaLinks: seaLinks.size, capital, capitalToNearestRival: nearestRival,
    neutralWithin120: within(120).length, neutralWithin180: within(180).length, expansionRaceShare: +race.get(c.id).toFixed(2),
  };
});
const areas = map.provinces.map(p => { const rings = provinceRings(p.path); return [p.id, Math.max(...rings.map(area)), rings.length]; }).sort((a, b) => a[1] - b[1]);
const summary = {
  id: map.id, provinces: map.provinces.length, neutral: neutral.length, landLinks: map.edges.filter(e => !e.sea).length, seaLinks: map.edges.filter(e => e.sea).length,
  meanNeighbours: +(2 * map.edges.length / map.provinces.length).toFixed(2),
  smallestMainLandmass: areas.slice(0, 6).map(([id, a]) => `${id} ${a.toFixed(0)}`), ringsTotal: areas.reduce((n, a) => n + a[2], 0),
  regions: (map.regions || []).map(r => `${r.name} ${r.provinces.length}`),
};
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, rows }, null, 2));
else {
  console.log(summary);
  const keys = Object.keys(rows[0]);
  console.log(keys.join('\t'));
  for (const r of rows) console.log(keys.map(k => r[k]).join('\t'));
}
