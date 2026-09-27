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
/** Forming alliances: approved proposals inside the public activation delay.
 * [{ id (proposal ID), name, members (future roster), activateAt, coalition (existing side joined, or null) }] */
export function formingAlliances(observation) {
  const players = new Set((observation?.players || []).map(p => p.id));
  return (observation?.proposals || []).filter(q => q?.status === 'pending' && Array.isArray(q.roster))
    .map(q => {
      const joined = q.coalition ? (observation.players || []).filter(p => p.side === q.coalition).map(p => p.id) : [];
      return { id: q.id, name: String(q.name ?? ''), activateAt: q.activateAt ?? null, coalition: q.coalition || null,
        members: [...new Set([...joined, ...q.roster])].filter(id => players.has(id)).sort() };
    })
    .sort((a, b) => (a.activateAt ?? Infinity) - (b.activateAt ?? Infinity) || a.id.localeCompare(b.id));
}
/** Alliance colours. Four hues chosen for separation under normal, protan, deutan and tritan
 * vision (simulated CIE76 ΔE ≥ 38 between any two) and away from war crimson, the diplomacy
 * gold, the ocean and all eight country fills. An 8-seat room has at most four coalitions. */
export const ALLIANCE_PALETTE = Object.freeze(['#c8ff00', '#00ffd0', '#ff8cff', '#3d5cff']);
const creation = id => { const n = /(\d+)$/.exec(id); return n ? Number(n[1]) : Infinity; };
const hash = text => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** { sideId | proposalId: colour } for active coalitions and forming alliances. Each prefers a
 * palette slot hashed from its (capped) name; active coalitions claim slots first in creation
 * order, then forming ones by activation time, so a forming alliance usually keeps its colour
 * when it activates. A proposal that joins an existing coalition uses that coalition's colour. */
export function allianceColors(observation) {
  const used = new Set(), result = {}, n = ALLIANCE_PALETTE.length;
  const claim = (id, name) => {
    const start = hash(String(name).slice(0, 40)) % n;
    let slot = start;
    for (let k = 0; k < n; k++) if (!used.has((start + k) % n)) { slot = (start + k) % n; break; }
    used.add(slot); result[id] = ALLIANCE_PALETTE[slot];
  };
  for (const c of coalitions(observation).sort((a, b) => creation(a.id) - creation(b.id) || a.id.localeCompare(b.id))) claim(c.id, c.name);
  for (const f of formingAlliances(observation)) {
    if (f.coalition && result[f.coalition]) result[f.id] = result[f.coalition]; else claim(f.id, f.name);
  }
  return result;
}
