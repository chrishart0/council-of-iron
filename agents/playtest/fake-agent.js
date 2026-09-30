#!/usr/bin/env node
/** Test-only stand-in for an LLM CLI: one turn through the same logging MCP proxy, no model calls.
 * Checks the tool list (inbox present, room setup hidden), reads the decision view, answers DMs/alliance chat
 * from the prompt's INBOX, makes one legal march, makes one deliberately invalid march on turn 1 (to prove
 * rejection logging), calls the inbox tool, and prints a MEMORY line. */
import { LocalMcpClient } from '../pi/mcp-client.js';

const prompt = process.argv[2] || '';
const spec = JSON.parse(process.env.PLAYTEST_FAKE_MCP || '{}');
const mcp = new LocalMcpClient(spec.command, spec.args, { ...process.env, ...spec.env });
const text = result => JSON.parse(result.content.find(c => c.type === 'text').text);
const done = [];
try {
  const { tools } = await mcp.initialize();
  const names = new Set(tools.map(t => t.name));
  if (!names.has('inbox') || names.has('create_match')) throw new Error(`Unexpected tool list: ${[...names].join(', ')}`);
  const view = text(await mcp.call('decision_view', {}));
  const senders = [...prompt.matchAll(/(?:DM|ALLIANCE CHAT) from ([a-z-]+)/g)].map(m => m[1]);
  for (const from of [...new Set(senders)]) {
    const reply = await mcp.call('send_message', { channel: 'dm', to: from, text: 'Received; holding to our plan.' });
    done.push(`${reply.isError ? 'failed to answer' : 'answered'} ${from}`);
  }
  if (/^TURN 1 /m.test(prompt)) await mcp.call('march', { to: 'atlantis', from: view.own[0]?.id ?? 'nowhere', percent: 10 });
  const target = view.frontier.find(t => !t.requiresWar && t.sources.some(s => s.available >= 2));
  if (target) {
    // Every bordering province at once (fromAllBordering passes through the proxy like any argument).
    const result = await mcp.call('march', { to: target.id, fromAllBordering: true, percent: 100 });
    const sent = result.isError ? [] : text(result).sources.map(s => s.from);
    done.push(`${result.isError ? 'failed march' : 'marched'} ${sent.join('+') || '?'}→${target.id}`);
  }
  const box = text(await mcp.call('inbox', {})); // whatever arrived since the prompt was built
  if (box.messages.length) done.push(`read ${box.messages.length} more`);
  console.log(`Turn done at tick ${view.tick}.\nMEMORY: ${done.join('; ') || 'nothing to do'}; keep expanding into neutral land.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  mcp.close();
}
