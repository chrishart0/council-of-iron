/** Pure shared geometry. No client may use these estimates to change server time. */
export function distanceKm(a, b) {
  const latitude = p => p.lat ?? 83 - (p.y - 10) / 4.6;
  const longitude = p => p.lon ?? (p.x - 10) / 3.5 - 180;
  const radians = degrees => degrees * Math.PI / 180;
  const lat1 = radians(latitude(a)), lat2 = radians(latitude(b));
  const dLat = lat2 - lat1, dLon = radians(longitude(b) - longitude(a));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function travelTicks(a, b, rules) {
  return rules.marchSetup + Math.ceil(distanceKm(a, b) / rules.kmPerTick);
}
/** Least-time route through owned intermediate provinces. Excludes the source. */
export function ownedPath(map, provinces, travelTimes, country, from, to, allowTarget = false) {
  if (from === to) return null;
  const owned = new Set(provinces.filter(p => p.owner === country).map(p => p.id));
  if (!owned.has(from) || (!owned.has(to) && !allowTarget)) return null;
  if (allowTarget) owned.add(to);
  const byId = new Map(map.provinces.map(p => [p.id, p]));
  const best = new Map([[from, { time: 0, path: [] }]]), settled = new Set();
  while (true) {
    const current = [...best.keys()].filter(id => !settled.has(id))
      .sort((a, b) => best.get(a).time - best.get(b).time || a.localeCompare(b))[0];
    if (!current) return null;
    if (current === to) return best.get(to).path;
    settled.add(current);
    for (const next of byId.get(current).neighbors.filter(id => owned.has(id)).sort()) {
      const time = best.get(current).time + travelTimes[current][next];
      if (!best.has(next) || time < best.get(next).time) best.set(next, { time, path: [...best.get(current).path, next] });
    }
  }
}
export function journeyPoint(army, positions, tick) {
  const a = army.startPoint || positions[army.from], b = positions[army.to];
  let dx = b.x - a.x;
  if (dx > 640) dx -= 1280;
  if (dx < -640) dx += 1280;
  const fraction = Math.min(1, Math.max(0, (tick - army.departedAt) / (army.arrivesAt - army.departedAt)));
  return { x: (a.x + dx * fraction + 1280) % 1280, y: a.y + (b.y - a.y) * fraction };
}
