/** Leaderboard (v0.6): ONE pure ranking used by the browser, CLI and MCP. No DOM, clock or I/O.
 * Input is a public observation (`provinces`, `armies`, `players`, `sides`), which every
 * spectator already receives in full, so the ranking reveals nothing new.
 * Troops = garrisons + that country's armies anywhere on the map (marching, returning or engaged).
 * Rank: provinces held desc, then troops desc, then id asc. Ranks are dense 1..n over every entry.
 */
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
  const rows = entries.map((e, i) => ({ rank: i + 1, ...e, share: total ? e.provinces / total : 0,
    ...(you && e.countries.includes(you) ? { you: true } : {}) }));
  const shown = rows.slice(0, limit), own = rows.find(r => r.you);
  if (own && !shown.includes(own)) shown.push(own);
  return { mode, provinces: total, rows: shown, count: rows.length,
    rule: 'Rank by provinces held, then total troops (garrisons + all own armies on the map), then ID. Public data only.' };
}
