#!/usr/bin/env node
/** Durable trial worker. Writes a separate status file even if the parent launcher disappears. */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const [, , manifestFile, jobIndex] = process.argv;
const manifest = JSON.parse(readFileSync(manifestFile));
const job = manifest.jobs[Number(jobIndex)];
if (!job || !manifest.sourceAlias || !job.statusFile) throw new Error('Invalid study worker job.');
const env = { ...process.env };
for (const [key, value] of Object.entries(process.env)) if (key.startsWith(`PI_MODEL_${manifest.sourceAlias.toUpperCase()}_`))
  env[key.replace(`PI_MODEL_${manifest.sourceAlias.toUpperCase()}_`, `PI_MODEL_${job.alias.toUpperCase()}_`)] = value;
env[`PI_MODEL_${job.alias.toUpperCase()}_PLAYER_NAME`] = manifest.playerName;
const child = spawn(process.execPath, job.args, { cwd: manifest.root, env, stdio: 'inherit' });
writeFileSync(job.statusFile, JSON.stringify({ status: 'running', workerPid: process.pid, childPid: child.pid,
  startedAt: new Date().toISOString() }), { mode: 0o600 });
child.on('exit', (exitCode, signal) => {
  writeFileSync(resolve(job.statusFile), JSON.stringify({ status: 'exited', exitCode, signal,
    finishedAt: new Date().toISOString() }), { mode: 0o600 });
  process.exitCode = exitCode ?? 2;
});
