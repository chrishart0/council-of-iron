#!/usr/bin/env node
/** Publish only aggregate, non-secret game metrics from ignored raw run files. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./benchmarks.json', import.meta.url));
const number = value => Number.isFinite(value) ? value : null;
const round = value => number(value) === null ? null : Math.round(value * 100) / 100;
const finiteSum = (items, key) => items.every(item => number(item[key]) !== null)
  ? items.reduce((sum, item) => sum + item[key], 0) : null;

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

export function summarizeRun(raw, modelGroup) {
  if (!['qwen', 'luna', 'external'].includes(modelGroup)) throw new Error('Specify a qwen, luna, or external model group.');
  if (!raw.runId || !raw.startedAt || !raw.match || raw.status !== 'finished' ||
      !['win', 'loss', 'draw'].includes(raw.score?.result) || !Number.isFinite(raw.score.industry))
    throw new Error(`Run ${raw.runId || '(unknown)'} has no authoritative finished result.`);
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
  // Resumed Codex turns report cumulative thread usage, so use the last completed snapshot.
  const lastTurn = turns.at(-1);
  const tokenUsage = raw.usageIncomplete ? null : client === 'Codex' && lastTurn
    ? { input: lastTurn.inputTokens, output: lastTurn.outputTokens,
      cacheRead: lastTurn.cacheReadTokens } : raw.usage;
  const inputTokens = number(tokenUsage?.input);
  const outputTokens = number(tokenUsage?.output);
  const cacheReadTokens = number(tokenUsage?.cacheRead);
  const totalTokens = number(tokenUsage?.total) ?? (inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens);
  const totalTurnMs = turns.length && !raw.usageIncomplete ? finiteSum(turns, 'wallMs') : null;
  const durationSeconds = raw.finishedAt ? (Date.parse(raw.finishedAt) - Date.parse(raw.startedAt)) / 1000 : null;
  const won = typeof raw.score.side === 'string' && raw.outcome &&
    (raw.outcome.draw === true || typeof raw.outcome.winningSide === 'string')
    ? !raw.outcome.draw && raw.score.side === raw.outcome.winningSide : null;
  return {
    id: raw.runId, match: raw.match, combatSeed: raw.combatSeed || null,
    startedAt: raw.startedAt, modelGroup, client, access, country: raw.country,
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
    finalTick: number(raw.finalTick), result: raw.score.result, industry: raw.score.industry,
    acceptedActions, rejectedActions, toolCalls: calls.length, failedToolCalls: failed,
    firstActionSeconds: firstAcceptedAt ? round((Date.parse(firstAcceptedAt) - Date.parse(raw.startedAt)) / 1000) : null,
    failureRatePct: calls.length ? round(100 * failed / calls.length) : null,
    inputTokens, outputTokens, cacheReadTokens, totalTokens,
    uncachedTokens: inputTokens === null || outputTokens === null ? null
      : Math.max(0, inputTokens - (client === 'Codex' ? cacheReadTokens || 0 : 0)) + outputTokens,
    tokensPerAction: totalTokens !== null && acceptedActions ? round(totalTokens / acceptedActions) : null,
    turns: turns.length || null,
    timedOutTurns,
    meanTurnSeconds: totalTurnMs !== null ? round(totalTurnMs / turns.length / 1000) : null,
    durationSeconds: round(durationSeconds),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , group, ...paths] = process.argv;
  if (!['qwen', 'luna', 'external'].includes(group) || paths.length === 0) {
    console.error('Usage: node agents/pi/bench.js <qwen|luna|external> data/pi/<run>.json [...]');
    process.exit(2);
  }
  const previous = JSON.parse(readFileSync(output, 'utf8'));
  const entries = new Map(previous.runs.map(run => [run.id, run]));
  for (const path of paths) {
    const run = summarizeRun(JSON.parse(readFileSync(path, 'utf8')), group);
    if (entries.has(run.id) && entries.get(run.id).modelGroup !== group) throw new Error(`Run ${run.id} already belongs to another group.`);
    entries.set(run.id, run);
  }
  previous.runs = [...entries.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  writeFileSync(output, `${JSON.stringify(previous, null, 2)}\n`);
  console.log(`Published ${previous.runs.length} aggregate runs to ${output}`);
}
