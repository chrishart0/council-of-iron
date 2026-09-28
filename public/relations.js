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
/** An army that can actually attack `you`: marching (not returning) on your land, from a country at war with you.
 * Under formal-war rules a neutral's army turns back on arrival, so it is not a threat. */
export function threatening(observation, army, you) {
  if (!army || army.returning || !you) return false;
  const target = (observation?.provinces || []).find(p => p.id === army.to);
  return target?.owner === you && atWar(observation, army.country, you);
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
// Colour distance for map legibility: CIE76 ΔE in Lab, the minimum over normal vision and
// simulated protan/deutan/tritan vision (Machado et al. 2009, severity 1).
const CVD = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]];
const rgb = hex => [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16) / 255);
function lab(hex, m) {
  const l = rgb(hex).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const r = m.map(row => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
  const f = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const X = f((r[0] * .4124 + r[1] * .3576 + r[2] * .1805) / .95047), Y = f(r[0] * .2126 + r[1] * .7152 + r[2] * .0722), Z = f((r[0] * .0193 + r[1] * .1192 + r[2] * .9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
export const colorDistance = (a, b) => Math.min(...CVD.map(m => { const p = lab(a, m), q = lab(b, m); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
/** Darken a #rrggbb colour by `k` (0–1). */
export const shade = (hex, k) => `#${rgb(hex).map(c => Math.round(c * (1 - k) * 255).toString(16).padStart(2, '0')).join('')}`;
export const NEUTRAL_TEAM = '#a5a28c';
/** Team colour for a country: its coalition's alliance colour, else the country's own fill. */
export function teamColor(observation, country, countryColor) {
  if (!country) return NEUTRAL_TEAM;
  const side = (observation?.players || []).find(p => p.id === country)?.side;
  return (side && allianceColors(observation)[side]) || countryColor || NEUTRAL_TEAM;
}
/** Two battle colours that stay distinguishable: if too close, the attacker is darkened. */
export function battleColors(attacker, defender, minimum = 20) {
  if (colorDistance(attacker, defender) >= minimum) return { attacker, defender, adjusted: false };
  for (const k of [.35, .5, .65]) { const dark = shade(attacker, k); if (colorDistance(dark, defender) >= minimum) return { attacker: dark, defender, adjusted: true }; }
  return { attacker: shade(attacker, .65), defender, adjusted: true };
}
