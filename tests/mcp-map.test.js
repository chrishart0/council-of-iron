import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { makeServer } from '../src/server.js';
import { LocalMcpClient } from '../agents/pi/mcp-client.js';

test('MCP map preserves playable geometry without sending decorative SVG paths', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'council-mcp-map-'));
  const app = makeServer({ dbPath: resolve(dir, 'game.db'), league: false });
  let mcp;
  try {
    await new Promise(done => app.server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const browserMap = await (await fetch(`${url}/map.json`)).json();
    mcp = new LocalMcpClient(process.execPath, [resolve('agents/mcp.js')], {
      ...process.env, COUNCIL_URL: url, COUNCIL_SESSION: resolve(dir, 'seat.json'), COUNCIL_MATCH: '', COUNCIL_TOKEN: '',
    });
    const { tools } = await mcp.initialize();
    assert.ok(tools.some(tool => tool.name === 'map'));
    const answer = await mcp.call('map', {});
    assert.equal(answer.isError, undefined);
    const agentMap = JSON.parse(answer.content[0].text);
    assert.equal(agentMap.provinces.length, browserMap.provinces.length);
    assert.deepEqual(agentMap.countries, browserMap.countries);
    assert.deepEqual(agentMap.edges, browserMap.edges);
    for (let i = 0; i < agentMap.provinces.length; i++) {
      const { path, ...playable } = browserMap.provinces[i];
      assert.deepEqual(agentMap.provinces[i], playable);
      assert.equal(Object.hasOwn(agentMap.provinces[i], 'path'), false);
    }
  } finally {
    mcp?.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
