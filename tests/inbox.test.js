import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { spawn } from 'node:child_process';
import { createGame, join, start, act, tick, observe, inbox, markRead, attention } from '../src/engine.js';
import { boardView } from '../agents/board.js';
import { decisionView } from '../agents/decision-view.js';
import { makeServer } from '../src/server.js';
const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));
let next = 0;
function game(ids = ['usa', 'britain', 'france', 'germany']) {
  const g = createGame({ id: `inbox-${++next}`, name: 'Inbox', hostId: ids[0] }, map);
  for (const id of ids) join(g, map, { profileId: id, name: id, country: id });
  start(g); return g;
}
const send = (g, id, action) => act(g, map, id, action, `inbox-${++next}`);
const say = (g, from, channel, text, to) => { const r = send(g, from, { type: 'chat', channel, text, ...(to ? { to } : {}) }); tick(g); tick(g); return r; };

test('inbox: unread DMs and alliance chat to this seat only, never its own, never another seat\'s DMs', () => {
  const g = game();
  const offer = send(g, 'usa', { type: 'propose', country: 'britain', name: 'Accord' });
  send(g, 'britain', { type: 'accept', proposalId: offer.proposalId }); for (let i = 0; i < 31; i++) tick(g);
  say(g, 'britain', 'alliance', 'hold the line');
  say(g, 'france', 'dm', 'secret for germany', 'germany');
  say(g, 'france', 'dm', 'terms for usa', 'usa');
  say(g, 'germany', 'world', 'hello world');
  say(g, 'usa', 'alliance', 'my own words');
  const box = inbox(g, 'usa');
  assert.deepEqual(box.messages.map(m => [m.from, m.channel, m.text, m.untrusted]),
    [['britain', 'alliance', 'hold the line', true], ['france', 'dm', 'terms for usa', true]]);
  assert.equal(box.unread, 2); assert.deepEqual(box.from, { britain: 1, france: 1 });
  assert.ok(!JSON.stringify(inbox(g, 'usa')).includes('secret for germany'), 'never another seat\'s DM');
  assert.ok(!JSON.stringify(inbox(g, 'britain')).includes('terms for usa'));
  assert.deepEqual(inbox(g, 'germany').messages.map(m => m.text), ['secret for germany']);
  assert.equal(attention(g, 'usa'), '2 unread messages (britain, france): read inbox');
  assert.equal(attention(g, 'france'), null);
});

test('inbox cursor: only markRead moves it, never back or past the log, and skipping ahead marks nothing', () => {
  const g = game();
  say(g, 'britain', 'dm', 'one', 'usa'); say(g, 'britain', 'dm', 'two', 'usa'); say(g, 'france', 'dm', 'three', 'usa');
  assert.equal(attention(g, 'usa'), '3 unread messages (britain ×2, france): read inbox');
  const [one, two] = inbox(g, 'usa').messages;
  observe(g, 'usa'); boardView(observe(g, 'usa'), map);
  assert.equal(inbox(g, 'usa').unread, 3, 'reading the board does not mark anything read');
  assert.equal(markRead(g, 'usa', g.sequence, one.id), 0, 'a reader that started after an unread message moves nothing');
  assert.equal(markRead(g, 'usa', one.id), one.id);
  assert.equal(markRead(g, 'usa', 0), one.id, 'never backwards');
  assert.deepEqual(inbox(g, 'usa').messages.map(m => m.text), ['two', 'three']);
  assert.equal(markRead(g, 'usa', two.id, one.id), two.id, 'a contiguous reader moves it');
  assert.equal(markRead(g, 'usa', 10 ** 9), g.sequence, 'never past the log');
  assert.equal(inbox(g, 'usa').unread, 0); assert.equal(attention(g, 'usa'), null);
  assert.throws(() => markRead(g, 'usa', -1), /Invalid read cursor/);
  // newest vs oldest pages
  for (let i = 0; i < 7; i++) say(g, 'germany', 'dm', `m${i}`, 'usa');
  assert.deepEqual(inbox(g, 'usa').messages.map(m => m.text), ['m2', 'm3', 'm4', 'm5', 'm6']); assert.equal(inbox(g, 'usa').older, 2);
  const page = inbox(g, 'usa', { limit: 3, newest: false });
  assert.deepEqual(page.messages.map(m => m.text), ['m0', 'm1', 'm2']); assert.equal(page.more, 4);
});

