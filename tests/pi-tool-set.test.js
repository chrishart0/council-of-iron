import test from 'node:test';
import assert from 'node:assert/strict';
import { gameToolNames } from '../agents/pi/tool-set.js';

test('decision-view Pi matches retain distinct commands and one current state read', () => {
  const names = gameToolNames({ taskMode: 'match', turnView: 'decision', vision: false });
  for (const name of ['decision_view', 'news', 'strategic_options', 'preview', 'plan_attack',
    'move', 'coordinated_attack', 'develop', 'propose_alliance', 'accept_alliance',
    'declare_war', 'offer_peace', 'send_message']) assert.ok(names.has(name), name);
  for (const name of ['map', 'observe', 'situation', 'board', 'after_action_report',
    'replay_state', 'standings']) assert.ok(!names.has(name), name);
});

test('other Pi tasks keep the full game tool menu', () => {
  const names = gameToolNames({ taskMode: 'fixed', turnView: 'decision', vision: true });
  for (const name of ['map', 'observe', 'situation', 'board', 'after_action_report',
    'view_map', 'move', 'declare_war']) assert.ok(names.has(name), name);
});
