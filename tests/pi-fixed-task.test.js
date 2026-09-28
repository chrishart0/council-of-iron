import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, start, act } from '../src/engine.js';
import { MAP } from '../src/server.js';
import { FIXED_TASK_ID, evaluateFixedTask } from '../agents/pi/fixed-task.js';
import { summarizeTaskRun } from '../agents/pi/task-bench.js';

test('fixed board task uses ordinary action validation and exact accepted orders', () => {
  const game = createGame({ id: 'fixed-test', name: 'Fixed test', hostId: 'britain' }, MAP);
  for (const country of MAP.countries) join(game, MAP, { profileId: country.id, name: country.id,
    country: country.id, kind: country.id === 'britain' ? 'agent' : 'bot' });
  start(game);
  const expected = [
    { type: 'march', from: 'england', to: 'low-countries', amount: 5 },
    { type: 'declare_war', country: 'france' },
    { type: 'march', from: 'ireland', to: 'north-france', amount: 5 },
  ];
  for (const [index, action] of expected.entries())
    assert.equal(act(game, MAP, 'britain', action, `fixed-${index}`).ok, true);
  assert.deepEqual(evaluateFixedTask(game.actionLog), { id: FIXED_TASK_ID, success: true,
    correctSteps: 3, requiredSteps: 3, acceptedOrders: 3, extraAcceptedOrders: 0 });
  game.actionLog.push({ country: 'britain', action: { type: 'chat', channel: 'world', text: 'extra' } });
  assert.equal(evaluateFixedTask(game.actionLog).success, false);
});

test('fixed task aggregate preserves measurements and excludes private content', () => {
  const raw = { runId: 'task-one', taskId: FIXED_TASK_ID, startedAt: '2026-09-28T00:00:00Z',
    finishedAt: '2026-09-28T00:01:00Z', taskResult: { success: true, correctSteps: 3,
      requiredSteps: 3, acceptedOrders: 3 }, actions: [
      { ok: true, at: '2026-09-28T00:00:10Z' }, { ok: true, at: '2026-09-28T00:00:20Z' },
      { ok: true, at: '2026-09-28T00:00:30Z' }], toolCalls: [{ ok: true }, { ok: false }],
    usage: { input: 100, output: 20, cacheRead: 50, total: 170 }, endpoint: 'private-endpoint',
    lastResponse: 'private chat', apiKey: 'secret' };
  const result = summarizeTaskRun(raw, 'qwen');
  assert.equal(result.completionSeconds, 30);
  assert.equal(result.failedToolCalls, 1);
  assert.equal(result.totalTokens, 170);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|endpoint/);
  assert.throws(() => summarizeTaskRun({ ...raw, taskResult: null }, 'qwen'), /completed fixed task/);
  const fallback = summarizeTaskRun({ ...raw, client: 'codex', access: 'mcp',
    events: [{ type: 'item.completed', itemType: 'command_execution', exitCode: 0 }],
    httpActions: [{ status: 200, at: '2026-09-28T00:00:10Z' },
      { status: 200, at: '2026-09-28T00:00:20Z' },
      { status: 200, at: '2026-09-28T00:00:30Z' }] }, 'qwen');
  assert.equal(fallback.access, 'shell fallback');
});
