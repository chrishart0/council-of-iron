import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, act, tick, observe, worldFeed, classifyHeadline, majorBattleThreshold, battleCasualties, HEADLINES } from '../src/engine.js';
import { feedItems, feedPage, headlineCopy } from '../public/feed-model.js';
import { presentHeadline } from '../public/feed.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let next = 0;
function game(ids = ['usa', 'britain', 'france']) {
  const g = createGame({ id: `feed-${++next}`, name: 'Feed rules', hostId: ids[0] }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id });
  start(g); return g;
}
const send = (g, id, action) => act(g, map, id, action, `feed-test-${++next}`);
const advance = (g, n) => { for (let i = 0; i < n; i++) tick(g); };
const province = (g, id) => g.provinces.find(p => p.id === id);
const battle = (casualties, extra = {}) => ({ id: 9, tick: 5, type: 'battle', province: 'mexico', previousOwner: 'britain', owner: 'britain',
  before: 10, troops: 4, arrivals: [{ country: 'usa', amount: 10 }], casualties, ...extra });

test('major battle rule: max(20, ceil(3% of all troops on the map)); minor battles are not headlines', () => {
  assert.deepEqual(HEADLINES, { battleFloor: 20, battleShare: .03 });
  assert.equal(majorBattleThreshold(100), 20); assert.equal(majorBattleThreshold(1000), 30); assert.equal(majorBattleThreshold(1001), 31);
  assert.equal(classifyHeadline(battle(19), { worldTroops: 100 }), null);
  assert.equal(classifyHeadline(battle(20), { worldTroops: 100 }).kind, 'major_battle');
  assert.equal(classifyHeadline(battle(29), { worldTroops: 1000 }), null);
  const major = classifyHeadline(battle(30, { owner: 'usa' }), { worldTroops: 1000 });
  assert.deepEqual(major, { kind: 'major_battle', province: 'mexico', casualties: 30, worldTroops: 1000, threshold: 30,
    captured: true, owner: 'usa', previousOwner: 'britain' });
  assert.equal(classifyHeadline(battle(500), {}), null, 'no troop context, no guess');
  assert.equal(battleCasualties(battle(42)), 42);
});

test('only public diplomatic, elimination, victory and top-tier industry events are headlines', () => {
  const kinds = [
    [{ type: 'war_declared', fromRoster: ['usa'], toRoster: ['britain'] }, 'war'],
    [{ type: 'peace_accepted', fromRoster: ['usa'], toRoster: ['britain'] }, 'peace'],
    [{ type: 'alliance_activated', side: 'coalition-1', name: '<b>Pact</b>', roster: ['usa', 'france'] }, 'alliance'],
    [{ type: 'departed', country: 'usa', formerSide: 'coalition-1', side: 'solo:usa:s2' }, 'departure'],
    [{ type: 'coalition_dissolved', side: 'coalition-1' }, 'dissolved'],
    [{ type: 'eliminated', country: 'france' }, 'eliminated'],
    [{ type: 'dominance', side: 'coalition-1', winsAt: 200 }, 'dominance'],
    [{ type: 'finished', winningSide: null, draw: true, reason: 'deadline' }, 'finished'],
    [{ type: 'industry_damaged', province: 'ruhr', owner: 'france', level: 2 }, 'industry_down'],
  ];
  for (const [e, kind] of kinds) assert.equal(classifyHeadline(e, { maxDevelopment: 3 }).kind, kind, e.type);
  // Player text never enters a headline: clients read the alliance name from the event itself.
  assert.equal(JSON.stringify(classifyHeadline(kinds[2][0])).includes('Pact'), false);
  const built = { type: 'development_completed', province: 'ruhr', country: 'germany', level: 2 };
  assert.equal(classifyHeadline(built, { maxDevelopment: 3 }), null);
  assert.equal(classifyHeadline({ ...built, level: 3 }, { maxDevelopment: 3 }).kind, 'industry_up');
  assert.equal(classifyHeadline({ ...built, level: 3 }, {}), null);
  for (const type of ['message', 'army_departed', 'order_failed', 'joined', 'started', 'reinforced', 'development_started'])
    assert.equal(classifyHeadline({ type }, { maxDevelopment: 3, worldTroops: 1 }), null, type);
  assert.equal(classifyHeadline({ type: 'war_declared', fromRoster: [], toRoster: [], recipients: ['usa'] }), null);
});

