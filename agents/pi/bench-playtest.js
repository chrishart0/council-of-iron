#!/usr/bin/env node
/** Import finished Grok CLI, Hermes and Codex CLI seats without publishing private playtest logs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_MAP_ID, summarizeProgress } from './bench.js';

const output = fileURLToPath(new URL('./benchmarks.json', import.meta.url));
const finite = value => Number.isFinite(value) ? value : null;
const round = value => finite(value) === null ? null : Math.round(value * 100) / 100;
const family = model => {
  const name = String(model).toLowerCase();
  for (const label of ['grok', 'qwen', 'deepseek', 'luna', 'sonnet', 'opus', 'sol']) if (name.includes(label)) return label;
  return 'external';
};
const harnessName = { grok: 'Grok CLI', hermes: 'Hermes', codex: 'Codex CLI' };

export function summarizePlaytestSeat(run, report, seat, turns = [], calls = []) {
  if (run.mapId !== CURRENT_MAP_ID || report.status !== 'finished' ||
      report.match !== run.match || !report.outcome || !Number.isSafeInteger(report.tick))
    throw new Error('Playtest needs a finished room on the current map with an authoritative outcome.');
  const score = report.outcome.scores?.find(item => item.country === seat.country);
  if (!score || !['win', 'loss', 'draw'].includes(score.result) || !Number.isFinite(score.industry))
    throw new Error(`No final score for ${seat.country}.`);
  if (score.industry === 0 && score.result !== 'loss') throw new Error('An eliminated seat cannot win.');
  if (!harnessName[seat.client] || !seat.slot || !seat.model || !run.startedAt)
    throw new Error('Expected a Grok, Hermes or Codex CLI seat with a model and run start.');
  if (run.arena && !['shared room', 'seven practice bots'].includes(run.arena))
    throw new Error('Unknown playtest arena.');
  if (!Number.isSafeInteger(seat.ordersAccepted) || !Number.isSafeInteger(seat.ordersRejected) ||
      !Number.isSafeInteger(seat.timedOut)) throw new Error('Playtest seat is missing order or timeout counts.');
  const usage = key => turns.length && turns.every(turn => Number.isFinite(turn.tokens?.[key]))
    ? turns.reduce((sum, turn) => sum + turn.tokens[key], 0) : null;
  const inputTokens = usage('input'), outputTokens = usage('output'), cacheReadTokens = usage('cached');
  const totalTokens = inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens;
  const failedToolCalls = calls.filter(call => call.ok === false).length;
  const acceptedActions = seat.ordersAccepted, rejectedActions = seat.ordersRejected;
  const firstOrder = calls.find(call => call.ok && Number.isFinite(call.acceptedTick));
  const durations = turns.map(turn => turn.durationMs).filter(Number.isFinite);
  const modelId = String(seat.model);
  return {
    id: `${run.match}:${seat.slot}`, match: run.match, mapId: run.mapId, combatSeed: null,
    startedAt: run.startedAt, modelGroup: family(modelId), modelId,
    client: harnessName[seat.client], access: 'MCP', harness: harnessName[seat.client],
    arena: run.arena || 'shared room', sourceRevision: run.sourceRevision || null, country: seat.country,
    interfaceVersion: 'playtest-episodic', turnView: 'decision', strategy: 'decision view in prompt',
    maxTurnSeconds: round(run.turnTimeoutMs / 1000), decisionIntervalTicks: finite(run.interval),
    sessionMode: 'fresh', preset: report.speed === 1 ? 'standard' : report.speed === 6 ? 'quick' : 'unknown',
    status: 'finished', resultReason: report.outcome.reason || null, finalTick: report.tick,
    result: score.result, won: score.result === 'win', industry: score.industry,
    acceptedActions, rejectedActions, toolCalls: calls.length, failedToolCalls,
    clientErrors: seat.clientErrors,
    firstActionSeconds: firstOrder?.at ? round((Date.parse(firstOrder.at) - Date.parse(run.startedAt)) / 1000) : null,
    failureRatePct: calls.length ? round(100 * failedToolCalls / calls.length) : null,
    inputTokens, outputTokens, cacheReadTokens, totalTokens,
    uncachedTokens: totalTokens === null ? null : inputTokens - (cacheReadTokens || 0) + outputTokens,
    tokensPerAction: totalTokens !== null && acceptedActions ? round(totalTokens / acceptedActions) : null,
    turns: turns.length, timedOutTurns: seat.timedOut,
    meanTurnSeconds: durations.length === turns.length && turns.length
      ? round(durations.reduce((sum, value) => sum + value, 0) / turns.length / 1000) : null,
    durationSeconds: report.finishedAt ? round((Date.parse(report.finishedAt) - Date.parse(run.startedAt)) / 1000) : null,
    progress: summarizeProgress(turns.map(turn => turn.position).filter(Boolean), report.tick, score.industry),
  };
}

const readJsonl = path => {
  let contents;
  try { contents = readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return contents.split('\n').filter(Boolean).map(line => JSON.parse(line));
};
export function importPlaytest(directory) {
  const run = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
  const report = JSON.parse(readFileSync(resolve(directory, 'report.json'), 'utf8'));
  const rows = report.seats.filter(seat => harnessName[seat.client]).map(seat => summarizePlaytestSeat(run, report, seat,
    readJsonl(resolve(directory, seat.slot, 'turns.jsonl')),
    readJsonl(resolve(directory, seat.slot, 'mcp.jsonl'))));
  if (!rows.length) throw new Error('No Grok CLI, Hermes or Codex CLI seats to import.');
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directories = process.argv.slice(2);
  if (!directories.length) { console.error('Usage: node agents/pi/bench-playtest.js data/playtest/<finished-room> [...]'); process.exit(2); }
  const ledger = JSON.parse(readFileSync(output, 'utf8'));
  if (ledger.schemaVersion !== 4 || ledger.mapId !== CURRENT_MAP_ID || !Array.isArray(ledger.runs))
    throw new Error('Benchmark ledger must use schema 4 and the current map.');
  const entries = new Map(ledger.runs.map(row => [row.id, row]));
  for (const directory of directories) for (const row of importPlaytest(directory)) entries.set(row.id, row);
  ledger.runs = [...entries.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Published ${ledger.runs.length} aggregate runs to ${output}`);
}
