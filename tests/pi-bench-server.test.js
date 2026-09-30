import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchServer } from '../agents/pi/serve-bench.js';

test('benchmark server serves the report and aggregate ledger but refuses private paths', async () => {
  const server = createBenchServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Campaign ledger/);
    const ledger = await fetch(`${url}/benchmarks.json`);
    assert.equal(ledger.status, 200);
    assert.equal((await ledger.json()).schemaVersion, 5);
    for (const path of ['/play.js', '/workspace/qwen/strategy.md', '/.env', '/../bench.js']) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 404, path);
    }
    assert.equal((await fetch(`${url}/benchmarks.json`, { method: 'POST' })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
});