test('observe and worldFeed attach the same engine headline; the feed is public and chronological', () => {
  const g = game();
  send(g, 'usa', { type: 'chat', channel: 'world', text: '<img src=x onerror=alert(1)> hello world' });
  advance(g, 10);
  send(g, 'britain', { type: 'chat', channel: 'dm', to: 'usa', text: 'secret' });
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  advance(g, 10);
  send(g, 'france', { type: 'chat', channel: 'world', text: 'Neutral France watches.' });
  const war = g.events.find(e => e.type === 'war_declared');
  const views = [observe(g, null), observe(g, 'usa'), observe(g, 'britain')];
  for (const view of views) assert.deepEqual(view.events.find(e => e.type === 'war_declared').headline, { kind: 'war', from: ['usa'], to: ['britain'] });
  assert.equal(views[0].events.find(e => e.type === 'started').headline, undefined);
  const feed = worldFeed(g);
  assert.deepEqual(feed.items.map(i => i.type), ['message', 'war_declared', 'message']);
  assert.deepEqual(feed.items.map(i => i.seq), [...feed.items.map(i => i.seq)].sort((a, b) => a - b));
  assert.equal(feed.items[0].text, '<img src=x onerror=alert(1)> hello world'); assert.equal(feed.items[0].untrusted, true);
  assert.ok(!JSON.stringify(feed).includes('secret'));
  assert.equal(feed.items[1].id, war.id); assert.equal(feed.cursor, g.sequence); assert.equal(feed.hasMore, false);
  assert.deepEqual(worldFeed(g, feed.items[1].seq).items.map(i => i.text), ['Neutral France watches.']);
  const first = worldFeed(g, 0, 1); assert.equal(first.hasMore, true); assert.equal(first.cursor, first.items[0].seq);
  assert.deepEqual(worldFeed(g, first.cursor, 5).items.map(i => i.type), ['war_declared', 'message']);
  assert.throws(() => worldFeed(g, -1), /cursor/); assert.throws(() => worldFeed(g, 0, 501), /limit/);
  // Coalition chat stays private even after the alliance forms.
  const offer = send(g, 'usa', { type: 'propose', country: 'france', name: 'Accord' });
  send(g, 'france', { type: 'accept', proposalId: offer.proposalId }); advance(g, 31);
  send(g, 'france', { type: 'chat', channel: 'alliance', text: 'coalition only' });
  const later = worldFeed(g);
  assert.ok(later.items.some(i => i.headline?.kind === 'alliance' && i.name === 'Accord'));
  assert.ok(!JSON.stringify(later).includes('coalition only'));
});

test('large phased battles are headlines at the end of their tick; small ones are not', () => {
  const small = game(['usa', 'britain']); small.rules.hold = 1800; // keep the match running through the fight
  const target = province(small, 'mexico'); Object.assign(target, { owner: 'britain', troops: 4, development: 2, nextRecruit: 1000 });
  province(small, 'west-us').troops = 24;
  send(small, 'usa', { type: 'declare_war', country: 'britain' });
  const move = send(small, 'usa', { type: 'move', from: 'west-us', to: 'mexico', amount: 9 });
  advance(small, move.arrivesAt + 40);
  const fought = small.events.filter(e => e.type === 'battle');
  assert.ok(fought.length >= 1);
  assert.ok(fought.every(e => !small.headlines[e.id]), 'a handful of casualties is not a headline');

  const large = game(['usa', 'britain']); large.rules.hold = 1800;
  Object.assign(province(large, 'mexico'), { owner: 'britain', troops: 80, nextRecruit: 5000 });
  province(large, 'west-us').troops = 160;
  send(large, 'usa', { type: 'declare_war', country: 'britain' });
  const big = send(large, 'usa', { type: 'move', from: 'west-us', to: 'mexico', amount: 150 });
  advance(large, big.arrivesAt + 200);
  const e = large.events.find(e => e.type === 'battle' && e.province === 'mexico');
  const h = observe(large, null).events.find(x => x.id === e.id).headline;
  assert.equal(h.kind, 'major_battle'); assert.equal(h.casualties, e.casualties);
  assert.ok(h.casualties >= h.threshold && h.threshold === majorBattleThreshold(h.worldTroops));
  assert.equal(Object.hasOwn(h, 'kills'), false, 'no per-country kill attribution');
  if (h.captured) assert.equal(h.owner, 'usa');
});

