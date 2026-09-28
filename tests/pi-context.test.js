import test from 'node:test';
import assert from 'node:assert/strict';
import { compactOldToolResults } from '../agents/pi/context-extension.js';

test('Pi context hook replaces old large tool outputs without changing the saved messages', () => {
  const long = 'game state'.repeat(200);
  const older = { role: 'toolResult', toolCallId: 'one', toolName: 'situation', content: [{ type: 'text', text: long }] };
  const recent = { role: 'toolResult', toolCallId: 'two', toolName: 'situation', content: [{ type: 'text', text: long }] };
  const original = [older, { role: 'assistant', content: [] }, recent];
  const result = compactOldToolResults(original, 1);
  assert.equal(result.trimmed, 1);
  assert.match(result.messages[0].content[0].text, /Older game tool output omitted/);
  assert.equal(result.messages[0].toolCallId, 'one');
  assert.equal(result.messages[2].content[0].text, long);
  assert.equal(original[0].content[0].text, long);
});
