import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_MAP_ID, summarizeRun, summarizeProgress } from '../agents/pi/bench.js';
import { summarizePlaytestSeat } from '../agents/pi/bench-playtest.js';

const score = { country: 'britain', result: 'win', industry: 14 };

test('benchmark export keeps aggregate Pi metrics and excludes private run content', () => {
  const raw = { runId: 'run-1', startedAt: '2026-09-28T00:00:00Z', finishedAt: '2026-09-28T00:01:00Z', interfaceVersion:'board-turn-v2',
    match: 'abcd1234', mapId: CURRENT_MAP_ID, country: 'britain', status: 'finished', preset: 'quick', finalTick: 1800, outcome: { reason: 'deadline' }, score,
    endpoint: 'http://private-endpoint', apiKey: 'secret', lastResponse: 'private conversation',
    toolCalls: [{ ok: true }, { ok: false }], actions: [{ ok: true, at: '2026-09-28T00:00:12Z' }, { ok: false }],
    usage: { input: 1000, output: 300, cacheRead: 400 }, turnLog: [{ wallMs: 20000, timedOut: false }, { wallMs: 30000, timedOut: true }] };
  const run = summarizeRun(raw, 'luna');
  assert.equal(run.result, 'win');
  assert.equal(run.won, true);
  assert.equal(summarizeRun({ ...raw, score: { ...score, side: 'alliance', result: 'loss', industry: 0 },
    outcome: { winningSide: 'alliance', draw: false, reason: 'domination' } }, 'luna').won, false);
  assert.throws(() => summarizeRun({ ...raw, score: { ...score, industry: 0 } }, 'luna'), /credited a country with no industry/);
  assert.equal(run.industry, 14);
  assert.equal(run.interfaceVersion,'board-turn-v2');
  assert.equal(run.acceptedActions, 1);
  assert.equal(run.rejectedActions, 1);
  assert.equal(run.failedToolCalls, 1);
  // One token definition across harnesses: Pi reports cache reads beside input, so they are added in.
  assert.equal(run.inputTokens, 1400);
  assert.equal(run.totalTokens, 1700);
  assert.equal(run.uncachedTokens, 1300);
  assert.equal(run.meanTurnSeconds, 25);
  assert.equal(run.timedOutTurns, 1);
  assert.equal(run.firstActionSeconds, 12);
  assert.equal(run.country, 'britain');
  assert.equal(run.mapId, CURRENT_MAP_ID);
  assert.equal(run.harness, 'Pi');
  assert.equal(run.arena, 'seven practice bots');
  assert.throws(() => summarizeRun({ ...raw, mapId: 'imperial-1910-v5' }, 'luna'), /current map/);
  assert.doesNotMatch(JSON.stringify(run), /private|secret|endpoint/);
  assert.equal(summarizeRun(raw, 'external').modelGroup, 'external');
  assert.equal(summarizeRun(raw, 'deepseek').modelGroup, 'deepseek');
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

test('position progress publishes only numeric facts and the authoritative final industry', () => {
  const raw = [{ tick: 0, ownIndustry: 5, sideIndustry: 8, ownProvinces: 3,
    sideMembers: ['private ally'], decisionViewBytes: 4500, secret: 'private chat' },
    { tick: 20, ownIndustry: 7, sideIndustry: 10, ownProvinces: 4 }];
  const progress = summarizeProgress(raw, 30, 2);
  assert.deepEqual(progress, [
    { tick: 0, ownIndustry: 5, sideIndustry: 8, ownProvinces: 3 },
    { tick: 20, ownIndustry: 7, sideIndustry: 10, ownProvinces: 4 },
    { tick: 30, ownIndustry: 2, sideIndustry: null, ownProvinces: null },
  ]);
  assert.doesNotMatch(JSON.stringify(progress), /private|secret|decisionViewBytes/);
});

test('finished Grok and Hermes seats become sanitized, comparable harness rows', () => {
  const run = { match: 'match-1', mapId: CURRENT_MAP_ID, startedAt: '2026-09-29T00:00:00Z',
    sourceRevision: 'abcdef123456', interval: 30, turnTimeoutMs: 120000, url: 'https://private' };
  const report = { match: 'match-1', status: 'finished', tick: 600, speed: 1,
    finishedAt: '2026-09-29T00:10:00Z', generatedAt: '2026-09-29T02:10:00Z', outcome: { reason: 'domination', scores: [
      { country: 'japan', result: 'win', industry: 25 }, { country: 'russia', result: 'loss', industry: 0 }] } };
  const grok = { slot: 'a', country: 'japan', client: 'grok', model: 'grok-4.7',
    ordersAccepted: 5, ordersRejected: 1, timedOut: 0, clientErrors: 1, privateChat: 'secret' };
  // The second turn was killed at its deadline and reported no usage: the rest still counts, marked partial.
  const turns = [{ durationMs: 20000, tokens: { input: 100, cached: 40, output: 20 },
    position: { tick: 0, ownIndustry: 8, sideIndustry: 8, ownProvinces: 4, privateChat: 'secret' } },
    { durationMs: 120000, tokens: null }];
  const calls = [{ ok: true, acceptedTick: 5, at: '2026-09-29T00:00:05Z', args: { text: 'secret' } }, { ok: false }];
  const row = summarizePlaytestSeat(run, report, grok, turns, calls);
  assert.equal(row.harness, 'Grok CLI');
  assert.equal(row.arena, 'shared room');
  assert.equal(row.combatSeed, null);
  assert.equal(row.modelGroup, 'grok');
  assert.equal(row.result, 'win');
  // Grok and Hermes report cache reads beside input; Codex inside it.
  assert.deepEqual([row.inputTokens, row.cacheReadTokens, row.totalTokens, row.uncachedTokens], [140, 40, 160, 120]);
  assert.deepEqual([row.tokenTurnsReported, row.tokenTurns], [1, 2]);
  const codex = summarizePlaytestSeat(run, report, { ...grok, client: 'codex', model: 'gpt-6-sol' }, turns, calls);
  assert.deepEqual([codex.inputTokens, codex.totalTokens, codex.uncachedTokens], [100, 120, 80]);
  assert.equal(row.failedToolCalls, 1);
  assert.equal(row.durationSeconds, 600);
  assert.equal(row.progress.at(-1).ownIndustry, 25);
  assert.doesNotMatch(JSON.stringify(row), /private|secret|https/);
  const hermes = summarizePlaytestSeat(run, report, { ...grok, slot: 'b', country: 'russia', client: 'hermes', model: 'gpt-6-luna' }, turns, calls);
  assert.equal(hermes.harness, 'Hermes');
  assert.equal(hermes.modelGroup, 'luna');
  assert.equal(hermes.result, 'loss');
  const isolated = summarizePlaytestSeat({ ...run, arena: 'seven practice bots' }, report, grok, turns, calls);
  assert.equal(isolated.arena, 'seven practice bots');
  assert.equal(isolated.combatSeed, run.match);
  assert.throws(() => summarizePlaytestSeat({ ...run, arena: 'unverified' }, report, grok, turns, calls), /Unknown playtest arena/);
  assert.throws(() => summarizePlaytestSeat(run, { ...report, status: 'running' }, grok, turns, calls), /finished room/);
  assert.throws(() => summarizePlaytestSeat({ ...run, mapId: 'old-map' }, report, grok, turns, calls), /current map/);
});

test('Codex benchmark export does not invent missing token or turn counts', () => {
  const noOrders = summarizeRun(rawForCodex(), 'qwen');
  assert.equal(noOrders.acceptedActions, 0);
  assert.equal(noOrders.rejectedActions, 0);
  assert.equal(noOrders.totalTokens, null);
  assert.equal(noOrders.firstActionSeconds, null);
  assert.equal(noOrders.meanTurnSeconds, null);
  assert.equal(noOrders.timedOutTurns, null);
  const partial = summarizeRun({ runId: 'partial', startedAt: '2026-09-28T00:00:00Z', match: 'abcd1234',
    mapId: CURRENT_MAP_ID,
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
  assert.throws(() => summarizeRun({ status: 'running' }, 'qwen'), /finished result/);
  assert.throws(() => summarizeRun({ ...rawForCodex(), score: { prestige: 27 } }, 'qwen'), /finished result/);
});

function rawForCodex() { return { runId: 'codex-mode', startedAt: '2026-09-28T00:00:00Z',
  match: 'abcd1234', mapId: CURRENT_MAP_ID, country: 'britain', status: 'finished', score, client: 'codex', access: 'cli', events: [], httpActions: [] }; }
