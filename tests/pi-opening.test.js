import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpening } from '../agents/pi/opening.js';

test('Pi opening accepts plain or fenced declarations within game limits', () => {
  const opening = { leaderName: 'Admiral Tea Kettle', openingMessage: 'The Channel has room for trade and a few bad jokes.' };
  assert.deepEqual(parseOpening(JSON.stringify(opening)), opening);
  assert.deepEqual(parseOpening(`\`\`\`json\n${JSON.stringify(opening)}\n\`\`\``), opening);
});

test('Pi opening rejects prose, missing fields and overlong declarations', () => {
  assert.equal(parseOpening('My leader is Kettle.'), null);
  assert.equal(parseOpening('{"leaderName":"Kettle"}'), null);
  assert.equal(parseOpening('{"leaderName":42,"openingMessage":"Hello"}'), null);
  assert.equal(parseOpening(JSON.stringify({ leaderName: 'A'.repeat(61), openingMessage: 'Hello' })), null);
  assert.equal(parseOpening(JSON.stringify({ leaderName: 'Kettle', openingMessage: 'A'.repeat(501) })), null);
});
