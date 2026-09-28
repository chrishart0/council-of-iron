#!/usr/bin/env node
/** Multi-agent playtest harness: episodic, fresh-context CLI turns for several seats of one Council match.
 * See agents/playtest/README.md. Dev tooling only; the game itself keeps zero runtime dependencies. */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync,
  statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import tls from 'node:tls';
import { CouncilClient } from '../client.js';
import { decisionView } from '../decision-view.js';
import { backoffMs, buildPrompt, decisionKey, extractMemory, formatTable, grokConfig, hermesEnabledServers, hermesProfile, inboxDelivery, inboxItems, inboxUrgent,
  nextTurn, parseClientOutput, parseSeat, seatReport, setupCommands, shellQuote, stopReason, summarizeCalls,
  tomlServerNames, turnCommand, turnRules, validateSeats } from './lib.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const PROXY = resolve(here, 'mcp-proxy.js'), FAKE = resolve(here, 'fake-agent.js');

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const command = ['run', 'status', 'report'].includes(argv[0]) ? argv.shift() : 'run';
const flags = new Set(['--join', '--wait-start', '--dry-run', '--watch', '--systemd']);
const opts = { seat: [] };
for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
  const name = key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (flags.has(key)) { opts[name] = true; continue; }
  const value = argv[++i];
  if (value === undefined) throw new Error(`${key} needs a value`);
  if (name === 'seat') opts.seat.push(value); else opts[name] = value;
}
const num = (value, fallback, min, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Value ${value} is out of range ${min}–${max}.`);
  return n;
};
const match = opts.match;
if (!match || !/^[\w-]{1,64}$/.test(match)) throw new Error('Give --match ROOM_ID.');
const dataRoot = resolve(opts.data || resolve(root, 'data/playtest'));
const runDir = resolve(dataRoot, match);
const seatDir = slot => resolve(runDir, slot);
const readJsonl = file => { try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writePrivate = (file, text) => writeFileSync(file, text, { mode: 0o600 });

if (command === 'status') await statusCommand();
else if (command === 'report') printReport(buildReport());
else await runCommand();

// ------------------------------------------------------------------ status / report
function statusRows() {
  const status = readJson(resolve(runDir, 'status.json'));
  if (!status) throw new Error(`No playtest recorded for ${match} under ${dataRoot}.`);
  return { status, rows: status.seats.map(s => {
    const turns = readJsonl(resolve(seatDir(s.slot), 'turns.jsonl')), calls = readJsonl(resolve(seatDir(s.slot), 'mcp.jsonl'));
    const sum = summarizeCalls(calls), last = turns.at(-1);
    return { ...s, turnsDone: turns.length, accepted: sum.accepted, rejected: sum.rejected.length, msgs: sum.messagesSent,
      last: last ? `${last.trigger} t${last.tickStart}→${last.tickEnd} ${(last.durationMs / 1000).toFixed(0)}s${last.timedOut ? ' TIMEOUT' : ''}${last.failed ? ' FAILED' : ''}` : '',
      lastError: sum.rejected.at(-1)?.error?.slice(0, 60) || last?.clientErrors?.at(-1)?.slice(0, 60) || '' };
  }) };
}
async function statusCommand() {
  for (;;) {
    const { status, rows } = statusRows();
    if (opts.watch) process.stdout.write('\x1b[2J\x1b[H');
    console.log(`match ${match} · ${status.status} · tick ${status.tick} · updated ${status.updatedAt}${status.stopReason ? ` · stopped: ${status.stopReason}` : ''}`);
    console.log(formatTable(rows, [['slot', r => r.slot], ['country', r => r.country], ['client', r => `${r.client}/${r.model}/${r.effort}`],
      ['state', r => r.eliminated ? 'eliminated' : r.running ? `turn ${r.turns} running` : 'waiting'], ['turns', r => r.turnsDone],
      ['ok', r => r.accepted], ['rej', r => r.rejected], ['msgs', r => r.msgs], ['inbox', r => r.inbox], ['last turn', r => r.last], ['last error', r => r.lastError]]));
    if (!opts.watch || status.stopReason) return;
    await sleep(5000);
  }
}
function buildReport() {
  const status = readJson(resolve(runDir, 'status.json'));
  if (!status) throw new Error(`No playtest recorded for ${match} under ${dataRoot}.`);
  const startTick = status.startTick ?? 0;
  return { match, status: status.status, tick: status.tick, stopReason: status.stopReason ?? null, outcome: status.outcome ?? null,
    generatedAt: new Date().toISOString(),
    seats: status.seats.map(s => seatReport(s, { turns: readJsonl(resolve(seatDir(s.slot), 'turns.jsonl')),
      calls: readJsonl(resolve(seatDir(s.slot), 'mcp.jsonl')), messages: readJsonl(resolve(seatDir(s.slot), 'messages.jsonl')),
      startTick, endTick: status.tick })) };
}
function printReport(report) {
  console.log(`match ${report.match} · ${report.status} · tick ${report.tick}${report.stopReason ? ` · ${report.stopReason}` : ''}`);
  console.log(formatTable(report.seats, [['slot', r => r.slot], ['country', r => r.country], ['client', r => `${r.client}/${r.model}/${r.effort}`],
    ['turns', r => `${r.turns} (${Object.entries(r.triggers).map(([k, v]) => `${k}:${v}`).join(' ')})`], ['t/o', r => r.timedOut], ['fail', r => r.failed],
    ['med s', r => r.medianTurnSeconds?.toFixed(0)], ['ok', r => r.ordersAccepted], ['rej', r => r.ordersRejected], ['1st order', r => r.firstOrderTick],
    ['msgs', r => r.messagesSent], ['ally msgs', r => r.allyMessages], ['replies', r => r.allyReplies], ['med reply', r => r.medianReplyTicks],
    ['max idle', r => r.longestIdleTicks], ['tok in/out', r => `${r.tokens.input}/${r.tokens.output}`]]));
  for (const seat of report.seats) if (Object.keys(seat.rejectedByReason).length) {
    console.log(`\n${seat.slot} rejections:`);
    for (const [why, n] of Object.entries(seat.rejectedByReason).sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${why}`);
  }
}