test('needsDecision lists alliance offers to you and peace offers to your side; attention names them', () => {
  const g = game();
  const offer = send(g, 'britain', { type: 'propose', country: 'usa', name: 'Accord' });
  assert.deepEqual(inbox(g, 'usa').needsDecision, [{ kind: 'alliance_offer', proposalId: offer.proposalId, from: 'britain', name: 'Accord', roster: ['britain', 'usa'], expiresAt: g.tick + 120 }]);
  assert.deepEqual(inbox(g, 'britain').needsDecision, [], 'the proposer already accepted');
  send(g, 'france', { type: 'declare_war', country: 'usa' });
  const peace = send(g, 'france', { type: 'offer_peace', country: 'usa' });
  assert.equal(attention(g, 'usa'), `Alliance offer from britain awaiting your answer (${offer.proposalId}); Peace offer from france awaiting your answer (${peace.offerId})`);
  assert.deepEqual(inbox(g, 'france').needsDecision, []);
  const board = boardView({ ...observe(g, 'usa'), inbox: inbox(g, 'usa') }, map);
  assert.equal(Object.keys(board)[0], 'inbox', 'the board starts with the inbox');
  assert.equal(board.inbox.needsDecision.length, 2); assert.equal(board.inbox.from, undefined);
  assert.equal(Object.keys(decisionView({ ...observe(g, 'usa'), inbox: inbox(g, 'usa') }, map))[0], 'inbox');
  assert.deepEqual(boardView({ ...observe(g, 'germany'), inbox: inbox(g, 'germany') }, map).inbox, { unread: 0, needsDecision: [] });
});

test('develop: the board lists next level, cost, free troops and readiness; the error says what is missing', () => {
  const g = game();
  const england = g.provinces.find(p => p.id === 'england');
  Object.assign(england, { troops: 12, development: 1 });
  const row = boardView(observe(g, 'britain'), map).own.find(p => p.id === 'england');
  assert.deepEqual(row.develop, { level: 2, cost: 24, free: 11, ready: false });
  assert.ok(!boardView(observe(g, 'britain'), map).readyDevelopments.some(p => p.from === 'england'));
  assert.throws(() => send(g, 'britain', { type: 'develop', from: 'england' }),
    e => /needs 24 free troops \(one more stays home\); it has 11\. Wait for recruitment, rally troops there/.test(e.message) && e.details.free === 11 && e.details.cost === 24);
  england.troops = 25;
  const ready = boardView(observe(g, 'britain'), map);
  assert.deepEqual(ready.own.find(p => p.id === 'england').develop, { level: 2, cost: 24, free: 24, ready: true });
  assert.ok(ready.readyDevelopments.some(p => p.from === 'england'));
  // Every province the board calls ready is accepted by the engine; every other one is refused.
  for (const p of ready.own.filter(p => p.develop)) {
    const copy = structuredClone(g);
    let ok = true; try { act(copy, map, 'britain', { type: 'develop', from: p.id }, `dev-${p.id}`); } catch { ok = false; }
    assert.equal(ok, p.develop.ready, p.id);
  }
  send(g, 'britain', { type: 'develop', from: 'england' });
  assert.deepEqual(boardView(observe(g, 'britain'), map).own.find(p => p.id === 'england').develop, { level: 2, cost: 24, free: 0, ready: false, queued: true });
  tick(g);
  const building = boardView(observe(g, 'britain'), map).own.find(p => p.id === 'england').develop;
  assert.equal(building.ready, false); assert.equal(building.building.level, 2);
});

function subprocess(file, env, input = '', args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: new URL('../', import.meta.url), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Child timeout')); }, 15000);
    child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); }); child.stdin.end(input);
  });
}

