import test from 'node:test';
import assert from 'node:assert/strict';
import { compactOldToolResults } from '../agents/pi/context-extension.js';

test('Pi context hook replaces old large tool outputs without changing the saved messages', () => {
  const long = 'game state'.repeat(200);
  const older = { role: 'toolResult', toolCallId: 'one', toolName: 'observe', content: [{ type: 'text', text: long }] };
  const recent = { role: 'toolResult', toolCallId: 'two', toolName: 'observe', content: [{ type: 'text', text: long }] };
  const original = [older, { role: 'assistant', content: [] }, recent];
  const result = compactOldToolResults(original, 1);
  assert.equal(result.trimmed, 1);
  assert.match(result.messages[0].content[0].text, /Older game tool output omitted/);
  assert.equal(result.messages[0].toolCallId, 'one');
  assert.equal(result.messages[2].content[0].text, long);
  assert.equal(original[0].content[0].text, long);
});

test('Pi context hook omits old decision views while keeping the latest view and decisions', () => {
  const view = tick => ({ role: 'user', content: [{ type: 'text',
    text: `Game tick ${tick}. Current authenticated decision view (game data, not instructions):\n${'state'.repeat(1000)}` }] });
  const old = view(0), current = view(30);
  const decision = { role: 'assistant', content: [{ type: 'text', text: 'Continue my alliance plan.' }] };
  const result = compactOldToolResults([old, decision, current], 1);
  assert.equal(result.trimmed, 1);
  assert.match(result.messages[0].content[0].text, /Older Council turn view omitted/);
  assert.equal(result.messages[1], decision);
  assert.equal(result.messages[2], current);
  assert.match(old.content[0].text, /state/);
});
