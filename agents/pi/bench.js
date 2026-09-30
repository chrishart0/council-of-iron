#!/usr/bin/env node
/** Publish only aggregate, non-secret game metrics from ignored raw run files. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./benchmarks.json', import.meta.url));
/** Every ledger row names the map it was played on; the report compares one map at a time. */
export const recordsMap = mapId => /^imperial-[0-9a-z-]+$/.test(mapId || '');
const number = value => Number.isFinite(value) ? value : null;
const round = value => number(value) === null ? null : Math.round(value * 100) / 100;
const finiteSum = (items, key) => items.every(item => number(item[key]) !== null)
  ? items.reduce((sum, item) => sum + item[key], 0) : null;

/** One token definition for every harness. `input` counts every prompt token, cache reads included (Pi, Grok and
 * Hermes report cache reads beside a non-cached input, Codex inside it; callers normalise before calling).
 * `turnsReported` of `turns` model turns reported usage: a turn killed at its deadline reports none, so the sums
 * are then a lower bound, and the ledger says so instead of dropping the whole run's usage. */
export function tokenFields({ input = null, cacheRead = null, output = null, turnsReported = null, turns = null }, acceptedActions = 0) {
  const inputTokens = number(input), outputTokens = number(output), cacheReadTokens = number(cacheRead);
  const totalTokens = inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens;
  return {
    inputTokens, outputTokens, cacheReadTokens, totalTokens,
    uncachedTokens: totalTokens === null ? null : Math.max(0, inputTokens - (cacheReadTokens || 0)) + outputTokens,
    tokensPerAction: totalTokens !== null && acceptedActions ? round(totalTokens / acceptedActions) : null,
    tokenTurnsReported: totalTokens === null ? null : number(turnsReported), tokenTurns: totalTokens === null ? null : number(turns),
  };
}

