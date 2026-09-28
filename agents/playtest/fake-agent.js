#!/usr/bin/env node
/** Test-only stand-in for an LLM CLI: one turn through the same logging MCP proxy, no model calls.
 * Reads the decision view, answers DMs/alliance chat from the prompt's INBOX, makes one legal march,
 * makes one deliberately invalid march on turn 1 (to prove rejection logging), and prints a MEMORY line. */
import { LocalMcpClient } from '../pi/mcp-client.js';

const prompt = process.argv[2] || '';
const spec = JSON.parse(process.env.PLAYTEST_FAKE_MCP || '{}');
const mcp = new LocalMcpClient(spec.command, spec.args, { ...process.env, ...spec.env });
const text = result => JSON.parse(result.content.find(c => c.type === 'text').text);
const done = [];
try {
  await mcp.initialize();
  const view = text(await mcp.call('decision_view', {}));
  const senders = [...prompt.matchAll(/(?:DM|ALLIANCE CHAT) from ([a-z-]+)/g)].map(m => m[1]);
  for (const from of [...new Set(senders)]) {
    const reply = await mcp.call('send_message', { channel: 'dm', to: from, text: 'Received; holding to our plan.' });
    done.push(`${reply.isError ? 'failed to answer' : 'answered'} ${from}`);
  }
  if (/^TURN 1 /m.test(prompt)) await mcp.call('march', { to: 'atlantis', from: view.own[0]?.id ?? 'nowhere', amount: 1 });
  const target = view.frontier.find(t => !t.requiresWar && t.sources.some(s => s.available >= 2));
  if (target) {
    const source = target.sources.find(s => s.available >= 2);
    const result = await mcp.call('march', { to: target.id, from: source.id, amount: source.available });
    done.push(`${result.isError ? 'failed march' : 'marched'} ${source.id}→${target.id}`);
  }
  console.log(`Turn done at tick ${view.tick}.\nMEMORY: ${done.join('; ') || 'nothing to do'}; keep expanding into neutral land.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  mcp.close();
}
