import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, start, act, observe } from '../src/engine.js';
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
    { id: 3, tick: 4, type: 'message', from: 'france', to: 'britain', channel: 'dm',
      text: '<b>player speech</b>' },
  ];
  const view = decisionView(seen, MAP);
  const england = view.own.find(p => p.id === 'england');
  assert.ok(view.frontier.some(p => p.id === 'low-countries' &&
    p.sources.some(source => source.id === 'england' && source.available === england.available)));
  assert.equal(view.position.industryGap, strategicOptions(seen, MAP).industryGap);
  assert.equal(view.position.currentVictoryShare,
    seen.leaderboard.players.find(p => p.country === 'britain').victoryShare);
  assert.equal(view.eventCursor, seen.cursor);
  assert.deepEqual(view.recentOutcomes, [{ tick: 2, type: 'battle', country: 'britain', to: 'france' }]);
  assert.deepEqual(view.deliveredMessages, [{ id: 3, tick: 4, from: 'france', to: 'britain',
    channel: 'dm', text: '<b>player speech</b>', untrusted: true }]);
  assert.equal(view.omittedDeliveredMessages, 0);
  assert.doesNotMatch(JSON.stringify(view), /private player speech|untrusted reason/);
  assert.ok(JSON.stringify(view).length < 15000);
});

test('decision view preserves recipient filtering for delivered messages', () => {
  const game = createGame({ id: 'decision-mail', name: 'Mail', hostId: 'britain' }, MAP);
  for (const country of ['britain', 'france', 'usa'])
    join(game, MAP, { profileId: country, name: country, country });
  start(game);
  act(game, MAP, 'france', { type: 'chat', channel: 'dm', to: 'usa', text: 'Hidden dispatch' }, 'private-us');
  act(game, MAP, 'usa', { type: 'chat', channel: 'dm', to: 'britain', text: 'Visible dispatch' }, 'private-britain');
  const seen = decisionView(observe(game, 'britain'), MAP);
  assert.deepEqual(seen.deliveredMessages.map(message => [message.from, message.text, message.untrusted]),
    [['usa', 'Visible dispatch', true]]);
  assert.doesNotMatch(JSON.stringify(seen), /Hidden dispatch/);
});

test('decision view separates country industry from alliance industry', () => {
  const game = createGame({ id: 'decision-alliance-economy', name: 'Alliance economy', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  const seen = observe(game, 'britain');
  const side = seen.players.find(player => player.id === 'britain').side;
  seen.players.find(player => player.id === 'france').side = side;
  const countryIndustry = seen.provinces.filter(province => province.owner === 'britain')
    .reduce((total, province) => total + province.development, 0);
  const allyIndustry = seen.provinces.filter(province => province.owner === 'france')
    .reduce((total, province) => total + province.development, 0);
  seen.leaderboard.alliances.find(entry => entry.id === side).economy = countryIndustry + allyIndustry;
  const view = decisionView(seen, MAP);
  assert.equal(view.position.ownIndustry, countryIndustry);
  assert.equal(view.position.sideIndustry, countryIndustry + allyIndustry);
});

test('decision view bounds delivered player speech in a busy event batch', () => {
  const game = createGame({ id: 'decision-busy-mail', name: 'Busy mail', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  const seen = observe(game, 'britain');
  seen.events = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1, tick: index + 1, type: 'message', from: 'france',
    to: 'britain', channel: 'dm', text: `Dispatch ${index + 1}`,
  }));
  const view = decisionView(seen, MAP);
  assert.equal(view.deliveredMessages.length, 8);
  assert.equal(view.deliveredMessages[0].id, 3);
  assert.equal(view.omittedDeliveredMessages, 2);
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