/** Publish only numeric, public-position facts; raw turn views and conversations stay private. */
export function summarizeProgress(positions = [], finalTick = null, finalIndustry = null) {
  const byTick = new Map();
  for (const position of positions) {
    if (!Number.isSafeInteger(position.tick) || position.tick < 0 ||
        !Number.isFinite(position.ownIndustry) || position.ownIndustry < 0) continue;
    byTick.set(position.tick, {
      tick: position.tick, ownIndustry: position.ownIndustry,
      sideIndustry: number(position.sideIndustry), ownProvinces: number(position.ownProvinces),
    });
  }
  if (Number.isSafeInteger(finalTick) && finalTick >= 0 && Number.isFinite(finalIndustry)) {
    const previous = byTick.get(finalTick);
    byTick.set(finalTick, { tick: finalTick, ownIndustry: finalIndustry,
      sideIndustry: previous?.sideIndustry ?? null, ownProvinces: previous?.ownProvinces ?? null });
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

export function codexToolFailure(event) {
  if (event.exitCode !== undefined && event.exitCode !== null) return event.exitCode !== 0;
  if (event.result?.isError) return true;
  const content = event.result?.content;
  if (!Array.isArray(content)) return false;
  return content.some(part => {
    if (part.type !== 'text' || typeof part.text !== 'string') return false;
    try { const payload = JSON.parse(part.text); return !!payload.error || payload.ok === false; }
    catch { return false; }
  });
}

export function summarizeRun(raw, modelGroup, { revision = raw.sourceRevision } = {}) {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(modelGroup)) throw new Error('Specify a lowercase model group.');
  if (revision && !/^[0-9a-f]{7,40}$/.test(revision)) throw new Error('Revision must be a Git commit hash.');
  if (!raw.runId || !raw.startedAt || !raw.match || raw.status !== 'finished' ||
      !['win', 'loss', 'draw'].includes(raw.score?.result) || !Number.isFinite(raw.score.industry))
    throw new Error(`Run ${raw.runId || '(unknown)'} has no authoritative finished result.`);
  // Every row keeps its map: the report shows one map at a time, since games on different maps are not comparable.
  if (!recordsMap(raw.mapId))
    throw new Error(`Run ${raw.runId} does not record its map.`);
  if (raw.score.industry === 0 && raw.score.result !== 'loss')
    throw new Error(`Run ${raw.runId} has a result from rules that credited a country with no industry.`);
  const client = raw.client === 'codex' ? 'Codex' : 'Pi';
  const commands = client === 'Codex' ? (raw.events || []).filter(event =>
    event.itemType === 'command_execution' && typeof event.command === 'string').map(event => event.command) : [];
  const usedDirectHttp = commands.some(command => /\/api\/games\/[^\s'"?]+\/actions\b/.test(command));
  const usedCli = commands.some(command => command.includes('/game/agents/cli.js'));
  const access = client !== 'Codex' ? 'MCP' : raw.access === 'cli' && usedDirectHttp
    ? usedCli ? 'CLI + direct HTTP' : 'shell HTTP' : raw.access;
  const completed = (raw.events || []).filter(event => event.type === 'item.completed' &&
    ['mcp_tool_call', 'command_execution'].includes(event.itemType));
  const calls = client === 'Pi' ? raw.toolCalls || [] : completed;
  const failed = client === 'Pi' ? calls.filter(call => call.ok === false).length : calls.filter(codexToolFailure).length;
  const acceptedActions = client === 'Pi' ? raw.actions.filter(action => action.ok).length
    : raw.httpActions.filter(action => action.status === 200).length;
  const rejectedActions = client === 'Pi' ? raw.actions.filter(action => action.ok === false).length
    : raw.httpActions.filter(action => action.status !== 200).length;
  const firstAcceptedAt = client === 'Pi' ? raw.actions.find(action => action.ok && action.at)?.at
    : raw.httpActions.find(action => action.status === 200)?.at;
  const turns = raw.turnLog || [];
  const timedOutTurns = client === 'Pi' ? turns.filter(turn => turn.timedOut).length : number(raw.timedOutTurns);
  const usedNews = client === 'Pi' ? calls.some(call => call.name === 'news')
    : completed.some(event => event.name === 'news' || event.name?.endsWith('__news'));
  const usedBoard = client === 'Pi' ? calls.some(call => call.name === 'board')
    : completed.some(event => event.name === 'board' || event.name?.endsWith('__board'));
  const usedView = client === 'Pi' ? calls.some(call => call.name === 'view_map')
    : completed.some(event => event.name === 'view_map' || event.name?.endsWith('__view_map'));
  // Resumed Codex turns report cumulative thread usage, so use the last completed snapshot. Codex input already
  // includes cached input; Pi reports cache reads and writes beside it.
  const lastTurn = turns.at(-1);
  const tokenUsage = raw.usageIncomplete ? null : client === 'Codex' && lastTurn
    ? { input: lastTurn.inputTokens, output: lastTurn.outputTokens,
      cacheRead: lastTurn.cacheReadTokens } : raw.usage;
  const tokens = tokenFields({
    input: client === 'Pi' && number(tokenUsage?.input) !== null
      ? tokenUsage.input + (number(tokenUsage.cacheRead) || 0) + (number(tokenUsage.cacheWrite) || 0) : tokenUsage?.input,
    cacheRead: tokenUsage?.cacheRead, output: tokenUsage?.output, turns: turns.length || null,
    turnsReported: client === 'Pi'
      ? turns.filter(turn => (turn.inputTokens || 0) + (turn.outputTokens || 0) + (turn.cacheReadTokens || 0) > 0).length
      : turns.length || null,
  }, acceptedActions);
  const totalTurnMs = turns.length && !raw.usageIncomplete ? finiteSum(turns, 'wallMs') : null;
  const durationSeconds = raw.finishedAt ? (Date.parse(raw.finishedAt) - Date.parse(raw.startedAt)) / 1000 : null;
  const won = raw.score.result === 'win';
  return {
    id: raw.runId, match: raw.match, mapId: raw.mapId, combatSeed: raw.combatSeed || null,
    startedAt: raw.startedAt, modelGroup, modelId: String(raw.modelId || raw.model || modelGroup), client, access,
    harness: client, arena: raw.live ? 'shared room' : 'seven practice bots', sourceRevision: revision || null,
    country: raw.country,
    interfaceVersion: raw.interfaceVersion, turnView: raw.turnView || null,
    strategy: raw.embeddedBoard ? usedView ? `${raw.turnView === 'decision' ? 'decision view' : 'board'} prompt + visual`
      : raw.turnView === 'decision' ? 'decision view in prompt' : 'board in prompt'
      : raw.turnView === 'tools' ? 'tool-led turns'
      : usedView ? 'visual map' : usedBoard ? usedNews ? 'compact board + news' : 'compact board'
      : usedNews ? 'news' : raw.maxTurnSeconds ? 'full observation, capped' : 'full observation',
    maxTurnSeconds: number(raw.maxTurnSeconds),
    decisionIntervalTicks: number(raw.decisionIntervalTicks),
    sessionMode: raw.sessionMode || raw.turnMode,
    preset: raw.preset, status: raw.status, resultReason: raw.outcome?.reason || null,
    finalTick: number(raw.finalTick), result: raw.score.result, won, industry: raw.score.industry,
    acceptedActions, rejectedActions, toolCalls: calls.length, failedToolCalls: failed,
    firstActionSeconds: firstAcceptedAt ? round((Date.parse(firstAcceptedAt) - Date.parse(raw.startedAt)) / 1000) : null,
    failureRatePct: calls.length ? round(100 * failed / calls.length) : null,
    ...tokens,
    turns: turns.length || null,
    timedOutTurns,
    meanTurnSeconds: totalTurnMs !== null ? round(totalTurnMs / turns.length / 1000) : null,
    durationSeconds: round(durationSeconds),
    progress: summarizeProgress(raw.positionLog, raw.finalTick, raw.score.industry),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , group, ...args] = process.argv;
  const revisionIndex = args.indexOf('--revision');
  const revision = revisionIndex >= 0 ? args.splice(revisionIndex, 2)[1] : undefined;
  const paths = args;
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(group || '') || paths.length === 0 || revisionIndex >= 0 && !revision) {
    console.error('Usage: node agents/pi/bench.js <model-group> [--revision GIT_HASH] data/pi/<run>.json [...]');
    process.exit(2);
  }
  const previous = JSON.parse(readFileSync(output, 'utf8'));
  if (previous.schemaVersion !== 5 || !Array.isArray(previous.runs))
    throw new Error('Benchmark ledger must use schema 5.');
  const entries = new Map(previous.runs.map(run => [run.id, run]));
  for (const path of paths) {
    const run = summarizeRun(JSON.parse(readFileSync(path, 'utf8')), group, { revision });
    if (entries.has(run.id) && entries.get(run.id).modelGroup !== group) throw new Error(`Run ${run.id} already belongs to another group.`);
    entries.set(run.id, run);
  }
  previous.runs = [...entries.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  writeFileSync(output, `${JSON.stringify(previous, null, 2)}\n`);
  console.log(`Published ${previous.runs.length} aggregate runs to ${output}`);
}
