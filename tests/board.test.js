import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, start, observe } from '../src/engine.js';
import { MAP } from '../src/server.js';
import { boardView } from '../agents/board.js';
import { mapViewSvg } from '../agents/map-view.js';

test('compact board shows only observed state and legal direct connections', () => {
  const game = createGame({ id: 'board-test', name: 'Board', hostId: 'britain' }, MAP);
  join(game, MAP, { profileId: 'britain', name: 'Britain', country: 'britain' });
  join(game, MAP, { profileId: 'france', name: 'France', country: 'france' });
  start(game);
  game.orders.push({ type: 'move', country: 'britain', from: 'england', to: 'low-countries',
    amount: 2, executeAt: game.tick + 1 });
  const seen = observe(game, 'britain');
  const board = boardView(seen, MAP);
  const england = board.own.find(p => p.id === 'england');
  const source = seen.provinces.find(p => p.id === 'england');
  assert.equal(board.provinces.length, seen.provinces.length);
  assert.equal(england.available, source.troops - 3);
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
