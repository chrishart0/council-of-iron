import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, start, act, observe, tick } from '../src/engine.js';
import { MAP } from '../src/server.js';
import { boardView } from '../agents/board.js';
import { mapViewSvg } from '../agents/map-view.js';
import { developmentForecast } from '../public/insights.js';
import { decisionView } from '../agents/decision-view.js';
import { friendlyPath } from '../public/movement.js';

test('compact board shows only observed state and legal direct connections', () => {
  const game = createGame({ id: 'board-test', name: 'Board', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  game.orders.push({ type:'march', country: 'britain', from: 'england', to: 'low-countries',
    amount: 2, executeAt: game.tick + 1 });
  game.provinces.find(p => p.id === 'england').troops = 200;
  const seen = observe(game, 'britain');
  const board = boardView(seen, MAP);
  const england = board.own.find(p => p.id === 'england');
  const source = seen.provinces.find(p => p.id === 'england');
  assert.equal(board.provinces.length, seen.provinces.length);
  assert.deepEqual(board.victoryRule, { targetIndustry: seen.economyThreshold, holdTicks: seen.rules.hold, maxAlliance: 1 });
  assert.equal(england.available, source.troops - 3);
  assert.equal(board.readyDevelopments.find(p => p.from === 'england')?.cost,
    seen.rules.developmentCosts[source.development]);
  assert.ok(board.readyDevelopments.every(p => developmentForecast(seen, p.from).cost === p.cost));
  game.orders.push({ type: 'develop', country: 'britain', from: 'england', amount: seen.rules.developmentCosts[source.development],
    executeAt: game.tick + 1 });
  assert.equal(boardView(observe(game, 'britain'), MAP).readyDevelopments.some(p => p.from === 'england'), false);
  assert.ok(england.neighbors.some(p => p.id === 'low-countries' && p.owner === null));
  assert.ok(england.neighbors.some(p => p.owner === 'france' && p.attackReady === false));
  assert.ok(board.sides.every(side => !Object.hasOwn(side,'winsAt')));
  game.dominance[game.players.find(p=>p.id==='france').side]=game.tick;
  assert.equal(boardView(observe(game,'britain'),MAP).sides.find(side=>side.members.includes('france')).winsAt,game.rules.hold);
  assert.ok(JSON.stringify(board).length < 10000);
  assert.equal('events' in board, false);
  assert.equal('travelTimes' in board, false);
  assert.throws(() => boardView(observe(game), MAP), /Join a country/);
});

test('decision view adds feasible frontier and filters delivered outcomes', () => {
  const game = createGame({ id: 'decision-test', name: 'Decision', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  game.provinces.find(p => p.id === 'england').troops = 200;
  const seen = observe(game, 'britain');
  seen.events = [
    { id: 1, tick: 2, type: 'battle', country: 'britain', to: 'france',
      text: 'private player speech', reason: 'untrusted reason' },
    { id: 2, tick: 3, type: 'chat', text: 'private player speech' },
  ];
  const view = decisionView(seen, MAP);
  const england = view.own.find(p => p.id === 'england');
  assert.ok(view.frontier.some(p => p.id === 'low-countries' &&
    p.sources.some(source => source.id === 'england' && source.available === england.available)));
  // A target bordering your own land is on the frontier even when the bordering province has no free troops
  // (troops can come from anywhere in your empire); land that only an ally borders is not.
  const lone = game.provinces.find(p => p.id === 'egypt'); lone.troops = 1;
  const quiet = decisionView(observe(game, 'britain'), MAP);
  const egyptOnly = MAP.provinces.find(p => p.id === 'egypt').neighbors.filter(id => !MAP.provinces.find(q => q.id === id).neighbors.some(n => n !== 'egypt' && game.provinces.find(v => v.id === n).owner === 'britain') && game.provinces.find(v => v.id === id).owner !== 'britain');
  for (const id of egyptOnly) assert.ok(quiet.frontier.some(t => t.id === id && t.sources.length === 0 && t.earliestArrival === null), id);
  assert.ok(quiet.frontier.every(t => MAP.provinces.find(p => p.id === t.id).neighbors.some(n => game.provinces.find(v => v.id === n).owner === 'britain')));
  const britain = seen.sides.find(s => s.members.includes('britain'));
  assert.equal(view.position.industryGap, Math.max(0, seen.economyThreshold - britain.economy));
  assert.deepEqual(view.possiblePartners.map(p => p.country), ['france']);
  assert.equal(view.eventCursor, seen.cursor);
  assert.deepEqual(view.recentOutcomes, [{ tick: 2, type: 'battle', country: 'britain', to: 'france' }]);
  assert.doesNotMatch(JSON.stringify(view), /private player speech|untrusted reason/);
  assert.ok(JSON.stringify(view).length < 14000);
});

test('decision view shows public border links to possible alliance partners', () => {
  const game = createGame({ id: 'decision-partner-borders', name: 'Borders', hostId: 'russia' }, MAP);
  // On v6 Russia and the Ottomans meet only across the neutral Caucasus; Germany borders Poland.
  for (const country of ['russia', 'britain', 'germany'])
    join(game, MAP, { profileId: country, name: country, country });
  start(game);
  const view = decisionView(observe(game, 'russia'), MAP);
  const partners = new Map(view.possiblePartners.map(partner => [partner.country, partner]));
  assert.equal(partners.get('britain').sharedBorderLinks, 0);
  assert.ok(partners.get('germany').sharedBorderLinks > 0);
});

test('decision view separates country industry from alliance industry', () => {
  const game = createGame({ id: 'decision-alliance-economy', name: 'Alliance economy', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  join(game, MAP, { profileId: 'usa', name: 'USA', country: 'usa' });
  join(game, MAP, { profileId: 'japan', name: 'Japan', country: 'japan' });
  start(game);
  const { proposalId } = act(game, MAP, 'britain', { type: 'propose', country: 'france', name: 'Entente' }, 'pact');
  act(game, MAP, 'france', { type: 'accept', proposalId }, 'pact-accept');
  while (game.players.find(p => p.id === 'britain').side !== game.players.find(p => p.id === 'france').side) tick(game);
  const industryOf = country => game.provinces.filter(p => p.owner === country).reduce((n, p) => n + p.development, 0);
  const view = decisionView(observe(game, 'britain'), MAP);
  assert.equal(view.position.ownIndustry, industryOf('britain'));
  assert.equal(view.position.sideIndustry, industryOf('britain') + industryOf('france'));
  assert.equal(view.position.allianceSize, 2);
  assert.ok(!view.possiblePartners.some(p => p.country === 'france'));
  // The side ahead is the deadline winner: named to a trailing side, never to itself.
  assert.equal(view.position.leader, undefined);
  assert.equal(view.position.ticksLeft, game.rules.duration - game.tick);
  const japan = decisionView(observe(game, 'japan'), MAP);
  assert.deepEqual(japan.position.leader, { members: ['britain', 'france'], industry: industryOf('britain') + industryOf('france') });
});

test('decision view groups your provinces exactly as marches and rallies can route between them', () => {
  const game = createGame({ id: 'decision-groups', name: 'Groups', hostId: 'britain' }, MAP);
  const countries = MAP.countries.map(c => c.id);
  for (const country of countries) join(game, MAP, { profileId: country, name: country, country });
  start(game);
  let split = 0;
  for (const country of countries) {
    const seen = observe(game, country), view = decisionView(seen, MAP);
    const groups = view.connectedGroups ?? [seen.provinces.filter(p => p.owner === country).map(p => p.id).sort()];
    if (view.connectedGroups) split++;
    const groupOf = new Map(groups.flatMap((group, i) => group.map(id => [id, i])));
    for (const a of groupOf.keys()) for (const b of groupOf.keys()) if (a !== b)
      assert.equal(friendlyPath(seen, country, a, b) !== null, groupOf.get(a) === groupOf.get(b), `${country}: ${a} → ${b}`);
  }
  assert.ok(split > 0, 'some starting country has land in more than one group');
});
test('map image uses public geometry and never inserts player text', () => {
  const game = createGame({ id: 'map-test', name: 'Map', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: '<script>private speech</script>', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  const svg = mapViewSvg(observe(game, 'britain'), MAP);
  assert.match(svg, /<svg/);
  assert.match(svg, /Council of Iron/);
  assert.doesNotMatch(svg, /private speech|<script>/);
});
