#!/usr/bin/env node
/** Frozen two-arm study. Fail preflight before opening rooms when local Jeff is unavailable. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadPiConfig } from './config.js';
import { chooseWithJeff } from './decision-api.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const phase = arg('--phase', 'pilot');
if (!['pilot', 'main'].includes(phase)) throw new Error('Use --phase pilot|main.');
const envFile = arg('--durable-env-file', null);
if (!envFile) throw new Error('Specify the private --durable-env-file; keys never enter the manifest.');
const cfg = loadPiConfig('goodwin');
const bytes = readFileSync(resolve(root, 'docs/experiments/goodwin-jeff-protocol.json'));
const protocol = JSON.parse(bytes);
if (cfg.id !== protocol.model) throw new Error('Goodwin model differs from the frozen protocol.');
if (phase === 'main' && execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim())
  throw new Error('Commit the frozen controller and protocol before main launch.');
const vendorRevision = execFileSync('git', ['-C', resolve(root, 'data/jeff/source'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (vendorRevision !== protocol.localRuntime.vendorRevision) throw new Error('Jeff serving code differs from the protocol.');
const health = await fetch('http://127.0.0.1:18765/health').then(r => r.json());
if (health.status !== 'ready' || health.model !== 'jeff-qwen3.5-0.8b' || health.max_options !== 254)
  throw new Error('Local Jeff checkpoint is unavailable or differs from the protocol.');
const response = await fetch(`${cfg.baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
if (!response.ok || !(await response.json()).data?.some(m => m.id === cfg.id)) throw new Error('Goodwin endpoint is not serving the requested model.');
const preflight = await chooseWithJeff({ state: 'Two available troops face ten defenders. Preserve troops.',
  candidates: [{ id: 'wait', description: 'Keep the troops.' }, { id: 'attack', description: 'Send two against ten defenders.' }] });
const out = resolve(root, arg('--out', `data/goodwin-jeff/${phase}-${Date.now()}`));
mkdirSync(out, { recursive: true, mode: 0o700 });
const cases = phase === 'pilot' ? [{ country: 'britain', seed: 'gwjeff-pilot-01' }] : protocol.cases;
const hash = createHash('sha256').update(out).digest('hex').slice(0, 4);
const manifest = { phase, startedAt: new Date().toISOString(), sourceAlias: 'goodwin', playerName: 'Goodwin evaluation',
  root, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  protocolSha256: createHash('sha256').update(bytes).digest('hex'), modelId: cfg.id,
  localRuntime: protocol.localRuntime,
  preflight: { model: preflight.model, wallMs: preflight.wallMs, usage: preflight.usage }, jobs: [] };
for (let i = 0; i < cases.length; i++) for (let j = 0; j < 2; j++) {
  const arm = protocol.arms[(i + j) % 2], c = cases[i], alias = `gwj_${phase}_${arm}_${i}_${hash}`;
  const args = [arm === 'baseline' ? 'agents/pi/play.js' : 'agents/pi/hybrid-play.js', '--model', alias,
    '--country', c.country, '--combat-seed', c.seed, '--preset', phase === 'pilot' ? 'quick' : 'standard',
    '--max-minutes', phase === 'pilot' ? '7' : '35'];
  if (arm === 'baseline') args.push('--session-mode', 'fresh', '--decision-interval-ticks', '30', '--max-turn-seconds', '120', '--max-turns', '80', '--turn-view', 'decision');
  else args.push('--selector', 'jeff', '--planner-interval', '180', '--tactical-interval', '5');
  manifest.jobs.push({ arm, ...c, alias, args, statusFile: resolve(out, `${i}-${arm}.status.json`),
    unit: `council-goodwin-jeff-${alias.replaceAll('_', '-')}` });
}
const file = resolve(out, 'manifest.json');
writeFileSync(file, JSON.stringify(manifest, null, 2), { mode: 0o600 });
for (let i = 0; i < manifest.jobs.length; i++) {
  const job = manifest.jobs[i];
  execFileSync('systemd-run', ['--user', '--collect', '--unit', job.unit,
    '--property', `WorkingDirectory=${root}`, '--property', `StandardOutput=append:${resolve(out, `${i}-${job.arm}.log`)}`,
    '--property', 'StandardError=inherit', process.execPath, `--env-file=${resolve(envFile)}`,
    resolve(root, 'agents/pi/study-worker.js'), file, String(i)], { stdio: 'pipe' });
}
console.log(`Started ${manifest.jobs.length} isolated ${phase} cases: ${file}`);
