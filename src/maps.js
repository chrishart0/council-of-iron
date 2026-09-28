// Published scenario maps. A room is created with the CURRENT map and keeps resolving against
// the map it was created with (g.scenario): rules, adjacency, reviews and the client map.
// Older maps stay frozen so existing rooms, saved snapshots and replays load exactly.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const load = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
/** The map new rooms use (served at /map.json). */
export const CURRENT = load('public/imperial-map.json');
/** Every map a stored room may reference, by scenario ID. */
export const MAPS = new Map([CURRENT, load('public/maps/imperial-1910-v3.json')].map(m => [m.id, m]));
/** Standings group results from these scenario versions (same rules; v4 only adds a neutral province). */
export const STANDING_SCENARIOS = Object.freeze(['imperial-1910-v3', 'imperial-1910-v4']);
/** The map a room was created with; null for an unknown scenario. */
export const mapFor = g => MAPS.get(g?.scenario) || null;