test('HTTP, CLI and MCP share the inbox, the attention line and the read cursor', async t => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'council-inbox-'));
  const app = makeServer({ dbPath: ':memory:', automatic: false });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, method = 'GET', data, token) => {
    const r = await fetch(url + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: data !== undefined ? JSON.stringify(data) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const profile = async name => (await call('/api/players', 'POST', { name })).data;
  const host = await profile('Host'), agent = await profile('Agent'), third = await profile('Third'), fourth = await profile('Fourth');
  const id = (await call('/api/games', 'POST', { name: 'Inbox' }, host.token)).data.id;
  const seat = async (p, country, kind = 'human') => (await call(`/api/games/${id}/join`, 'POST', { country, kind }, p.token)).data.token;
  const usa = await seat(host, 'usa'), britain = await seat(agent, 'britain', 'agent'), france = await seat(third, 'france'), germany = await seat(fourth, 'germany');
  await call(`/api/games/${id}/start`, 'POST', {}, usa);
  const g = app.games.get(id);
  const act = async (token, opId, action) => (await call(`/api/games/${id}/actions`, 'POST', { opId, action }, token)).data;
  await act(usa, 'c1', { type: 'chat', channel: 'dm', to: 'britain', text: 'ally with me?' }); app.step(g, 2);
  await act(france, 'c2', { type: 'chat', channel: 'dm', to: 'germany', text: 'private to germany' }); app.step(g, 2);
  await act(usa, 'c3', { type: 'chat', channel: 'dm', to: 'britain', text: 'please answer' }); app.step(g, 2);
  const offer = await act(usa, 'p1', { type: 'propose', country: 'britain', name: 'Accord' });
  // HTTP: attention on an order result, not stored in the receipt.
  const order = await act(britain, 'r1', { type: 'rally', from: 'scotland', to: 'england' });
  assert.equal(order.attention, `2 unread messages (usa ×2): read inbox; Alliance offer from usa awaiting your answer (${offer.proposalId})`);
  assert.equal(g.receipts['britain:r1'].result.attention, undefined);
  assert.equal((await call(`/api/games/${id}/inbox`, 'GET', undefined, france)).data.unread, 0);
  const seen = (await call(`/api/games/${id}?inbox=1`, 'GET', undefined, britain)).data.inbox;
  assert.deepEqual(seen.messages.map(m => m.text), ['ally with me?', 'please answer']);
  assert.equal((await call(`/api/games/${id}`, 'GET', undefined, britain)).data.inbox, undefined, 'only when asked');
  assert.equal((await call(`/api/games/${id}?inbox=1`)).data.inbox, undefined, 'spectators have no inbox');
  assert.equal((await call(`/api/games/${id}/inbox`)).status, 401);
  // CLI and MCP boards start with the same inbox, and do not mark it read.
  const env = { COUNCIL_URL: url, COUNCIL_SESSION: pathJoin(dir, 'b.session.json'), COUNCIL_TOKEN: britain, COUNCIL_MATCH: id };
  const cliBoard = JSON.parse((await subprocess('agents/cli.js', env, '', ['board'])).stdout);
  assert.equal(Object.keys(cliBoard)[0], 'inbox'); assert.deepEqual(cliBoard.inbox.messages, seen.messages);
  const rpc = calls => [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...calls.map(([name, args], i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } }))].map(x => JSON.stringify(x)).join('\n') + '\n';
  const first = (await subprocess('agents/mcp.js', env, rpc([['decision_view', {}], ['board', {}], ['declare_war', { country: 'france' }], ['inbox', {}], ['board', {}]]))).stdout
    .trim().split('\n').map(x => JSON.parse(x)).slice(1).map(x => JSON.parse(x.result.content[0].text));
  const [decision, board, war, read, after] = first;
  assert.deepEqual(decision.inbox, cliBoard.inbox); assert.deepEqual(board.inbox, cliBoard.inbox);
  assert.match(war.attention, /2 unread messages \(usa ×2\)/);
  assert.deepEqual(read.messages.map(m => m.text), ['ally with me?', 'please answer']); assert.equal(read.readThrough, g.sequence);
  assert.deepEqual(after.inbox.messages, []); assert.equal(after.inbox.unread, 0);
  assert.equal(after.inbox.needsDecision[0].proposalId, offer.proposalId, 'decisions stay until answered');
  // News marks what it returned as read (CLI), for a contiguous reader only.
  await act(usa, 'c4', { type: 'chat', channel: 'dm', to: 'britain', text: 'third note' }); app.step(g, 2);
  assert.equal((await call(`/api/games/${id}/inbox`, 'GET', undefined, britain)).data.unread, 1);
  assert.equal((await call(`/api/games/${id}/inbox`, 'POST', { through: g.sequence, after: g.sequence }, britain)).data.unread, 1, 'skipping ahead marks nothing');
  const news = JSON.parse((await subprocess('agents/cli.js', env, '', ['news'])).stdout);
  assert.ok(news.events.some(e => e.text === 'third note')); assert.equal(news.readThrough, g.sequence);
  assert.equal((await call(`/api/games/${id}/inbox`, 'GET', undefined, britain)).data.unread, 0);
  assert.deepEqual((await call(`/api/games/${id}/inbox`, 'GET', undefined, germany)).data.messages.map(m => m.text), ['private to germany']);
  // Error details reach every client: a truce refusal carries truceUntil.
  await act(britain, 'w1', { type: 'declare_war', country: 'germany' });
  const po = await act(britain, 'w2', { type: 'offer_peace', country: 'germany' });
  await act(germany, 'w3', { type: 'accept_peace', offerId: po.offerId });
  const refused = await call(`/api/games/${id}/actions`, 'POST', { opId: 'w4', action: { type: 'declare_war', country: 'germany' } }, britain);
  assert.equal(refused.status, 409); assert.equal(refused.data.truceUntil, g.tick + 120); assert.match(refused.data.error, /Truce with germany/);
  const cliWar = await subprocess('agents/cli.js', env, '', ['war', 'germany']);
  assert.equal(JSON.parse(cliWar.stderr).truceUntil, g.tick + 120);
});