// ------------------------------------------------------------------ run
async function runCommand() {
  if (!opts.url) throw new Error('Give --url https://HOST:PORT');
  const seats = validateSeats(opts.seat.map(parseSeat));
  const interval = num(opts.interval, 30, 1, 1800), turnTimeoutMs = num(opts.turnTimeout, 120, 10, 3600) * 1000;
  const minGapMs = num(opts.minGap, 10, 0, 600) * 1000, pollMs = num(opts.pollMs, 2000, 50, 60000);
  const maxMinutes = num(opts.maxMinutes, 0, 0, 24 * 60), maxTurns = num(opts.maxTurns, 0, 0, 10000);
  const ca = opts.ca ? resolve(opts.ca) : null;
  if (ca && !existsSync(ca)) throw new Error(`CA file ${ca} not found.`);

  if (opts.systemd) {
    const inner = process.argv.slice(1).filter(a => a !== '--systemd');
    const unit = ['systemd-run', '--user', `--unit=council-playtest-${match}`, '--collect', `--working-directory=${process.cwd()}`,
      `--setenv=PATH=${process.env.PATH}`, `--setenv=HOME=${homedir()}`, process.execPath, ...inner];
    console.log(shellQuote(unit));
    if (opts.dryRun) return;
    const result = spawnSync(unit[0], unit.slice(1), { stdio: 'inherit' });
    console.log(`Follow: journalctl --user -fu council-playtest-${match}   Status: node agents/playtest/run.js status --match ${match} --watch   Stop: systemctl --user stop council-playtest-${match}`);
    process.exit(result.status ?? 1);
  }

  const seatState = seats.map(seat => {
    const dir = seatDir(seat.slot);
    const mcp = { command: process.execPath, args: [PROXY], env: { COUNCIL_URL: opts.url, COUNCIL_SESSION: resolve(dir, 'session.json'),
      COUNCIL_MATCH: match, COUNCIL_PLAYTEST_DIR: dir, ...(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}) } };
    return { ...seat, dir, work: resolve(dir, 'work'), mcp };
  });

  if (opts.dryRun) {
    console.log(`# Playtest ${match} at ${opts.url}; data under ${runDir} (owner-only). Interval ${interval} game s, turn cap ${turnTimeoutMs / 1000} s.`);
    for (const s of seatState) {
      console.log(`\n## ${s.slot}: ${s.country} via ${s.client} ${s.model} (${s.effort}) as "${s.name}"`);
      if (opts.join) console.log(`# join: POST ${opts.url}/api/players {name:${JSON.stringify(s.name)}} then /api/games/${match}/join {country:"${s.country}",kind:"agent",visibility:"public"} → ${s.mcp.env.COUNCIL_SESSION}`);
      if (s.client === 'grok') console.log(`# writes ${resolve(s.work, '.grok/config.toml')}:\n${grokConfig(s.mcp, grokUserServers()).replace(/^/gm, '#   ')}`);
      for (const step of setupCommands(s, { mcp: s.mcp, profileExists: hermesProfileExists(s.slot), enabledOtherServers: ['<every other enabled server>'] }))
        console.log(`${step.input ? 'echo Y | ' : ''}${shellQuote([step.command, ...step.args])}`);
      const cmd = turnCommand(s, { prompt: '<TURN PROMPT>', work: s.work, mcp: s.mcp, usageFile: resolve(s.dir, 'turns/N.usage.json'),
        hermesProvider: opts.hermesProvider, fakeScript: FAKE });
      console.log(`(cd ${shellQuote([cmd.cwd])} && ${cmd.env ? `${Object.entries(cmd.env).map(([k, v]) => shellQuote([`${k}=${v}`])).join(' ')} ` : ''}${shellQuote([cmd.command, ...cmd.args])} < /dev/null)`);
    }
    console.log(`\n# <TURN PROMPT> = these rules + MEMORY + INBOX + the seat's current decision_view:\n${turnRules({ country: '<COUNTRY>', match, interval })}`);
    return;
  }

  if (ca) tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(ca, 'utf8')]);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  chmodSync(dataRoot, 0o700); chmodSync(runDir, 0o700);
  const log = text => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);

  // Slow client setup first (a Hermes profile takes ~30 s), so the joins and first reads happen together.
  for (const s of seatState) {
    for (const d of [s.dir, s.work, resolve(s.dir, 'turns')]) { mkdirSync(d, { recursive: true, mode: 0o700 }); chmodSync(d, 0o700); }
    if (s.client === 'grok') { mkdirSync(resolve(s.work, '.grok'), { recursive: true, mode: 0o700 }); writePrivate(resolve(s.work, '.grok/config.toml'), grokConfig(s.mcp, grokUserServers())); }
    if (s.client === 'hermes') setupHermes(s, log);
  }
  for (const s of seatState) {
    s.client_ = new CouncilClient({ url: opts.url, sessionPath: s.mcp.env.COUNCIL_SESSION, token: '', match });
    const joined = s.client_.session.match === match && s.client_.session.seatToken;
    if (!joined) {
      if (!opts.join) throw new Error(`Seat ${s.slot} has no session for ${match}; add --join.`);
      await s.client_.register(s.name);
      await s.client_.join(match, s.country, s.name, `${s.client}/${s.model}/${s.effort}`, 'playtest agent', 'public');
      log(`${s.slot}: joined ${match} as ${s.country}`);
    } else if (s.client_.session.country !== s.country) throw new Error(`Seat ${s.slot}'s session plays ${s.client_.session.country}, not ${s.country}.`);
    chmodSync(s.mcp.env.COUNCIL_SESSION, 0o600);
    Object.assign(s, { cursor: 0, memory: '', turns: 0, failures: 0, inbox: [], presented: [], sinceTurn: [], lastStartTick: 0, lastEndAt: 0 },
      readJson(resolve(s.dir, 'state.json'), {}));
    s.turns = readJsonl(resolve(s.dir, 'turns.jsonl')).length;
  }
  // Reads are retried on transport errors (e.g. a stale keep-alive socket); game errors are not.
  const retry = async fn => { for (let i = 0; ; i++) { try { return await fn(); } catch (error) { if (error.status || i >= 4) throw error; await sleep(500 * (i + 1)); } } };
  const map = await retry(() => seatState[0].client_.map());
  writePrivate(resolve(runDir, 'run.json'), JSON.stringify({ match, url: opts.url, seats, interval, turnTimeoutMs, minGapMs, startedAt: new Date().toISOString() }, null, 2));

  let interrupted = false, startTick = readJson(resolve(runDir, 'status.json'))?.startTick ?? null, gameStatus = 'lobby', tick = 0, outcome = null, reason = null;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { if (interrupted) process.exit(130); interrupted = true; log(`${signal}: stopping all seats`); });
  const deadline = maxMinutes ? Date.now() + maxMinutes * 60_000 : Infinity;
  const saveSeat = s => writePrivate(resolve(s.dir, 'state.json'), JSON.stringify({ cursor: s.cursor, memory: s.memory, failures: s.failures, lastStartTick: s.lastStartTick, presented: s.presented }));
  const writeStatus = () => writePrivate(resolve(runDir, 'status.json'), JSON.stringify({ match, url: opts.url, status: gameStatus, tick, startTick,
    outcome, stopReason: reason, updatedAt: new Date().toISOString(),
    seats: seatState.map(s => ({ slot: s.slot, country: s.country, client: s.client, model: s.model, effort: s.effort, name: s.name,
      running: Boolean(s.child), turns: s.turns, inbox: s.inbox.length + (s.latest?.inbox?.unread ?? 0) + (s.latest?.inbox?.needsDecision?.length ?? 0), eliminated: Boolean(s.eliminated), memoryChars: s.memory.length })) }, null, 2));

  async function poll(s) {
    let o, events = [];
    for (let page = 0; page < 25; page++) {
      // inbox: the server's seat inbox (unread messages, offers awaiting an answer); reading it marks nothing.
      o = await s.client_.observe(s.cursor, { inbox: true });
      events.push(...o.events); s.cursor = o.cursor;
      if (!o.hasMore) break;
    }
    s.latest = o;
    const urgent = inboxUrgent(o.inbox, s.presented);
    if (urgent && !s.urgent) log(`${s.slot}: server inbox: ${o.inbox.unread} unread, ${o.inbox.needsDecision.length} awaiting an answer`);
    s.urgent = urgent;
    s.sinceTurn = [...s.sinceTurn, ...events].slice(-400);
    const items = inboxItems(events, s.country, o.players);
    if (s.child) for (const item of items) item.duringTurn = true;
    if (items.length) { s.inbox.push(...items); log(`${s.slot}: inbox +${items.length} (${items.map(i => i.kind).join(', ')})`); }
    const sideOf = new Map(o.players.map(p => [p.id, p.side]));
    for (const e of events.filter(e => e.type === 'message'))
      appendFileSync(resolve(s.dir, 'messages.jsonl'), `${JSON.stringify({ tick: e.tick, from: e.from, channel: e.channel, to: e.to ?? null,
        mine: e.from === s.country, ally: e.from !== s.country && sideOf.get(e.from) === sideOf.get(s.country) && !String(sideOf.get(s.country)).startsWith('solo:'),
        chars: String(e.text || '').length })}\n`, { mode: 0o600 });
    if (o.players.find(p => p.id === s.country)?.eliminatedAt != null && !s.eliminated) { s.eliminated = true; log(`${s.slot}: eliminated; no more turns`); }
    saveSeat(s);
    return o;
  }

  /** Deliver the server inbox for a prompt: read it page by page (each page marks what it returns read). */
  async function deliverInbox(s) {
    const pages = [];
    try {
      for (let i = 0; i < 3; i++) { const page = await s.client_.readInbox(); pages.push(page); if (!page.more) break; }
    } catch (error) {
      log(`${s.slot}: inbox read failed (${error.status ?? error.cause?.code ?? ''}): ${error.message}`);
      // Fall back to the unmarked snapshot of the last poll: newest messages, still unread on the server.
      if (!pages.length && s.latest?.inbox) pages.push({ ...s.latest.inbox, more: s.latest.inbox.older ?? 0 });
    }
    return inboxDelivery(pages, s.country, s.latest?.players);
  }

  async function startTurn(s, trigger) {
    const number = ++s.turns;
    const delivery = await deliverInbox(s), o = s.latest;
    let view = decisionView({ ...o, inbox: undefined, events: s.sinceTurn, cursor: o.cursor, hasMore: false }, map);
    const notices = s.inbox;
    let prompt = buildPrompt({ country: s.country, match, interval, memory: s.memory, delivery, notices, view, turn: number });
    if (prompt.length > 100_000) { view = { ...view, provinces: undefined, note: 'provinces omitted for size; call decision_view' };
      prompt = buildPrompt({ country: s.country, match, interval, memory: s.memory, delivery, notices, view, turn: number }); }
    const inboxSize = delivery.messages.length + delivery.needsDecision.length + notices.length;
    s.presented = delivery.needsDecision.map(decisionKey);
    s.urgent = false; s.inbox = []; s.sinceTurn = []; s.lastStartTick = o.tick;
    writePrivate(resolve(s.dir, 'cursor.json'), JSON.stringify({ after: o.cursor }));
    const mcpFile = resolve(s.dir, 'mcp.jsonl'), mcpOffset = existsSync(mcpFile) ? statSync(mcpFile).size : 0;
    const usageFile = resolve(s.dir, `turns/${number}.usage.json`);
    const cmd = turnCommand(s, { prompt, work: s.work, mcp: s.mcp, usageFile, hermesProvider: opts.hermesProvider, fakeScript: FAKE });
    const env = Object.fromEntries(Object.entries({ ...process.env, ...cmd.env }).filter(([k]) => !k.startsWith('COUNCIL_')));
    writePrivate(resolve(s.dir, `turns/${number}.prompt.txt`), prompt);
    const started = Date.now();
    log(`${s.slot}: turn ${number} (${trigger}) at tick ${o.tick}, inbox ${inboxSize}`);
    let stdout = '', stderr = '', timedOut = false, spawnError = null;
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    s.child = child;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (stdout.length < 8e6) stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    child.on('error', error => { spawnError = error.message; });
    const kill = signal => { try { process.kill(-child.pid, signal); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, turnTimeoutMs);
    s.kill = () => { kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000).unref(); };
    s.done = new Promise(done => child.on('close', async code => {
      clearTimeout(timer);
      kill('SIGTERM'); // stray MCP children of the turn
      writePrivate(resolve(s.dir, `turns/${number}.out`), `${stdout}\n----- stderr -----\n${stderr}`);
      let calls = [];
      try {
        const size = statSync(mcpFile).size, fd = openSync(mcpFile, 'r'), buffer = Buffer.alloc(size - mcpOffset);
        readSync(fd, buffer, 0, buffer.length, mcpOffset); closeSync(fd);
        calls = buffer.toString('utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
      } catch { /* no MCP call this turn */ }
      const parsed = parseClientOutput(s.client, stdout, readJson(usageFile));
      if (spawnError) parsed.clientErrors.push(`spawn: ${spawnError}`);
      const memory = extractMemory(parsed.text);
      if (memory) s.memory = memory;
      let tickEnd = s.latest?.tick;
      try { tickEnd = (await s.client_.observe(Number.MAX_SAFE_INTEGER)).tick; } catch { /* keep the polled tick */ }
      const summary = summarizeCalls(calls);
      const failed = !timedOut && (code !== 0 || spawnError !== null || (!calls.length && parsed.clientErrors.length > 0));
      s.failures = failed ? s.failures + 1 : 0;
      s.backoffUntil = Date.now() + backoffMs(s.failures);
      const entry = { turn: number, trigger, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, tickStart: o.tick, tickEnd,
        inboxSize, exitCode: code, timedOut, failed, ...summary, clientErrors: parsed.clientErrors.slice(0, 10), memoryUpdated: Boolean(memory),
        memoryChars: s.memory.length, tokens: parsed.tokens, ...(failed ? { stderrTail: stderr.slice(-400) } : {}) };
      appendFileSync(resolve(s.dir, 'turns.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      log(`${s.slot}: turn ${number} done in ${(entry.durationMs / 1000).toFixed(0)} s${timedOut ? ' (TIMED OUT)' : ''}${failed ? ` (FAILED, exit ${code}, retry in ${backoffMs(s.failures) / 1000} s)` : ''}: ${summary.accepted} ok, ${summary.rejected.length} rejected, ${summary.messagesSent} msgs, ${calls.length} calls${summary.rejected.length ? ` — ${summary.rejected.map(r => `${r.tool}: ${r.error}`).join(' | ').slice(0, 300)}` : ''}${parsed.clientErrors.length ? ` — client: ${parsed.clientErrors.join(' | ').slice(0, 200)}` : ''}`);
      s.lastEndAt = Date.now(); s.child = null; s.kill = null;
      saveSeat(s); done();
    }));
  }

  log(`playtest ${match}: ${seatState.map(s => `${s.slot}=${s.country}/${s.client}`).join(', ')}; data ${runDir}`);
  let pollFailures = 0;
  while (!reason) {
    let httpStatus = null;
    try {
      for (const s of seatState) { const o = await poll(s); gameStatus = o.status; tick = o.tick; outcome = o.outcome ?? null; }
      pollFailures = 0;
    } catch (error) {
      httpStatus = error.status ?? null;
      if (++pollFailures % 5 === 1) log(`poll failed (${error.status ?? error.cause?.code ?? ''}): ${error.message}`);
    }
    if (gameStatus === 'running' && startTick === null) { startTick = tick; log(`match running at tick ${tick}`); }
    if (gameStatus === 'lobby' && !opts.waitStart && !httpStatus) { reason = 'not-started'; log('The room is still in the lobby; use --wait-start to wait.'); break; }
    reason = stopReason({ status: gameStatus, httpStatus, interrupted, unreachable: pollFailures >= 60, deadlinePassed: Date.now() > deadline, allSeatsDone: seatState.every(s => (s.eliminated || maxTurns && s.turns >= maxTurns) && !s.child) });
    if (reason) break;
    for (const s of seatState.filter(s => !maxTurns || s.turns < maxTurns)) {
      const trigger = nextTurn({ ...s, running: Boolean(s.child) }, { now: Date.now(), tick, status: gameStatus, interval, minGapMs });
      if (trigger) await startTurn(s, trigger);
    }
    writeStatus();
    await sleep(pollMs);
  }
  log(`stopping: ${reason}`);
  for (const s of seatState) s.kill?.();
  await Promise.all(seatState.map(s => s.child ? s.done : null));
  writeStatus();
  const report = buildReport();
  writePrivate(resolve(runDir, 'report.json'), JSON.stringify(report, null, 2));
  printReport(report);
  process.exitCode = ['finished', 'interrupted', 'all-seats-out'].includes(reason) ? 0 : 2;
}

// ------------------------------------------------------------------ per-client setup
function grokUserServers() {
  const names = ['council-game'];
  try { names.push(...tomlServerNames(readFileSync(resolve(homedir(), '.grok/config.toml'), 'utf8'))); } catch { /* no user config */ }
  return [...new Set(names)].filter(n => n !== 'council');
}
function hermesHome() { return process.env.HERMES_HOME || resolve(homedir(), '.hermes'); }
function hermesProfileExists(slot) { return existsSync(resolve(hermesHome(), 'profiles', hermesProfile(slot))); }
function setupHermes(s, log) {
  const profile = hermesProfile(s.slot), profileDir = resolve(hermesHome(), 'profiles', profile);
  const run = (step, allowFail = false) => {
    const result = spawnSync(step.command, step.args, { input: step.input ?? '', encoding: 'utf8', timeout: 120_000 });
    if (result.status !== 0 && !allowFail && !step.mayFail) throw new Error(`${step.command} ${step.args.slice(0, 4).join(' ')} failed: ${(result.stderr || result.stdout || '').slice(-400)}`);
    return result.stdout || '';
  };
  for (const step of setupCommands(s, { mcp: s.mcp, profileExists: existsSync(profileDir) })) {
    run(step);
    if (step.args[0] !== 'profile') continue;
    log(`${s.slot}: created Hermes profile ${profile}`);
  }
  // The OAuth login lives in the default Hermes home's auth.json; copy it owner-only when the profile lacks a newer one.
  const source = resolve(hermesHome(), 'auth.json'), target = resolve(profileDir, 'auth.json');
  if (existsSync(source) && (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs)) copyFileSync(source, target);
  if (existsSync(target)) chmodSync(target, 0o600);
  const others = hermesEnabledServers(run({ command: 'hermes', args: ['-p', profile, 'mcp', 'list'] }, true)).filter(n => n !== 'council');
  for (const step of setupCommands(s, { mcp: s.mcp, profileExists: true, enabledOtherServers: others }).filter(step => step.args.includes('config'))) run(step);
  if (others.length) log(`${s.slot}: disabled other Hermes MCP servers: ${others.join(', ')}`);
}
