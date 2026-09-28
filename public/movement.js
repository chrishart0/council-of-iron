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
/** Ticks for one map connection: `moveSpeedPercent` speeds every link; `internalSpeedPercent`
 * additionally speeds an internal link (both ends friendly to the mover when the leg departs).
 * Integer arithmetic only. */
export function travelTicks(a, b, rules, internal = false) {
  const base = rules.marchSetup + Math.ceil(distanceKm(a, b) / rules.kmPerTick);
  const percent = rules.moveSpeedPercent * (internal ? rules.internalSpeedPercent : 100);
  return Math.max(1, Math.ceil(base * 10000 / percent));
}
/** Quickest route from `from` to `to` for `country` whose intermediate provinces are its own or an
 * ally's and are not a battlefield (the target may be anything). A leg between two friendly provinces
 * uses the internal (faster) table. Shared by the engine and every client, so a drawn route is the route
 * the server takes. `state` needs travelTimes, internalTravelTimes, provinces, players and battles.
 * Returns `{ path, travel }` (path excludes `from`) or null. */
export function friendlyPath(state, country, from, to) {
  if (from === to || !state.travelTimes[from]) return null;
  const side = new Map(state.players.map(p => [p.id, p.side])), owner = new Map(state.provinces.map(p => [p.id, p.owner]));
  const friendly = id => owner.get(id) && side.get(owner.get(id)) === side.get(country);
  const battles = new Set((state.battles || []).map(b => b.province));
  const leg = (a, b) => friendly(a) && friendly(b) ? state.internalTravelTimes[a][b] : state.travelTimes[a][b];
  const distance = new Map([[from, 0]]), previous = new Map(), done = new Set();
  while (true) {
    let nearest = null;
    for (const [id, d] of distance) if (!done.has(id) && (nearest === null || d < distance.get(nearest) ||
      d === distance.get(nearest) && id < nearest)) nearest = id;
    if (nearest === null) return null;
    if (nearest === to) break;
    done.add(nearest);
    if (nearest !== from && (!friendly(nearest) || battles.has(nearest))) continue;
    for (const id of Object.keys(state.travelTimes[nearest]).sort()) {
      if (done.has(id)) continue;
      const d = distance.get(nearest) + leg(nearest, id);
      if (d < (distance.get(id) ?? Infinity)) { distance.set(id, d); previous.set(id, nearest); }
    }
  }
  const path = [];
  for (let id = to; id !== from; id = previous.get(id)) path.unshift(id);
  return { path, travel: distance.get(to) };
}
export function journeyPoint(army, positions, tick) {
  const a = army.startPoint || positions[army.from], b = positions[army.to];
  let dx = b.x - a.x;
  if (dx > 640) dx -= 1280;
  if (dx < -640) dx += 1280;
  const fraction = Math.min(1, Math.max(0, (tick - army.departedAt) / (army.arrivesAt - army.departedAt)));
  return { x: (a.x + dx * fraction + 1280) % 1280, y: a.y + (b.y - a.y) * fraction };
}
