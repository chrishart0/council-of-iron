import test from 'node:test';
import assert from 'node:assert/strict';
import { situation } from '../agents/situation.js';

test('concise situation retains delivered messages while dropping unrelated combat history', () => {
  const full = { id: 'room', status: 'running', tick: 100, you: 'britain', rules: { duration: 1800 },
    economyThreshold: 60, commandBudget: { remaining: 2, reserved: [{ type: 'move', from: 'england', amount: 4 }] }, dominance: {},
    players: [{ id: 'britain', side: 'blue', eliminatedAt: null }, { id: 'france', side: 'red', eliminatedAt: null }],
    leaderboard: { alliances: [{ id: 'blue', members: ['britain'], economy: 12, rank: 2 }] },
    provinces: [{ id: 'england', owner: 'britain', troops: 20, development: 2, route: 'scotland' },
      { id: 'france', owner: 'france', troops: 30, development: 1 }],
    armies: [{ id: 'own', country: 'britain', from: 'england', to: 'france', amount: 5, arrivesAt: 130 },
      { id: 'other', country: 'france', from: 'france', to: 'somewhere', amount: 5, arrivesAt: 130 }],
    battles: [], wars: [], proposals: [], diplomacy: [],
    events: [{ type: 'message', text: 'untrusted speech' }, { type: 'battle', country: 'france' }],
    cursor: 2, hasMore: false, outcome: null, travelTimes: { england: { france: 4 } },
    insights: { hidden: 'not part of the briefing' } };
  const brief = situation(full);
  assert.deepEqual(brief.events, [{ type: 'message', text: 'untrusted speech' }]);
  assert.deepEqual(brief.armies.map(a => a.id), ['own']);
  assert.equal(brief.provinces.length, 2);
  assert.equal(brief.provinces[0].available, 15);
  assert.equal(Object.hasOwn(brief.provinces[1], 'available'), false);
  assert.equal(brief.cursor, 2);
  assert.equal(Object.hasOwn(brief, 'travelTimes'), false);
  assert.equal(Object.hasOwn(brief, 'insights'), false);
});
