#!/usr/bin/env node
/** Publish allowlisted metrics from ignored, fixed-board client trials. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexToolFailure, tokenFields } from './bench.js';
import { FIXED_TASK_ID } from './fixed-task.js';

const output = fileURLToPath(new URL('./task-benchmarks.json', import.meta.url));
const finite = value => Number.isFinite(value) ? value : null;
const round = value => finite(value) === null ? null : Math.round(value * 100) / 100;

export function summarizeTaskRun(raw, modelGroup) {
  if (!['qwen', 'luna'].includes(modelGroup)) throw new Error('Specify qwen or luna.');
  if (raw.taskId !== FIXED_TASK_ID || !raw.runId || !raw.startedAt || !raw.finishedAt || !raw.taskResult)
    throw new Error('A completed fixed task result is required.');
  const client = raw.client === 'codex' ? 'Codex' : 'Pi';
  const completed = (raw.events || []).filter(event => event.type === 'item.completed' &&
    ['mcp_tool_call', 'command_execution'].includes(event.itemType));
  const usedCouncilMcp = completed.some(event => event.itemType === 'mcp_tool_call' &&
    ['board', 'news', 'preview', 'march', 'declare_war', 'observe', 'map'].some(name =>
      event.name === name || event.name?.endsWith(`__${name}`)));
  const usedShell = completed.some(event => event.itemType === 'command_execution');
  const calls = client === 'Pi' ? raw.toolCalls || [] : completed;
  const failed = client === 'Pi' ? calls.filter(call => call.ok === false).length : calls.filter(codexToolFailure).length;
  const accepted = client === 'Pi' ? (raw.actions || []).filter(action => action.ok && action.at)
    : (raw.httpActions || []).filter(action => action.status === 200 && action.at);
  const rejected = client === 'Pi' ? (raw.actions || []).filter(action => action.ok === false).length
    : (raw.httpActions || []).filter(action => action.status !== 200).length;
  // Same token definition as the match ledger: Pi reports cache reads beside input, Codex inside it.
  const usage = raw.usage || {};
  const tokens = tokenFields({ input: client === 'Pi' && finite(usage.input) !== null
    ? usage.input + (finite(usage.cacheRead) || 0) + (finite(usage.cacheWrite) || 0) : usage.input,
  cacheRead: usage.cacheRead, output: usage.output }, accepted.length);
  return {
    id: raw.runId, taskId: FIXED_TASK_ID, startedAt: raw.startedAt, modelGroup, client,
    access: client === 'Pi' ? 'MCP' : raw.access === 'mcp' && !usedCouncilMcp && usedShell ? 'shell fallback' : raw.access,
    success: raw.taskResult.success === true,
    correctSteps: finite(raw.taskResult.correctSteps), requiredSteps: finite(raw.taskResult.requiredSteps),
    acceptedOrders: finite(raw.taskResult.acceptedOrders), rejectedOrders: rejected,
    toolCalls: calls.length, failedToolCalls: failed,
    firstActionSeconds: accepted.length ? round((Date.parse(accepted[0].at) - Date.parse(raw.startedAt)) / 1000) : null,
    completionSeconds: raw.taskResult.success && accepted.length >= 3
      ? round((Date.parse(accepted[2].at) - Date.parse(raw.startedAt)) / 1000) : null,
    durationSeconds: round((Date.parse(raw.finishedAt) - Date.parse(raw.startedAt)) / 1000),
    ...tokens,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , group, ...paths] = process.argv;
  if (!['qwen', 'luna'].includes(group) || !paths.length) {
    console.error('Usage: node agents/pi/task-bench.js <qwen|luna> data/pi/<completed-task>.json [...]');
    process.exit(2);
  }
  const ledger = JSON.parse(readFileSync(output, 'utf8'));
  const entries = new Map(ledger.runs.map(run => [run.id, run]));
  for (const path of paths) {
    const run = summarizeTaskRun(JSON.parse(readFileSync(path, 'utf8')), group);
    if (entries.has(run.id) && entries.get(run.id).modelGroup !== group) throw new Error(`Run ${run.id} already belongs to another group.`);
    entries.set(run.id, run);
  }
  ledger.runs = [...entries.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Published ${ledger.runs.length} fixed-board runs to ${output}`);
}
