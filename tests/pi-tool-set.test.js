import test from 'node:test';
import assert from 'node:assert/strict';
import { gameToolNames } from '../agents/pi/tool-set.js';

test('decision-view Pi matches retain distinct commands, the inbox and one current state read', () => {
  const names = gameToolNames({ taskMode: 'match', turnView: 'decision', vision: false });
  for (const name of ['decision_view', 'news', 'inbox', 'preview', 'march', 'turn_around', 'rally', 'develop',
    'propose_alliance', 'accept_alliance', 'declare_war', 'offer_peace', 'accept_peace', 'send_message']) assert.ok(names.has(name), name);
  for (const name of ['map', 'observe', 'board', 'after_action_report', 'replay_state', 'standings']) assert.ok(!names.has(name), name);
});

test('other Pi tasks keep the full game tool menu', () => {
  const names = gameToolNames({ taskMode: 'fixed', turnView: 'decision', vision: true });
  for (const name of ['map', 'observe', 'board', 'after_action_report', 'view_map', 'march', 'declare_war']) assert.ok(names.has(name), name);
});

test('every Pi game tool is a tool the Council MCP server advertises', async () => {
  const { readFileSync } = await import('node:fs');
  const advertised = new Set([...readFileSync(new URL('../agents/mcp.js', import.meta.url), 'utf8').matchAll(/^tool\('([a-z_]+)'/gm)].map(m => m[1]));
  for (const name of gameToolNames({ taskMode: 'fixed', turnView: 'tools', vision: true })) assert.ok(advertised.has(name), name);
});
