/** Pure map geometry shared by the atlas and tests. Presentation only: no rule reads it.
 * Province borders are classified once per map into shared (province↔province) runs and
 * coastline runs, so the atlas can style province, country and coast lines separately.
 */
export function provinceRings(path) {
  return (String(path).match(/M[^MZ]+Z/g) || []).map(ring => ring.slice(1, -1).split('L').map(xy => xy.split(',').map(Number)));
}
export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function insideRings(p, rings) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const CELL = 4;
/** Index every boundary segment on a coarse grid; query returns segments near a point. */
export function segmentIndex(provinces) {
  const grid = new Map();
  for (const p of provinces) for (const ring of p.rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let x = Math.floor(Math.min(a[0], b[0]) / CELL) - 1; x <= Math.floor(Math.max(a[0], b[0]) / CELL) + 1; x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / CELL) - 1; y <= Math.floor(Math.max(a[1], b[1]) / CELL) + 1; y++) {
        const key = `${x},${y}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push({ id: p.id, a, b });
      }
  }
  return point => grid.get(`${Math.floor(point[0] / CELL)},${Math.floor(point[1] / CELL)}`) || [];
}
/** Split each ring into ≤1-unit pieces; each piece is shared with the province whose
 * boundary lies within `tolerance` of its ends and middle, otherwise it is coastline. */
export function borderNetwork(map, tolerance = .05) {
  const provinces = map.provinces.map(p => ({ id: p.id, rings: provinceRings(p.path) }));
  const near = segmentIndex(provinces), pairs = new Map(), coast = new Map(), shared = new Map();
  const partner = (id, points) => {
    let found = null;
    for (const s of near(points[1])) {
      if (s.id === id || (found && s.id !== found)) continue;
      if (segmentDistance(points[1], s.a, s.b) <= tolerance) found = s.id;
    }
    if (!found) return null;
    const onFound = point => near(point).some(s => s.id === found && segmentDistance(point, s.a, s.b) <= tolerance);
    return onFound(points[0]) && onFound(points[2]) ? found : null;
  };
  for (const p of provinces) for (const ring of p.rings) {
    let run = null;
    const flush = () => {
      if (!run || run.points.length < 2) return;
      const d = 'M' + run.points.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join('L');
      if (run.with === null) coast.set(p.id, [...(coast.get(p.id) || []), d]);
      else {
        const key = [p.id, run.with].sort().join('|');
        shared.set(key, (shared.get(key) || 0) + run.length / 2);
        // Draw each shared run once, from the alphabetically first side.
        if (p.id < run.with) pairs.set(key, [...(pairs.get(key) || []), d]);
      }
    };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(length));
      for (let k = 0; k < n; k++) {
        const from = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], to = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n];
        const other = partner(p.id, [from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to]);
        if (!run || run.with !== other) { flush(); run = { with: other, points: [from], length: 0 }; }
        run.points.push(to); run.length += length / n;
      }
    }
    flush();
  }
  const borders = [...pairs].map(([key, parts]) => { const [a, b] = key.split('|'); return { a, b, d: parts.join('') }; });
  return { borders, coast, shared };
}
