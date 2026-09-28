import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createGame, join, start, act, tick, observe } from '../src/engine.js';
import { makeServer } from '../src/server.js';
import { PRIORITY, COOLDOWN, STINGER_GAP, CuePolicy, headlineCue, eventCues, breakCues, threatIds, tensionActive } from '../public/sound-model.js';

const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../public/audio/manifest.json', import.meta.url)));
const h = (kind, extra = {}) => ({ headline: { kind, ...extra } });
const cue = (item, viewer) => headlineCue(item, viewer)?.cue;

test('every headline kind maps to one cue; loud stingers only when it affects the viewer', () => {
  const me = { you: 'france', side: 'france' }, spectator = {};
  // Other people's news is WORLD tier: silent (the World thread row only), never a stinger.
  assert.equal(cue(h('war', { from: ['germany'], to: ['russia'] }), me), undefined);
  assert.equal(cue(h('war', { from: ['germany'], to: ['france'] }), me), 'war');
  assert.equal(headlineCue(h('war', { from: ['germany'], to: ['france'] }), me).priority, PRIORITY.war + 2);
  assert.equal(cue(h('peace', { from: ['a'], to: ['b'] }), me), undefined);
  assert.equal(cue(h('peace', { from: ['a'], to: ['france'] }), me), 'peace');
  assert.equal(cue(h('alliance', { countries: ['a', 'b'], side: 's' }), me), undefined);
  assert.equal(cue(h('alliance', { countries: ['france', 'b'], side: 's' }), me), 'alliance');
  assert.equal(cue(h('departure', { country: 'a', side: 's' }), me), undefined);
  assert.equal(cue(h('departure', { country: 'a', side: 'france' }), me), 'dispatch');
  assert.equal(cue(h('dissolved', { side: 'france' }), me), 'dispatch');
  assert.equal(cue(h('eliminated', { country: 'russia' }), me), undefined);
  assert.equal(cue(h('eliminated', { country: 'russia' }), { ...me, allies: ['russia'] }), 'fallen');
  assert.equal(cue(h('eliminated', { country: 'france' }), me), 'defeat');
  assert.equal(cue(h('eliminated', { country: 'france' }), spectator), undefined);
  assert.equal(cue(h('major_battle', { province: 'p', owner: 'a', previousOwner: 'b' }), me), undefined);
  assert.equal(headlineCue(h('major_battle', { province: 'p', owner: 'a', previousOwner: 'france' }), me).mine, true);
  assert.equal(cue(h('industry_up', { province: 'p', level: 3 }), me), undefined);
  assert.equal(cue(h('industry_down', { province: 'p', level: 2, owner: 'france' }), me), 'industry_down');
  assert.equal(cue(h('dominance', { side: 'x' }), me), 'countdown');
  assert.equal(headlineCue(h('dominance', { side: 'france' }), me).mine, true);
  assert.equal(cue(h('dominance_broken', { side: 'x' }), me), 'countdown_stop');
  assert.equal(cue(h('finished', { draw: true }), me), 'draw');
  assert.equal(cue(h('finished', { winningSide: 'france' }), me), 'victory');
  assert.equal(cue(h('finished', { winningSide: 'x' }), me), 'defeat');
  assert.equal(cue(h('finished', { winningSide: 'x' }), spectator), 'victory');
  assert.equal(headlineCue(h('unknown')), null);
  assert.equal(headlineCue({}), null);
  // Every cue the model can choose exists in the rendered sprite, and has a cooldown.
  for (const name of Object.keys(PRIORITY)) {
    assert.ok(manifest.cues[name], name); assert.ok(COOLDOWN[name] >= 0, name);
  }
});

