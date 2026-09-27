/** Public diplomatic relations from an observation. Pure: no DOM, no I/O.
 * Shared by the atlas, browser panels and agent tools so they agree with the engine:
 * allies share a side; with formal war rules, enemies are pairs listed in `wars`;
 * in legacy rooms (no formal war) every non-ally is hostile, as in the engine's atWar.
 */
export const warKey = (a, b) => [a, b].sort().join(':');
const formalWar = observation => observation?.rules ? Boolean(observation.rules.warRequired) : Array.isArray(observation?.wars);
export function allied(observation, a, b) {
  const players = observation?.players || [];
  const pa = players.find(p => p.id === a), pb = players.find(p => p.id === b);
  return Boolean(pa && pb && pa.side === pb.side);
}
export function atWar(observation, a, b) {
  if (!a || !b || a === b || allied(observation, a, b)) return false;
  const players = observation?.players || [];
  if (!players.some(p => p.id === a) || !players.some(p => p.id === b)) return false;
  return !formalWar(observation) || (observation.wars || []).includes(warKey(a, b));
}
/** { allies, enemies, neutral } country IDs relative to `country` (sorted; never includes it). */
export function relationsOf(observation, country) {
  const result = { allies: [], enemies: [], neutral: [] };
  const players = observation?.players || [];
  if (!players.some(p => p.id === country)) return result;
  for (const other of [...players].map(p => p.id).sort()) {
    if (other === country) continue;
    if (allied(observation, country, other)) result.allies.push(other);
    else if (atWar(observation, country, other)) result.enemies.push(other);
    else result.neutral.push(other);
  }
  return result;
}
/** Active coalitions (sides with two or more members): [{ id, name, members }]. */
export function coalitions(observation) {
  const players = observation?.players || [], named = new Map((observation?.sides || []).map(s => [s.id, s.name]));
  const bySide = new Map();
  for (const p of players) bySide.set(p.side, [...(bySide.get(p.side) || []), p.id]);
  return [...bySide].filter(([, members]) => members.length > 1)
    .map(([id, members]) => ({ id, name: String(named.get(id) ?? id), members: members.sort() }));
}
/** Alliance colours: bright hues distinct from the muted country colours and war red. */
export const ALLIANCE_PALETTE = Object.freeze(['#ff5fd2', '#a8f04a', '#3fd9ff', '#ff9f3f', '#ffe45c', '#b48cff']);
const creation = id => { const n = /(\d+)$/.exec(id); return n ? Number(n[1]) : Infinity; };
const hash = id => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** { sideId: colour } for active coalitions. Deterministic from coalition IDs: each coalition
 * starts at a hashed palette slot, and older coalitions (lower ID number) claim slots first. */
export function allianceColors(observation) {
  const ids = coalitions(observation).map(c => c.id).sort((a, b) => creation(a) - creation(b) || a.localeCompare(b));
  const used = new Set(), result = {}, n = ALLIANCE_PALETTE.length;
  for (const id of ids) {
    const start = hash(id) % n;
    let slot = start;
    for (let k = 0; k < n; k++) if (!used.has((start + k) % n)) { slot = (start + k) % n; break; }
    used.add(slot); result[id] = ALLIANCE_PALETTE[slot];
  }
  return result;
}
