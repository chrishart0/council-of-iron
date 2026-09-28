// Recorded positions for the v0.9 UI concept prototypes (public/concepts/). Test/prototype data only:
// every file is a PUBLIC observation, review or replay exactly as the HTTP API returns it to one seat or to
// spectators. No clock-control route; the rooms are stepped in this process like tests/ui-browser-server.js.
// Usage: node scripts/concept-fixture.js  → public/concepts/fixture/*.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeServer, MAP } from '../src/server.js';
import { createGame, join, start, act, tick } from '../src/engine.js';
import { replay } from './replay-handplay.js';
import { replayReader } from '../public/replay-model.js';

const out = new URL('../public/concepts/fixture/', import.meta.url); mkdirSync(out, { recursive: true });
const app = makeServer({ dbPath: ':memory:', automatic: false });
const profiles = Object.fromEntries(MAP.countries.map(c => [c.id, app.store.register(c.name)]));
function buildRoom(id, { pacific = true } = {}) {
const room = createGame({ id, name: 'The Rhine front', hostId: profiles.britain.id }, MAP);
for (const c of MAP.countries) join(room, MAP, { country: c.id, name: profiles[c.id].name, profileId: profiles[c.id].id, kind: c.id === 'britain' ? 'human' : 'agent' });
start(room);
const tried = (country, action) => { try { return act(room, MAP, country, action, `c-${++seq}-${room.tick}-${country}`); } catch (e) { console.error('skip', id, room.tick, country, action.type, e.message); return null; } };
const ally = (a, b, name) => { const q = tried(a, { type: 'propose', country: b, name }); if (q) tried(b, { type: 'accept', proposalId: q.proposalId }); };
const orders = {
  0: [['britain', { type: 'declare_war', country: 'usa' }], ['russia', { type: 'declare_war', country: 'ottoman' }], ['russia', { type: 'move', from: 'ukraine', to: 'east-anatolia', amount: 10 }], ['germany', { type: 'declare_war', country: 'france' }]],
  2: [() => ally('germany', 'ottoman', 'Central Compact'), ...(pacific ? [() => ally('usa', 'japan', 'Pacific Pact')] : []), () => ally('russia', 'qing', 'Eastern League')],
  6: [['france', { type: 'chat', channel: 'world', text: 'The Republic will hold the Rhine. Anyone who crosses it answers to Paris.' }]],
  12: [['germany', { type: 'chat', channel: 'world', text: 'Our quarrel is with France alone. Britain has nothing to fear from the Compact.' }]],
  25: [['germany', { type: 'move', from: 'rhineland', to: 'alpine-france', amount: 11 }]],
  30: [['usa', { type: 'chat', channel: 'world', text: 'London declared on us first. The Pacific Pact remembers.' }]],
  40: [['britain', { type: 'move', from: 'england', to: 'low-countries', amount: 8 }], ['france', { type: 'move', from: 'occitania', to: 'iberia', amount: 8 }], ['germany', { type: 'move', from: 'saxony', to: 'balkans', amount: 8 }]],
  48: [['britain', { type: 'chat', channel: 'dm', to: 'france', text: 'If Germany takes Alpine France, our coast is next. What do you need from us?' }]],
  52: [['france', { type: 'chat', channel: 'dm', to: 'britain', text: 'An alliance, today. Your navy and my army can hold the Low Countries together.' }]],
  56: [['britain', { type: 'move', from: 'scotland', to: 'ireland', amount: 6 }]],
  58: [['france', { type: 'propose', country: 'britain', name: 'Channel Entente' }]],
  59: [['russia', { type: 'chat', channel: 'world', text: 'The Straits will be open by winter.' }]],
};
while (room.tick < 60) {
  for (const o of orders[room.tick] || []) typeof o === 'function' ? o() : tried(...o);
  tick(room);
}
room.tried = tried; return room;
}
let seq = 0;
const room = buildRoom('concept-live');
// The comms walkthrough room: the same opening, but Japan stays independent (so it can court Britain).
const comms = buildRoom('concept-comms', { pacific: false });
app.games.set(comms.id, comms); app.store.save(comms);
app.games.set(room.id, room); app.store.save(room);
const finished = replay().game; finished.id = 'concept-review'; finished.name = 'The Atlantic campaign'; app.games.set(finished.id, finished); app.store.save(finished);

await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const get = async (path, token) => { const r = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); };
const write = (name, data) => { writeFileSync(new URL(name, out), JSON.stringify(data)); console.log(name, JSON.stringify(data).length); };
write('live.json', await get(`/api/games/${room.id}`, profiles.britain.token));
write('feed.json', await get(`/api/games/${room.id}/feed`));
write('map.json', await get(`/api/games/${room.id}/map`, profiles.britain.token));
// Comms walkthrough (docs/UI-CONCEPTS.md): Japan sends a DM, then an alliance offer, while world headlines arrive;
// Britain accepts and replies. Each step is Britain's real observation, as the API returns it.
const snap = async name => write(`comms-${name}.json`, await get(`/api/games/${comms.id}`, profiles.britain.token));
const stepTo = to => { while (comms.tick < to) tick(comms); };
await snap('0-before');
comms.tried('japan', { type: 'chat', channel: 'dm', to: 'britain', text: 'Tokyo has no quarrel with London. The Americans are the problem for both of us.' }); stepTo(61);
await snap('1-dm');
const offer = comms.tried('japan', { type: 'propose', country: 'britain', name: 'Island Accord' }); stepTo(62);
comms.tried('qing', { type: 'chat', channel: 'world', text: 'Qing and Russia stand together from the Urals to the sea.' });
comms.tried('usa', { type: 'declare_war', country: 'germany' }); stepTo(63);
comms.tried('ottoman', { type: 'chat', channel: 'world', text: 'The Straits are closed to every Eastern League ship.' });
comms.tried('qing', { type: 'declare_war', country: 'usa' }); stepTo(64);
comms.tried('france', { type: 'declare_war', country: 'usa' }); stepTo(65);
await snap('2-offer');
comms.tried('britain', { type: 'accept', proposalId: offer.proposalId }); stepTo(66);
await snap('3-accepted');
comms.tried('britain', { type: 'chat', channel: 'dm', to: 'japan', text: 'Agreed. Hold the Pacific and we will hold the Channel.' }); stepTo(67);
await snap('4-replied');
const review = await get(`/api/games/${finished.id}/review`); write('review.json', review);
// Replay: the public replay decoded at a fixed stride, so a static page can scrub it without the 1.7 MB patch file.
const raw = await get(`/api/games/${finished.id}/replay`), read = replayReader(raw), stride = 10, frames = [];
for (let t = 0; t <= raw.duration; t += stride) { const b = read(t); frames.push({ tick: t, provinces: b.provinces, armies: b.armies, battles: b.battles, players: b.players, sides: b.sides, wars: b.wars, dominance: b.dominance, economyThreshold: b.economyThreshold }); }
if (frames.at(-1).tick !== raw.duration) { const b = read(raw.duration); frames.push({ tick: raw.duration, provinces: b.provinces, armies: b.armies, battles: b.battles, players: b.players, sides: b.sides, wars: b.wars, dominance: b.dominance, economyThreshold: b.economyThreshold }); }
write('replay.json', { duration: raw.duration, stride, rules: raw.rules, scenario: raw.scenario, frames });
await app.close(); process.exit(0);