test('events follow the comms tiers: ACTION stinger, PERSONAL blip, WORLD silent; stopped holds by seq', () => {
  const viewer = { you: 'france', side: 'france' };
  const events = [
    { id: 1, type: 'message', channel: 'world', from: 'germany', text: 'hi' },
    { id: 2, type: 'message', channel: 'world', from: 'france', text: 'mine' },
    { id: 3, type: 'message', channel: 'dm', from: 'germany', to: 'france', text: 'private' },
    { id: 4, type: 'order_accepted' },
    { id: 5, type: 'war_declared', ...h('war', { from: ['germany'], to: ['russia'] }) },
    { id: 6, type: 'alliance_offer', from: 'germany', roster: ['germany', 'france'], name: 'Pact' },
    { id: 7, type: 'message', channel: 'dm', from: 'france', to: 'germany', text: 'my own' },
  ];
  assert.deepEqual(eventCues(events, viewer).map(r => [r.cue, r.mine]), [['chat', false], ['dispatch', true]], 'world chat and third-party news are silent');
  assert.deepEqual(eventCues(events, {}).map(r => r.cue), [], 'spectators hear only headlines that affect them (none here)');
  const breaks = [{ seq: 4, ...h('dominance_broken', { side: 'x' }) }, { seq: 9, ...h('dominance_broken', { side: 'france' }) }, { seq: 12 }];
  assert.deepEqual(breakCues(breaks, 4, viewer).map(r => [r.cue, r.mine]), [['countdown_stop', true]]);
});

test('policy: one stinger per batch, highest priority first, own events outrank', () => {
  const p = new CuePolicy();
  const batch = [{ cue: 'battle', priority: 2 }, { cue: 'war', priority: 3 }, { cue: 'battle', priority: 4, mine: true }, { cue: 'chat', priority: 1 }];
  assert.deepEqual(p.choose(batch, 100).map(r => [r.cue, r.priority]), [['battle', 4]]);
  // Within the stinger gap an equal or lower priority stinger is dropped; a higher one may pass.
  assert.deepEqual(p.choose([{ cue: 'war', priority: 3 }], 101), []);
  assert.deepEqual(p.choose([{ cue: 'defeat', priority: 5 }], 101.5).map(r => r.cue), ['defeat']);
  // UI cues play only when no stinger is chosen, and respect their own cooldown.
  assert.deepEqual(p.choose([{ cue: 'chat', priority: 1 }], 102).map(r => r.cue), ['chat']);
  assert.deepEqual(p.choose([{ cue: 'chat', priority: 1 }], 102 + COOLDOWN.chat - 0.1), []);
  assert.deepEqual(p.choose([{ cue: 'chat', priority: 1 }], 102 + COOLDOWN.chat), ['chat'].map(cue => ({ cue, priority: 1 })));
});

test('policy: per-cue cooldown, stinger gap and a 4-per-20 s budget stop cacophony', () => {
  const p = new CuePolicy(); let t = 0; const played = [];
  // A burst: 30 battles and wars arriving every 0.5 s.
  for (let i = 0; i < 30; i++, t += 0.5) played.push(...p.choose([{ cue: i % 2 ? 'war' : 'battle', priority: i % 2 ? 3 : 2 }], t).map(r => [t, r.cue]));
  assert.ok(played.length <= 4, JSON.stringify(played));
  // A higher-priority stinger may follow sooner; an equal or lower one waits out the gap.
  const rank = { battle: 2, war: 3 };
  for (let i = 1; i < played.length; i++) if (rank[played[i][1]] <= rank[played[i - 1][1]]) assert.ok(played[i][0] - played[i - 1][0] >= STINGER_GAP);
  const battles = played.filter(([, c]) => c === 'battle').map(([at]) => at);
  for (let i = 1; i < battles.length; i++) assert.ok(battles[i] - battles[i - 1] >= COOLDOWN.battle);
  // Own defeat always passes the budget.
  assert.deepEqual(p.choose([{ cue: 'defeat', priority: 5 }], t).map(r => r.cue), ['defeat']);
  // Reduced sound: no UI cues, no ordinary world news; decisive and own events remain.
  const q = new CuePolicy();
  assert.deepEqual(q.choose([{ cue: 'click', priority: 1 }], 0, { reduced: true }), []);
  assert.deepEqual(q.choose([{ cue: 'battle', priority: 2 }], 0, { reduced: true }), []);
  assert.deepEqual(q.choose([{ cue: 'battle', priority: 4, mine: true }], 0, { reduced: true }).map(r => r.cue), ['battle']);
});