test('headlines are deterministic and a stopped hold follows its tick', () => {
  const run = () => { const g = game(['usa', 'britain']); send(g, 'usa', { type: 'declare_war', country: 'britain' }); advance(g, 5); return g; };
  assert.deepEqual(run().headlines, run().headlines);
  const events = [{ id: 4, tick: 7, type: 'battle', headline: { kind: 'major_battle' } }, { id: 5, tick: 8, type: 'message', channel: 'world', text: 'x' }];
  const breaks = [{ tick: 7, side: 'coalition-2', seq: 4, headline: { kind: 'dominance_broken', side: 'coalition-2', cause: 'economy' } }];
  const items = feedItems(events, breaks);
  assert.deepEqual(items.map(i => [i.seq, i.type]), [[4, 'battle'], [4, 'dominance_broken'], [5, 'message']]);
  const page = feedPage(items, 1, 5);
  assert.equal(page.items.length, 2, 'never split one cursor value across pages'); assert.equal(page.cursor, 4); assert.equal(page.hasMore, true);
});

const names = { country: id => ({ usa: 'United States', britain: 'British Empire', france: 'French Republic' })[id] || id,
  province: id => id, side: id => id, time: n => `t${n}` };
test('clients format, but never reclassify, headlines; big banners only for what affects the viewer', () => {
  const alliance = { id: 3, seq: 3, tick: 30, type: 'alliance_activated', name: '<img src=x>', headline: { kind: 'alliance', side: 'c1', countries: ['usa', 'france'] } };
  assert.match(headlineCopy(alliance, names).detail, /^<img src=x>: United States \+ French Republic\.$/);
  const plan = presentHeadline(alliance, names, { you: 'usa' });
  assert.equal(plan.banner.kind, 'alliance'); assert.equal(plan.banner.name, '<img src=x>');
  assert.deepEqual(plan.effects, [['alliance', { countries: ['usa', 'france'] }]]);
  assert.equal(presentHeadline(alliance, names, { you: 'britain' }).banner, null, 'someone else\'s alliance: rail row only');
  assert.deepEqual(presentHeadline(alliance, names, { you: 'britain' }).effects, plan.effects, 'the map effect stays');
  const fallen = { id: 8, tick: 90, type: 'eliminated', country: 'france', headline: { kind: 'eliminated', country: 'france' } };
  assert.equal(presentHeadline(fallen, names, { you: 'usa' }).banner, null);
  const ally = presentHeadline(fallen, names, { you: 'usa', allies: ['france'] }), own = presentHeadline(fallen, names, { you: 'france' });
  assert.equal(ally.banner.kind, 'fallen'); assert.equal(ally.banner.title, 'French Republic has fallen');
  assert.equal(own.banner.kind, 'defeat'); assert.equal(own.banner.title, 'Your country has fallen');
  assert.deepEqual(ally.effects, [['eliminated', { country: 'france' }]]);
  const fight = { id: 9, tick: 91, type: 'battle', arrivals: [{ country: 'usa', amount: 40 }], headline: { kind: 'major_battle', province: 'mexico', casualties: 44, worldTroops: 900, threshold: 27, captured: true, owner: 'usa', previousOwner: 'britain' } };
  assert.equal(presentHeadline(fight, names, { you: 'britain' }).banner.title, 'Major battle at mexico');
  assert.match(presentHeadline(fight, names, { you: 'usa' }).banner.detail, /^44 troops lost/);
  assert.equal(presentHeadline(fight, names, { you: 'france' }).banner, null);
  assert.deepEqual(presentHeadline(fight, names, null).effects, [['captured', { province: 'mexico', owner: 'usa' }]]);
  const built = { id: 10, tick: 92, type: 'development_completed', headline: { kind: 'industry_up', province: 'ruhr', country: 'usa', level: 3 } };
  assert.equal(presentHeadline(built, names, { you: 'usa' }).banner, null, 'industry is feed + map effect only');
  assert.deepEqual(presentHeadline(built, names, null).effects, [['industry_up', { province: 'ruhr', level: 3 }]]);
});

