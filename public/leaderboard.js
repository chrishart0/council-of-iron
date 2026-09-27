/** Leaderboard (v0.6): ONE pure ranking used by the browser, CLI and MCP. No DOM, clock or I/O.
 * Input is a public observation (`provinces`, `armies`, `players`, `sides`), which every
 * spectator already receives in full, so the ranking reveals nothing new.
 * Troops = garrisons + that country's armies anywhere on the map (marching, returning or engaged).
 * Rank: provinces held desc, then troops desc, then id asc. Ranks are dense 1..n over every entry.
 */
/** Public relations of one country, from `wars` ("a:b" country pairs) and coalition sides.
 * Same shape as the planned shared `relationsOf` helper (public/relations.js), so it can be swapped. */
export function relationsOf(view, country) {
  const side = view.players.find(p => p.id === country)?.side, enemies = new Set();
  for (const key of view.wars || []) { const [a, b] = key.split(':'); if (a === country) enemies.add(b); else if (b === country) enemies.add(a); }
  const others = view.players.filter(p => p.id !== country);
  const allies = others.filter(p => side && p.side === side && !enemies.has(p.id)).map(p => p.id).sort();
  return { allies, enemies: [...enemies].sort(), neutral: others.filter(p => !enemies.has(p.id) && !allies.includes(p.id)).map(p => p.id).sort() };
}
/** Alliance colours (fallback until the shared `allianceColors` in public/relations.js lands).
 * A coalition keeps one colour for its whole life, including after it dissolves: the colour is
 * chosen by the engine's `coalition-N` counter, not by the current list order. Independents: none. */
export const ALLIANCE_PALETTE = ['#4ea8de', '#f2b134', '#b07ce8', '#3fbf8f', '#ef7d57', '#e86fb0'];
export function allianceColor(side) {
  if (typeof side !== 'string' || side.startsWith('solo:')) return null;
  const n = Number(side.match(/(\d+)$/)?.[1]);
  const index = Number.isSafeInteger(n) ? n - 1 : [...side].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return ALLIANCE_PALETTE[((index % ALLIANCE_PALETTE.length) + ALLIANCE_PALETTE.length) % ALLIANCE_PALETTE.length];
}
export function allianceColors(view) {
  return Object.fromEntries(view.sides.filter(s => !s.id.startsWith('solo:')).map(s => [s.id, allianceColor(s.id)]));
}
/** Active wars grouped into fronts between sides (a coalition, or an independent country).
 * Each front lists its country pairs; derived only from the public observation. */
export function warsOf(view) {
  const sideOf = id => view.players.find(p => p.id === id)?.side ?? `solo:${id}`;
  // Coalitions carry their (player-chosen) name; an independent side has none: show its country.
  const label = side => side.startsWith('solo:') ? null : view.sides.find(s => s.id === side)?.name ?? null;
  const fronts = new Map();
  for (const key of [...(view.wars || [])].sort()) {
    const [a, b] = key.split(':'), [sa, sb] = [sideOf(a), sideOf(b)];
    const [left, right] = sa <= sb ? [[sa, a], [sb, b]] : [[sb, b], [sa, a]];
    const id = `${left[0]}|${right[0]}`;
    if (!fronts.has(id)) fronts.set(id, { id, sides: [{ side: left[0], name: label(left[0]), countries: [] }, { side: right[0], name: label(right[0]), countries: [] }], pairs: [] });
    const front = fronts.get(id);
    front.pairs.push([a, b]);
    for (const [slot, country] of [[0, left[1]], [1, right[1]]]) if (!front.sides[slot].countries.includes(country)) front.sides[slot].countries.push(country);
  }
  for (const front of fronts.values()) for (const s of front.sides) s.countries.sort();
  return [...fronts.values()];
}
export function leaderboard(view, { mode = 'players', you = null, limit = Infinity } = {}) {
  if (!['players', 'alliances'].includes(mode)) throw new Error('Leaderboard mode must be players or alliances.');
  const total = view.provinces.length;
  const land = new Map(), troops = new Map();
  for (const p of view.provinces) if (p.owner) {
    land.set(p.owner, (land.get(p.owner) || 0) + 1);
    troops.set(p.owner, (troops.get(p.owner) || 0) + p.troops);
  }
  for (const a of view.armies) troops.set(a.country, (troops.get(a.country) || 0) + a.amount);
  const country = p => ({ id: p.id, kind: 'country', countries: [p.id], provinces: land.get(p.id) || 0,
    troops: troops.get(p.id) || 0, eliminated: p.eliminatedAt !== null && p.eliminatedAt !== undefined });
  let entries;
  if (mode === 'players') entries = view.players.map(country);
  else entries = view.sides.map(side => {
    const members = view.players.filter(p => side.members.includes(p.id)).map(country);
    // Independent countries rank as themselves; a coalition sums its members.
    if (members.length === 1) return members[0];
    return { id: side.id, kind: 'alliance', name: side.name, countries: members.map(m => m.id),
      provinces: members.reduce((n, m) => n + m.provinces, 0), troops: members.reduce((n, m) => n + m.troops, 0),
      eliminated: members.every(m => m.eliminated) };
  });
  entries.sort((a, b) => b.provinces - a.provinces || b.troops - a.troops || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Public war/alliance relations: which countries each row is at war with, and its relation to you.
  const enemiesOf = new Map(view.players.map(p => [p.id, relationsOf(view, p.id).enemies]));
  const mine = you ? relationsOf(view, you) : null;
  const rows = entries.map((e, i) => {
    const atWarWith = [...new Set(e.countries.flatMap(c => enemiesOf.get(c) || []))].filter(c => !e.countries.includes(c)).sort();
    const relation = !mine ? undefined : e.countries.includes(you) ? 'you' : e.countries.some(c => mine.enemies.includes(c)) ? 'enemy' : e.countries.some(c => mine.allies.includes(c)) ? 'ally' : 'neutral';
    return { rank: i + 1, ...e, share: total ? e.provinces / total : 0, atWarWith, ...(relation ? { relation } : {}),
      ...(you && e.countries.includes(you) ? { you: true } : {}) };
  });
  const shown = rows.slice(0, limit), own = rows.find(r => r.you);
  if (own && !shown.includes(own)) shown.push(own);
  return { mode, provinces: total, rows: shown, count: rows.length,
    rule: 'Rank by provinces held, then total troops (garrisons + all own armies on the map), then ID. atWarWith and relation come from the public war list and coalition sides. Public data only.' };
}
