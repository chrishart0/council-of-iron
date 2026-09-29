#!/usr/bin/env node
/** Run the ordinary Grok/Hermes/Codex CLI harness in an isolated normal-speed bot room. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeServer } from '../../src/server.js';
import { CouncilClient } from '../client.js';
import { parseSeat, validateSeats } from './lib.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), seats = [];
let seed = '', hermesProfile = '', maxMinutes = 35;
for (let i = 0; i < args.length; i++) {
  const value = args[++i];
  if (!value) throw new Error(`Missing value for ${args[i - 1]}.`);
  if (args[i - 1] === '--seat') seats.push(value);
  else if (args[i - 1] === '--seed') seed = value;
  else if (args[i - 1] === '--hermes-profile') hermesProfile = value;
  else if (args[i - 1] === '--max-minutes') maxMinutes = Number(value);
  else throw new Error(`Unknown option ${args[i - 1]}.`);
}
if (!/^[\w-]{1,64}$/.test(seed) || !seats.length || !Number.isFinite(maxMinutes) || maxMinutes < 31)
  throw new Error('Use --seed ROOM_ID, one or more --seat SLOT:COUNTRY:CLIENT:MODEL:EFFORT, and --max-minutes >=31.');
validateSeats(seats.map(parseSeat));
const output = resolve(root, 'data/playtest');
mkdirSync(output, { recursive: true, mode: 0o700 });
const app = makeServer({ dbPath: resolve(output, `${seed}.db`), automatic: true, gameIdFactory: () => seed });
await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${app.server.address().port}`;
const host = new CouncilClient({ url, sessionPath: resolve(output, `${seed}.host.session.json`) });
let child;
try {
  await host.register('Benchmark host');
  const game = await host.create('CLI harness benchmark', 'standard');
  if (game.id !== seed) throw new Error(`Expected room ${seed}, got ${game.id}.`);
  const childArgs = [resolve(root, 'agents/playtest/run.js'), '--url', url, '--match', seed,
    '--join', '--wait-start', '--wait-finish', '--interval', '30', '--turn-timeout', '120',
    '--max-minutes', String(maxMinutes), '--data', output,
    ...seats.flatMap(seat => ['--seat', seat]),
    ...(hermesProfile ? ['--hermes-profile', hermesProfile] : [])];
  child = spawn(process.execPath, childArgs, { cwd: root, stdio: 'inherit' });
  const closed = new Promise(done => child.once('close', done));
  let joined = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null) throw new Error(`CLI harness exited before the lobby filled (${child.exitCode}).`);
    const room = await host.observe(0);
    if (room.status !== 'lobby') throw new Error(`Room unexpectedly became ${room.status}.`);
    if (room.players.length === seats.length) { joined = true; break; }
    await sleep(1000);
  }
  if (!joined) throw new Error('CLI seats did not join within three minutes.');
  await host.bots();
  await host.start();
  console.log(`Started isolated room ${seed}: ${seats.length} CLI seats and ${8 - seats.length} practice bots.`);
  const code = await closed;
  if (code !== 0) throw new Error(`CLI harness exited ${code}; private run kept for diagnosis.`);
  const runPath = resolve(output, seed, 'run.json');
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  writeFileSync(runPath, `${JSON.stringify({ ...run, arena: 'seven practice bots' })}\n`, { mode: 0o600 });
  const imported = spawnSync(process.execPath, [resolve(root, 'agents/pi/bench-playtest.js'), resolve(output, seed)],
    { cwd: root, stdio: 'inherit' });
  if (imported.status !== 0) throw new Error('Finished run could not be imported.');
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  app.server.closeAllConnections();
  await new Promise(done => app.server.close(done));
}