test('popup policy: a third-party war is a rail row, a war on the viewer is one banner, spectators get none', async () => {
  const { affectsViewer } = await import('../public/feed-model.js');
  const war = to => ({ headline: { kind: 'war', from: ['germany'], to } });
  assert.equal(presentHeadline(war(['russia']), names, { you: 'usa' }).banner, null);
  assert.equal(presentHeadline(war(['usa', 'britain']), names, { you: 'usa' }).banner.kind, 'war');
  assert.equal(presentHeadline(war(['britain']), names, { you: 'usa', allies: ['britain'] }).banner.kind, 'war', 'your coalition is named');
  const kinds = [war(['usa']), { headline: { kind: 'peace', from: ['usa'], to: ['germany'] } }, { headline: { kind: 'alliance', side: 'c', countries: ['usa'] } },
    { headline: { kind: 'eliminated', country: 'usa' } }, { headline: { kind: 'major_battle', province: 'p', owner: 'usa' } },
    { headline: { kind: 'dominance', side: 'c' } }, { headline: { kind: 'dominance_broken', side: 'c' } }, { headline: { kind: 'departure', country: 'usa', side: 'c' } }];
  for (const item of kinds) assert.equal(presentHeadline(item, names, { you: null }).banner, null, item.headline.kind);
  assert.equal(affectsViewer({ headline: { kind: 'finished' } }, {}), true, 'the result is the one thing spectators are shown big');
  assert.equal(affectsViewer({ headline: { kind: 'dissolved', side: 'c9' } }, { you: 'usa', side: 'solo:usa:3', pastSides: ['c9'] }), true);
  assert.equal(affectsViewer({ headline: { kind: 'industry_down', province: 'p', owner: 'usa' } }, { you: 'usa' }), true);
  assert.equal(affectsViewer({ headline: { kind: 'dominance', side: 'c' } }, { you: 'usa' }), true, 'a countdown is for or against every seat');
});

test('a real elimination reaches every client as the same feed headline', () => {
  const g = game(['usa', 'britain']); g.rules.hold = 1800;
  for (const p of g.provinces.filter(p => p.owner === 'britain')) Object.assign(p, { owner: null, troops: 2 });
  Object.assign(province(g, 'mexico'), { owner: 'britain', troops: 1, nextRecruit: 5000 });
  province(g, 'west-us').troops = 40;
  send(g, 'usa', { type: 'declare_war', country: 'britain' });
  const move = send(g, 'usa', { type: 'move', from: 'west-us', to: 'mexico', amount: 30 });
  advance(g, move.arrivesAt + 10);
  const fallen = worldFeed(g).items.find(i => i.type === 'eliminated');
  assert.deepEqual(fallen.headline, { kind: 'eliminated', country: 'britain' });
  for (const viewer of [null, 'usa', 'britain'])
    assert.deepEqual(observe(g, viewer, 0, 10000).events.find(e => e.type === 'eliminated').headline, fallen.headline);
});
