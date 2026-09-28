import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, start, observe } from '../src/engine.js';
import { MAP } from '../src/server.js';
import { boardView } from '../agents/board.js';
import { mapViewSvg } from '../agents/map-view.js';
import { strategicOptions } from '../agents/strategic-options.js';
import { decisionView } from '../agents/decision-view.js';

test('compact board shows only observed state and legal direct connections', () => {
  const game = createGame({ id: 'board-test', name: 'Board', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  game.orders.push({ type: 'move', country: 'britain', from: 'england', to: 'low-countries',
    amount: 2, executeAt: game.tick + 1 });
  game.provinces.find(p => p.id === 'england').troops = 200;
  const seen = observe(game, 'britain');
  const board = boardView(seen, MAP);
  const england = board.own.find(p => p.id === 'england');
  const source = seen.provinces.find(p => p.id === 'england');
  assert.equal(board.provinces.length, seen.provinces.length);
  assert.deepEqual(board.victoryRule, { targetEconomy: seen.economyThreshold,
    holdTicks: seen.rules.hold, deadlinePrizeFractions: seen.rules.deadlinePrizes,
    alliancePowerExponent: seen.rules.strengthExponent, maturityTicks: seen.rules.maturity });
  assert.equal(england.available, source.troops - 3);
  assert.equal(board.readyDevelopments.find(p => p.from === 'england')?.cost,
    seen.rules.developmentCosts[source.development]);
  assert.deepEqual(board.readyDevelopments.map(p => p.from).sort(),
    strategicOptions(seen, MAP).readyDevelopments.map(p => p.province).sort());
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
  assert.equal(view.position.industryGap, strategicOptions(seen, MAP).industryGap);
  assert.equal(view.eventCursor, seen.cursor);
  assert.deepEqual(view.recentOutcomes, [{ tick: 2, type: 'battle', country: 'britain', to: 'france' }]);
  assert.doesNotMatch(JSON.stringify(view), /private player speech|untrusted reason/);
  assert.ok(JSON.stringify(view).length < 14000);
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