test('threats and tension come from the same public observation as the threat strip', () => {
  const g = createGame({ id: 'sound-1', name: 'Sound', hostId: 'germany' }, map);
  for (const id of ['germany', 'france']) join(g, map, { profileId: id, name: id, country: id });
  start(g);
  const france = observe(g, 'france', 0);
  assert.equal(threatIds(france).size, 0); assert.equal(tensionActive(france), false);
  act(g, map, 'germany', { type: 'declare_war', country: 'france' }, 'w1');
  for (let i = 0; i < 3; i++) tick(g);
  const home = map.countries.find(c => c.id === 'germany').start;
  const target = map.countries.find(c => c.id === 'france').start;
  const route = home.flatMap(from => map.provinces.find(p => p.id === from).neighbors.map(to => [from, to])).find(([, to]) => target.includes(to));
  assert.ok(route, 'Germany borders France');
  const atWar = observe(g, 'france', 0);
  assert.equal(tensionActive(atWar), true, 'at war');
  assert.equal(tensionActive(observe(g, null, 0)), false, 'spectator without a countdown hears no war drums');
  {
    act(g, map, 'germany', { type: 'move', from: route[0], to: route[1], amount: 2 }, 'm1');
    for (let i = 0; i < 3; i++) tick(g);
    const seen = observe(g, 'france', 0);
    assert.ok(threatIds(seen).size >= 1);
    assert.equal(threatIds(seen).size, seen.armies.filter(a => a.country === 'germany' && target.includes(a.to)).length);
    assert.equal(threatIds(observe(g, null, 0)).size, 0, 'spectators have no threat strip');
  }
});

test('server: audio assets and sound modules are served with correct types under the CSP', async () => {
  const app = makeServer({ dbPath: ':memory:', automatic: false });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const html = await fetch(url + '/');
    const csp = html.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/); assert.match(csp, /connect-src 'self'/); // fetch + decodeAudioData
    assert.doesNotMatch(csp, /media-src/); // falls back to default-src 'self'
    for (const [path, type] of [['/sound.js', 'text/javascript'], ['/sound-model.js', 'text/javascript'], ['/comms.css', 'text/css'], ['/fonts/barlow-condensed-medium.woff2', 'font/woff2'], ['/audio/manifest.json', 'application/json']]) {
      const r = await fetch(url + path); assert.equal(r.status, 200, path); assert.match(r.headers.get('content-type'), new RegExp(type), path);
    }
    let total = 0;
    for (const stem of ['theme', 'tension', 'effects']) for (const [ext, type] of [['ogg', 'audio/ogg'], ['mp3', 'audio/mpeg']]) {
      const r = await fetch(`${url}/audio/${stem}.${ext}?v=${manifest.version}`);
      assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), type);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.match(r.headers.get('cache-control'), /max-age=86400/);
      const bytes = Buffer.from(await r.arrayBuffer()); total += bytes.length;
      assert.equal(bytes.length, statSync(new URL(`../public/audio/${stem}.${ext}`, import.meta.url)).size);
      if (ext === 'ogg') assert.equal(bytes.subarray(0, 4).toString(), 'OggS');
    }
    assert.ok(total < 1.6e6, `audio total ${total} bytes`);
    assert.equal((await fetch(url + '/audio/other.ogg')).status, 404);
    assert.equal((await fetch(url + '/audio/../src/store.js')).status, 404);
    assert.equal((await fetch(url + '/app.js')).headers.get('cache-control'), 'no-store');
  } finally { await app.close(); }
});
