import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun } from '../agents/pi/bench.js';

const score = { prestige: 27.571, victoryShare: 0.3189 };

test('benchmark export keeps aggregate Pi metrics and excludes private run content', () => {
  const raw = { runId: 'run-1', startedAt: '2026-09-28T00:00:00Z', finishedAt: '2026-09-28T00:01:00Z',
    match: 'abcd1234', status: 'finished', preset: 'quick', finalTick: 1800, outcome: { reason: 'deadline' }, score,
    endpoint: 'http://private-endpoint', apiKey: 'secret', lastResponse: 'private conversation',
    toolCalls: [{ ok: true }, { ok: false }], actions: [{ ok: true, at: '2026-09-28T00:00:12Z' }, { ok: false }],
    usage: { input: 1000, output: 300, cacheRead: 400 }, turnLog: [{ wallMs: 20000 }, { wallMs: 30000 }] };
  const run = summarizeRun(raw, 'luna');
  assert.equal(run.prestige, 27.57);
  assert.equal(run.acceptedActions, 1);
  assert.equal(run.rejectedActions, 1);
  assert.equal(run.failedToolCalls, 1);
  assert.equal(run.totalTokens, 1300);
  assert.equal(run.meanTurnSeconds, 25);
  assert.equal(run.firstActionSeconds, 12);
  assert.equal(run.country, 'britain');
  assert.doesNotMatch(JSON.stringify(run), /private|secret|endpoint/);
  assert.equal(summarizeRun(raw, 'external').modelGroup, 'external');
});

test('benchmark export does not invent missing historical action or token counts', () => {
  const run = summarizeRun({ runId: 'old', startedAt: '2026-09-28T00:00:00Z', match: 'abcd1234',
    status: 'finished', score, client: 'codex', access: 'cli', events: [] }, 'qwen');
  assert.equal(run.acceptedActions, null);
  assert.equal(run.rejectedActions, null);
  assert.equal(run.totalTokens, null);
  assert.equal(run.firstActionSeconds, null);
  assert.equal(run.meanTurnSeconds, null);
  assert.throws(() => summarizeRun({ status: 'running' }, 'qwen'), /finished score/);
});
