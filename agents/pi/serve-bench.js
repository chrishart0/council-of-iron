#!/usr/bin/env node
/** Serve only the public aggregate benchmark page and data; never expose Pi workspaces or raw logs. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['bench.html', 'text/html; charset=utf-8']],
  ['/bench.html', ['bench.html', 'text/html; charset=utf-8']],
  ['/bench-view.js', ['bench-view.js', 'text/javascript; charset=utf-8']],
  ['/benchmarks.json', ['benchmarks.json', 'application/json; charset=utf-8']],
  ['/task-benchmarks.json', ['task-benchmarks.json', 'application/json; charset=utf-8']],
]);
const host = process.env.COUNCIL_BENCH_HOST || '127.0.0.1';
const port = Number(process.env.COUNCIL_BENCH_PORT || 8001);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid COUNCIL_BENCH_PORT.');
export const createBenchServer = () => createServer(async (request, response) => {
  const path = request.url?.split('?')[0];
  const entry = request.method === 'GET' || request.method === 'HEAD' ? files.get(path) : null;
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (!entry) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await readFile(new URL(entry[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(500); response.end('Report file unavailable'); }
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createBenchServer();
  server.listen(port, host, () => console.log(`Benchmark report: http://${host}:${port}/`));
}
