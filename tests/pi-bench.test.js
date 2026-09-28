import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun } from '../agents/pi/bench.js';

const score = { prestige: 27.571, victoryShare: 0.3189 };

test('benchmark export keeps aggregate Pi metrics and excludes private run content', () => {
  const raw = { runId: 'run-1', startedAt: '2026-09-28T00:00:00Z', finishedAt: '2026-09-28T00:01:00Z', interfaceVersion:'board-turn-v2',
    match: 'abcd1234', status: 'finished', preset: 'quick', finalTick: 1800, outcome: { reason: 'deadline' }, score,
    endpoint: 'http://private-endpoint', apiKey: 'secret', lastResponse: 'private conversation',
    toolCalls: [{ ok: true }, { ok: false }], actions: [{ ok: true, at: '2026-09-28T00:00:12Z' }, { ok: false }],
    usage: { input: 1000, output: 300, cacheRead: 400 }, turnLog: [{ wallMs: 20000, timedOut: false }, { wallMs: 30000, timedOut: true }] };
  const run = summarizeRun(raw, 'luna');
  assert.equal(run.prestige, 27.57);
  assert.equal(run.interfaceVersion,'board-turn-v2');
  assert.equal(run.acceptedActions, 1);
  assert.equal(run.rejectedActions, 1);
  assert.equal(run.failedToolCalls, 1);
  assert.equal(run.totalTokens, 1300);
  assert.equal(run.meanTurnSeconds, 25);
  assert.equal(run.timedOutTurns, 1);
  assert.equal(run.firstActionSeconds, 12);
  assert.equal(run.country, 'britain');
  assert.doesNotMatch(JSON.stringify(run), /private|secret|endpoint/);
  assert.equal(summarizeRun(raw, 'external').modelGroup, 'external');
  assert.equal(summarizeRun({ ...raw, toolCalls: [{ name: 'board', ok: true }] }, 'luna').strategy,
    'compact board');
  assert.equal(summarizeRun({ ...raw, toolCalls: [{ name: 'view_map', ok: true }] }, 'luna').strategy,
    'visual map');
  assert.equal(summarizeRun({ ...raw, toolCalls: [{ name: 'board', ok: true }, { name: 'news', ok: true }] }, 'luna').strategy,
    'compact board + news');
  assert.equal(summarizeRun({ ...raw, embeddedBoard: true }, 'luna').strategy, 'board in prompt');
  assert.equal(summarizeRun({ ...raw, embeddedBoard: true, turnView: 'decision' }, 'luna').strategy,
    'decision view in prompt');
  assert.equal(summarizeRun({ ...raw, embeddedBoard: false, turnView: 'tools' }, 'luna').strategy,
    'tool-led turns');
});

test('benchmark export does not invent missing historical action or token counts', () => {
  const run = summarizeRun({ runId: 'old', startedAt: '2026-09-28T00:00:00Z', match: 'abcd1234',
    status: 'finished', score, client: 'codex', access: 'cli', events: [] }, 'qwen');
  assert.equal(run.acceptedActions, null);
  assert.equal(run.rejectedActions, null);
  assert.equal(run.totalTokens, null);
  assert.equal(run.firstActionSeconds, null);
  assert.equal(run.meanTurnSeconds, null);
  assert.equal(run.timedOutTurns, null);
  const noOrders = summarizeRun({ runId: 'zero', startedAt: '2026-09-28T00:00:00Z', match: 'abcd1234',
    status: 'finished', score, client: 'codex', access: 'cli', events: [], httpActions: [] }, 'qwen');
  assert.equal(noOrders.acceptedActions, 0);
  assert.equal(noOrders.rejectedActions, 0);
  const partial = summarizeRun({ runId: 'partial', startedAt: '2026-09-28T00:00:00Z', match: 'abcd1234',
    status: 'finished', score, client: 'codex', access: 'mcp', events: [], httpActions: [],
    usage: { input: 100, output: 50, total: 150 }, usageIncomplete: true,
    turnLog: [{ wallMs: 1000 }] }, 'luna');
  assert.equal(partial.totalTokens, null);
  assert.equal(partial.meanTurnSeconds, null);
  assert.equal(partial.timedOutTurns, null);
  assert.equal(summarizeRun({ ...rawForCodex(), turnMode: 'episodic' }, 'qwen').sessionMode, 'episodic');
  const resumed = summarizeRun({ ...rawForCodex(), turnMode: 'episodic',
    usage: { input: 450, output: 45, cacheRead: 360, total: 495 },
    turnLog: [{ inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, wallMs: 1000 },
      { inputTokens: 350, outputTokens: 35, cacheReadTokens: 280, wallMs: 2000 }] }, 'qwen');
  assert.equal(resumed.totalTokens, 385);
  assert.equal(resumed.uncachedTokens, 105);
  assert.equal(resumed.meanTurnSeconds, 1.5);
  assert.equal(summarizeRun({ ...rawForCodex(), timedOutTurns: 2 }, 'qwen').timedOutTurns, 2);
  const direct = summarizeRun({ ...rawForCodex(), events: [{ itemType: 'command_execution',
    command: 'curl http://127.0.0.1:1234/api/games/test/actions -H "Authorization: secret"' }] }, 'qwen');
  assert.equal(direct.access, 'shell HTTP');
  assert.doesNotMatch(JSON.stringify(direct), /Authorization|secret|127\.0\.0\.1/);
  assert.throws(() => summarizeRun({ status: 'running' }, 'qwen'), /finished score/);
});

function rawForCodex() { return { runId: 'codex-mode', startedAt: '2026-09-28T00:00:00Z',
  match: 'abcd1234', status: 'finished', score, client: 'codex', access: 'cli', events: [], httpActions: [] }; }
