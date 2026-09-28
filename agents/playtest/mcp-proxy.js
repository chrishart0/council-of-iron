#!/usr/bin/env node
/** Logging stdio proxy in front of agents/mcp.js for one playtest seat.
 * - Appends every tools/call (tool, arguments, ok/error, acceptedTick) to $COUNCIL_PLAYTEST_DIR/mcp.jsonl,
 *   so metrics are identical for every CLI client.
 * - Hides room-setup tools (a seated agent must not create or join another room with its session).
 * - The first news/decision_view call without `after` starts from the harness's cursor (cursor.json),
 *   so a fresh per-turn process does not replay the whole match.
 * Game rules, validation and credentials stay in agents/mcp.js and the server. */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { HIDDEN_TOOLS } from './lib.js';

const dir = process.env.COUNCIL_PLAYTEST_DIR;
if (!dir) { console.error('COUNCIL_PLAYTEST_DIR is required.'); process.exit(2); }
const logFile = resolve(dir, 'mcp.jsonl');
const log = entry => { try { appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry })}\n`, { mode: 0o600 }); } catch (error) { console.error(error.message); } };
const cursorAfter = () => { try { const c = JSON.parse(readFileSync(resolve(dir, 'cursor.json'), 'utf8')); return Number.isSafeInteger(c.after) ? c.after : null; } catch { return null; } };

const server = spawn(process.execPath, [fileURLToPath(new URL('../mcp.js', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
const pending = new Map(), listIds = new Set(), injected = new Set();
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  let message; try { message = JSON.parse(line); } catch { server.stdin.write(`${line}\n`); return; }
  if (message?.method === 'tools/list' && message.id !== undefined) listIds.add(message.id);
  if (message?.method === 'tools/call' && message.id !== undefined) {
    const tool = message.params?.name, args = message.params?.arguments || {};
    if (HIDDEN_TOOLS.has(tool)) {
      log({ tool, args, ok: false, error: 'Room setup is not available to a seated playtest agent.' });
      reply(message.id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Room setup is not available here; you are already seated.' }) }] });
      return;
    }
    if ((tool === 'news' || tool === 'decision_view') && args.after === undefined && !injected.has(tool)) {
      injected.add(tool);
      const after = cursorAfter();
      if (after !== null) message.params.arguments = { ...args, after };
    }
    pending.set(message.id, { tool, args, started: Date.now() });
    line = JSON.stringify(message);
  }
  server.stdin.write(`${line}\n`);
}).on('close', () => server.stdin.end());

createInterface({ input: server.stdout, crlfDelay: Infinity }).on('line', line => {
  let message; try { message = JSON.parse(line); } catch { process.stdout.write(`${line}\n`); return; }
  if (listIds.has(message.id) && Array.isArray(message.result?.tools)) {
    listIds.delete(message.id);
    message.result.tools = message.result.tools.filter(t => !HIDDEN_TOOLS.has(t.name));
    line = JSON.stringify(message);
  }
  const call = pending.get(message.id);
  if (call) {
    pending.delete(message.id);
    let body = null;
    try { body = JSON.parse(message.result?.content?.find(c => c.type === 'text')?.text ?? 'null'); } catch { /* non-JSON text */ }
    const ok = !message.error && !message.result?.isError;
    const { text: _text, ...args } = call.args;
    log({ tool: call.tool, args: call.tool === 'send_message' ? { ...args, chars: String(call.args.text || '').length } : call.args,
      ok, ms: Date.now() - call.started,
      ...(ok ? { acceptedTick: body?.acceptedTick, tick: body?.tick } : { error: message.error?.message || body?.error || 'error', hint: body?.hint ? true : undefined }) });
  }
  process.stdout.write(`${line}\n`);
});
server.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.kill(signal); process.exit(0); });
