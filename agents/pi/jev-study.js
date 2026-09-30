#!/usr/bin/env node
/** Launch a balanced isolated study. Credentials remain inherited environment variables. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const phase = arg('--phase', 'pilot'), sourceAlias = arg('--model', 'space_bunny');
if (!['pilot', 'main'].includes(phase)) throw new Error('Use --phase pilot|main.');
const protocolBytes = readFileSync(resolve(root, 'docs/experiments/jev-protocol.json'));
const protocol = JSON.parse(protocolBytes);
const requestedArms = arg('--arms', protocol.arms.join(',')).split(',');
if (requestedArms.some(arm => !protocol.arms.includes(arm))) throw new Error('Unknown arm.');
const durableEnvFile = arg('--durable-env-file', undefined);
const cases = phase === 'pilot' ? [{ country: 'britain', seed: 'jev-pilot-01' }] : protocol.cases;
const out = resolve(root, arg('--out', `data/jev-study/${phase}-${Date.now()}`));
mkdirSync(out, { recursive: true, mode: 0o700 });
const manifest = { phase, startedAt: new Date().toISOString(), protocolSha256: createHash('sha256').update(protocolBytes).digest('hex'),
  modelId: process.env[`PI_MODEL_${sourceAlias.toUpperCase()}_ID`], sourceAlias, root,
  batchLabel: arg('--batch-label', 'original'), jobs: [] };
const jobs = [];
for (let i = 0; i < cases.length; i++) for (let j = 0; j < requestedArms.length; j++) {
  // Rotate launch order by case; every country has all four arms under the same load window.
  const arm = requestedArms[(i + j) % requestedArms.length], c = cases[i];
  const batch = createHash('sha256').update(out).digest('hex').slice(0, 4);
  const alias = `study_${phase}_${arm.replaceAll('-', '_')}_${i}_${batch}`;
  const env = { ...process.env };
  for (const [key, value] of Object.entries(process.env)) if (key.startsWith(`PI_MODEL_${sourceAlias.toUpperCase()}_`))
    env[key.replace(`PI_MODEL_${sourceAlias.toUpperCase()}_`, `PI_MODEL_${alias.toUpperCase()}_`)] = value;
  env[`PI_MODEL_${alias.toUpperCase()}_PLAYER_NAME`] = 'Bunny evaluation';
  const args = [arm === 'baseline' ? 'agents/pi/play.js' : 'agents/pi/hybrid-play.js', '--model', alias,
    '--country', c.country, '--combat-seed', c.seed, '--preset', phase === 'pilot' ? 'quick' : 'standard',
    '--max-minutes', phase === 'pilot' ? '7' : '35'];
  if (arm === 'baseline') args.push('--session-mode', 'fresh', '--decision-interval-ticks', '30', '--max-turn-seconds', '120', '--max-turns', '80', '--turn-view', 'decision');
  else args.push('--selector', arm, '--planner-interval', '30', '--tactical-interval', '5');
  const job = { arm, ...c, alias, args, status: 'running' }; manifest.jobs.push(job);
  if (durableEnvFile) {
    job.statusFile = resolve(out, `${i}-${arm}.status.json`);
    continue;
  }
  const logFile = resolve(out, `${i}-${arm}.log`), stream = createWriteStream(logFile, { mode: 0o600 });
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream); child.stderr.pipe(stream);
  jobs.push(new Promise(resolveJob => child.on('exit', (code, signal) => {
    job.exitCode = code; job.signal = signal; job.status = 'exited'; job.finishedAt = new Date().toISOString();
    writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    stream.end(); console.log(`${phase} ${c.country} ${arm}: exit ${code}`); resolveJob();
  })));
}
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
if (durableEnvFile) {
  for (let i = 0; i < manifest.jobs.length; i++) {
    const job = manifest.jobs[i], unit = `council-jev-study-${job.alias.replaceAll('_', '-')}`;
    const logFile = resolve(out, `${i}-${job.arm}.log`);
    execFileSync('systemd-run', ['--user', '--collect', '--unit', unit,
      '--property', `WorkingDirectory=${root}`, '--property', `StandardOutput=append:${logFile}`,
      '--property', 'StandardError=inherit', process.execPath, `--env-file=${resolve(durableEnvFile)}`,
      resolve(root, 'agents/pi/study-worker.js'), resolve(out, 'manifest.json'), String(i)], { stdio: 'pipe' });
    job.unit = unit;
  }
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`Started ${manifest.jobs.length} durable isolated rooms; manifest ${resolve(out, 'manifest.json')}`);
  process.exit(0);
}
console.log(`Started ${jobs.length} isolated ${phase} rooms; manifest ${resolve(out, 'manifest.json')}`);
await Promise.all(jobs);
manifest.finishedAt = new Date().toISOString();
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
if (manifest.jobs.some(job => job.exitCode !== 0)) process.exitCode = 2;
