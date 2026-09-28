import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/server.js';
import { STT_PER_MINUTE, STT_MAX_BYTES } from '../src/stt.js';

const SECRET = 'Meet me in Belgium at midnight, betray France';

/** A fake sidecar: records what it received and answers like tools/stt/server.py. */
async function fakeSidecar(t, { delay = 0, status = 200 } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const chunks = []; for await (const c of req) chunks.push(c);
    seen.push({ url: req.url, type: req.headers['content-type'], bytes: Buffer.concat(chunks).length });
    await new Promise(r => setTimeout(r, delay));
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { text: ` ${SECRET}\u0007 `, ms: 90 } : { error: 'nope' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(r => server.close(r)) };
}

async function fixture(t, options = {}) {
  const app = makeServer({ dbPath: ':memory:', automatic: false, sttUrl: '', ...options });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  const call = async (path, method = 'GET', data, token) => {
    const r = await fetch(url + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const a = (await call('/api/players', 'POST', { name: 'Human' })).data, b = (await call('/api/players', 'POST', { name: 'Watcher' })).data;
  const id = (await call('/api/games', 'POST', { name: 'Voice' }, a.token)).data.id;
  const seat = (await call(`/api/games/${id}/join`, 'POST', { country: 'usa', kind: 'human' }, a.token)).data;
  const voice = (audio = Buffer.alloc(4000, 1), { token = seat.token, type = 'audio/webm;codecs=opus', game = id } = {}) =>
    fetch(`${url}/api/games/${game}/stt`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': type }, body: audio })
      .then(async r => ({ status: r.status, data: await r.json() }));
  return { app, url, call, id, seat, a, b, voice };
}

test('voice input is off without STT_URL: capability false and 503 for seated players', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.call('/api/stt')).data, { available: false });
  const r = await f.voice();
  assert.equal(r.status, 503);
  assert.match(r.data.error, /Voice input unavailable/);
});

test('voice input proxies seated players only and returns the transcript without sending chat', async t => {
  const side = await fakeSidecar(t), f = await fixture(t, { sttUrl: side.url });
  assert.deepEqual((await f.call('/api/stt')).data, { available: true });
  assert.equal((await f.voice(undefined, { token: null })).status, 401, 'spectators have no credential');
  assert.equal((await f.voice(undefined, { token: f.b.token })).status, 403, 'unseated profiles are refused');
  assert.equal((await f.voice(undefined, { token: 'bogus' })).status, 401);
  assert.equal((await f.voice(undefined, { type: 'application/json' })).status, 415);
  assert.equal((await f.voice(undefined, { type: 'video/mp4' })).status, 415);
  assert.equal(side.seen.length, 0, 'refused requests never reach the sidecar');

  const before = JSON.stringify(f.app.games.get(f.id));
  const ok = await f.voice(Buffer.alloc(5000, 2), { type: 'audio/mp4' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { text: SECRET }, 'control characters stripped, only text returned');
  assert.deepEqual(side.seen, [{ url: '/transcribe', type: 'audio/mp4', bytes: 5000 }]);
  assert.equal(JSON.stringify(f.app.games.get(f.id)), before, 'transcription never touches game state or chat');
  assert.equal((await f.voice(undefined, { type: 'audio/ogg;codecs=opus' })).status, 200);
});

test('voice input size limit, per-player concurrency and per-minute limits', async t => {
  const side = await fakeSidecar(t, { delay: 150 }), f = await fixture(t, { sttUrl: side.url });
  assert.equal((await f.voice(Buffer.alloc(STT_MAX_BYTES + 1))).status, 413);
  const [first, second] = await Promise.all([f.voice(), f.voice()]);
  assert.deepEqual([first.status, second.status].sort(), [200, 429]);
  const results = [];
  for (let i = 0; i < STT_PER_MINUTE; i++) results.push((await f.voice()).status);
  assert.equal(results.filter(s => s === 429).length, 2, 'the minute window also counts the oversize and first concurrent attempts');
  assert.equal((await f.voice()).status, 429);
});

test('voice input maps sidecar failures and never logs transcripts', async t => {
  const logs = [];
  for (const level of ['log', 'error', 'warn', 'info']) {
    const original = console[level];
    console[level] = (...args) => { logs.push(args.map(String).join(' ')); };
    t.after(() => { console[level] = original; });
  }
  const good = await fakeSidecar(t), f = await fixture(t, { sttUrl: good.url });
  assert.equal((await f.voice()).status, 200);
  const bad = await fakeSidecar(t, { status: 422 }), g = await fixture(t, { sttUrl: bad.url });
  assert.equal((await g.voice()).status, 422);
  const gone = await fakeSidecar(t), h = await fixture(t, { sttUrl: gone.url });
  await gone.close();
  const down = await h.voice();
  assert.equal(down.status, 503);
  assert.deepEqual((await h.call('/api/stt')).data, { available: false });
  assert.ok(!logs.some(line => line.includes('Belgium') || line.includes('betray')), 'transcript text never reaches logs');
});

test('optional HTTPS listener shares the same routes and accepts its own https origin', async t => {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'council-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  } catch { t.skip('openssl unavailable'); return; }
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = makeServer({ dbPath: ':memory:', automatic: false, sttUrl: '',
    tls: { cert: readFileSync(join(dir, 'cert.pem')), key: readFileSync(join(dir, 'key.pem')) } });
  await new Promise(r => app.tlsServer.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const port = app.tlsServer.address().port;
  const { request } = await import('node:https');
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', rejectUnauthorized: false,
      headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json', ...headers } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(JSON.stringify({ name: 'Phone' }));
  });
  assert.equal(await get('/api/players', { Origin: `https://localhost:${port}` }), 201);
  assert.equal(await get('/api/players', { Origin: `http://localhost:${port}` }), 403);
});

test('OPENAI_API_KEY sends the clip to the OpenAI transcription API with the game vocabulary', async t => {
  const { makeStt } = await import('../src/stt.js');
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('latin1');
    seen.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'],
      model: /name="model"\r\n\r\n([^\r]*)/.exec(body)?.[1], prompt: /name="prompt"\r\n\r\n([^\r]*)/.exec(body)?.[1],
      filename: /filename="([^"]+)"/.exec(body)?.[1] });
    res.writeHead(seen.length === 1 ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(seen.length === 1 ? { text: ` ${SECRET} ` } : { error: { message: 'bad audio' } }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const stt = makeStt({ url: '', openAiKey: 'test-key', openAiBase: `http://127.0.0.1:${server.address().port}/v1/`, prompt: 'Council of Iron. Britain.' });
  const clip = (bytes = 3000, type = 'audio/webm;codecs=opus') => Object.assign((async function* () { yield Buffer.alloc(bytes, 3); })(),
    { headers: { 'content-type': type, 'content-length': String(bytes) }, destroy() {} });
  assert.equal(stt.provider, 'openai'); assert.equal(await stt.available(), true);
  assert.deepEqual(await stt.transcribe(clip(), 'g:usa'), { text: SECRET });
  assert.deepEqual(seen[0], { url: '/v1/audio/transcriptions', auth: 'Bearer test-key', type: seen[0].type,
    model: 'whisper-1', prompt: 'Council of Iron. Britain.', filename: 'recording.webm' });
  assert.match(seen[0].type, /^multipart\/form-data; boundary=/);
  await assert.rejects(stt.transcribe(clip(2000, 'audio/mp4'), 'g:usa'), e => e.status === 422, 'an OpenAI 400 is an unintelligible recording');
  assert.equal(seen[1].filename, 'recording.mp4');
});
