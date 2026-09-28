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
/** Ticks for one map connection. Optional rules (absent in classic rooms, which keep the exact
 * old table): `moveSpeedPercent` speeds every link; `internalSpeedPercent` additionally speeds an
 * internal link (both ends friendly to the mover when the leg departs). Integer arithmetic only. */
export function travelTicks(a, b, rules, internal = false) {
  const base = rules.marchSetup + Math.ceil(distanceKm(a, b) / rules.kmPerTick);
  const percent = (rules.moveSpeedPercent ?? 100) * (internal ? rules.internalSpeedPercent ?? 100 : 100);
  return percent === 10000 ? base : Math.max(1, Math.ceil(base * 10000 / percent));
}
/** One leg's ticks as the engine charges it: the internal table when both ends are friendly. */
export function legTicks(state, from, to, internal) {
  return (internal && state.internalTravelTimes?.[from]?.[to]) || state.travelTimes?.[from]?.[to];
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
/** Ticks an army on the straight leg between its origin and its destination still needs to
 * reach the far end. Returning armies measure back to their origin; advancing ones forward.
 * Shared by the engine (turn-around/recall timing) and clients (the one-line preview). */
export function turnAroundArrival(army, travelTimes, tick) {
  // A non-transit army always travels one map connection: `from` and `to` swap on each turn.
  // `leg` is stored only when the leg was charged at a non-default (internal) speed.
  const leg = army.leg ?? travelTimes?.[army.to]?.[army.from];
  if (!Number.isSafeInteger(leg)) return null;
  // Remaining ticks to the end it is heading for = distance from the end it turns toward.
  const behind = Math.min(leg, Math.max(0, army.arrivesAt - tick));
  return tick + Math.max(1, leg - behind);
}
