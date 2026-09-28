import { relationsOf, formingAlliances } from './relations.js';
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
/** Truces between sides (public): [{ id, sides, pairs, until }] grouped like `warsOf`, each with the
 * latest end among its pairs. Only truces still holding at `view.tick`. */
export function truceFronts(view) {
  const now = (view.truces || []).filter(t => t.until > view.tick);
  const fronts = warsOf({ ...view, wars: now.map(t => t.countries.join(':')) });
  for (const front of fronts) front.until = Math.max(...now.filter(t => front.pairs.some(([a, b]) => t.countries.join(':') === [a, b].sort().join(':'))).map(t => t.until));
  return fronts;
}
/** Leaderboard (v0.6): ONE pure ranking used by the browser, CLI and MCP. No DOM, clock or I/O.
 * Input is a public observation (`provinces`, `armies`, `players`, `sides`), which every
 * spectator already receives in full, so the ranking reveals nothing new.
 * Troops = garrisons + that country's armies anywhere on the map (marching, returning or engaged).
 * Rank: provinces held desc, then troops desc, then id asc. Ranks are dense 1..n over every entry.
 * Modes: `teams` (default in the browser) nests each coalition's members under one total row, with each
 * member's share of the coalition's troops; `players` is flat; `alliances` sums coalitions without nesting.
 */
export function leaderboard(view, { mode = 'players', you = null, limit = Infinity } = {}) {
  if (!['players', 'alliances', 'teams'].includes(mode)) throw new Error('Leaderboard mode must be teams, players or alliances.');
  const total = view.provinces.length;
  const land = new Map(), troops = new Map();
  for (const p of view.provinces) if (p.owner) {
    land.set(p.owner, (land.get(p.owner) || 0) + 1);
    troops.set(p.owner, (troops.get(p.owner) || 0) + p.troops);
  }
  for (const a of view.armies) troops.set(a.country, (troops.get(a.country) || 0) + a.amount);
  const country = p => ({ id: p.id, kind: 'country', countries: [p.id], provinces: land.get(p.id) || 0,
    troops: troops.get(p.id) || 0, eliminated: p.eliminatedAt !== null && p.eliminatedAt !== undefined });
  const byStrength = (a, b) => b.provinces - a.provinces || b.troops - a.troops || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Public war/alliance relations: which countries each row is at war with, and its relation to you.
  const enemiesOf = new Map(view.players.map(p => [p.id, relationsOf(view, p.id).enemies]));
  const mine = you ? relationsOf(view, you) : null;
  const relate = e => {
    const atWarWith = [...new Set(e.countries.flatMap(c => enemiesOf.get(c) || []))].filter(c => !e.countries.includes(c)).sort();
    const relation = !mine ? undefined : e.countries.includes(you) ? 'you' : e.countries.some(c => mine.enemies.includes(c)) ? 'enemy' : e.countries.some(c => mine.allies.includes(c)) ? 'ally' : 'neutral';
    return { share: total ? e.provinces / total : 0, atWarWith, ...(relation ? { relation } : {}), ...(you && e.countries.includes(you) ? { you: true } : {}) };
  };
  const group = (id, name, members, extra = {}) => {
    const sum = members.reduce((n, m) => n + m.troops, 0);
    const nested = [...members].sort((a, b) => b.troops - a.troops || b.provinces - a.provinces || (a.id < b.id ? -1 : 1))
      // Each member's share of the coalition's troops (sums to 1; an empty coalition splits evenly).
      .map(m => ({ ...m, ...relate(m), shareOfAlliance: sum ? m.troops / sum : 1 / members.length }));
    return { id, kind: 'alliance', name, countries: (mode === 'teams' ? nested : members).map(m => m.id), provinces: members.reduce((n, m) => n + m.provinces, 0),
      troops: sum, eliminated: members.every(m => m.eliminated), ...extra, ...(mode === 'teams' ? { members: nested } : {}) };
  };
  let entries;
  if (mode === 'players') entries = view.players.map(country);
  else {
    // Coalitions still in their public activation delay are grouped as "forming" (teams view only).
    const forming = mode === 'teams' ? formingAlliances(view).filter(f => !f.coalition) : [], claimed = new Set();
    const pending = forming.flatMap(f => {
      const members = view.players.filter(p => f.members.includes(p.id) && p.side.startsWith('solo:') && !claimed.has(p.id));
      if (members.length < 2) return [];
      for (const p of members) claimed.add(p.id);
      return [group(f.id, f.name, members.map(country), { forming: true, activateAt: f.activateAt })];
    });
    entries = [...pending, ...view.sides.flatMap(side => {
      const members = view.players.filter(p => side.members.includes(p.id) && !claimed.has(p.id)).map(country);
      // Independent countries rank as themselves; a coalition sums its members.
      if (members.length === 0) return [];
      if (members.length === 1 && side.id.startsWith('solo:')) return [members[0]];
      return [group(side.id, side.name, members)];
    })];
  }
  entries.sort(byStrength);
  const rows = entries.map((e, i) => ({ rank: i + 1, ...e, ...relate(e) }));
  const shown = rows.slice(0, limit), own = rows.find(r => r.you);
  if (own && !shown.includes(own)) shown.push(own);
  return { mode, provinces: total, rows: shown, count: rows.length,
    rule: 'Rank by provinces held, then total troops (garrisons + all own armies on the map, including marching, returning and engaged), then ID. In teams mode an alliance row is the sum of its nested members; shareOfAlliance is each member\'s share of the alliance troops. atWarWith and relation come from relations.js (public wars and coalition sides). Public data only.' };
}
