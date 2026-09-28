// The published scenario map. There is one current map; rooms whose scenario is not this map are
// not loaded (see makeServer in server.js).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** The one published map (served at /map.json). */
export const MAP = JSON.parse(readFileSync(resolve(root, 'public/imperial-map.json'), 'utf8'));
