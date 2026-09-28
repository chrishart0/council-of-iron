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
  const leg = travelTimes?.[army.to]?.[army.from];
  if (!Number.isSafeInteger(leg)) return null;
  // Remaining ticks to the end it is heading for = distance from the end it turns toward.
  const behind = Math.min(leg, Math.max(0, army.arrivesAt - tick));
  return tick + Math.max(1, leg - behind);
}
