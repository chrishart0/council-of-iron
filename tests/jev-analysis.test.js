import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedAnalysis, wilson, summarizeStudyRun, summarizePositions } from '../agents/pi/study-analysis.js';

test('paired sign-flip calculation counts both tails and zero differences', () => {
  assert.equal(pairedAnalysis(Array(8).fill(1)).exactSignFlipTwoSidedP, .0078);
  assert.equal(pairedAnalysis([1, -1]).exactSignFlipTwoSidedP, 1);
  assert.equal(pairedAnalysis([0, 0]).exactSignFlipTwoSidedP, 1);
  assert.deepEqual(pairedAnalysis(Array(8).fill(1)).bootstrap95, [1, 1]);
  assert.deepEqual(pairedAnalysis([1, 2, 3]), pairedAnalysis([1, 2, 3]));
  assert.throws(() => pairedAnalysis([NaN]));
});
test('win intervals remain wide for eight games, including eight wins', () => {
  const [lo, hi] = wilson(8, 8); assert.ok(lo > .67 && lo < .68); assert.equal(hi, 1);
});
test('study exporter excludes private content and preserves incompletes as unknown outcomes', () => {
  const raw = { runId: 'test', country: 'britain', status: 'incomplete', error: 'PRIVATE ERROR',
    apiKey: 'SECRET KEY', lastResponse: 'PRIVATE CHAT', strategies: [{ objective: 'PRIVATE PLAN' }],
    actions: [{ type: 'chat', ok: true, text: 'PRIVATE CHAT' }],
    decisions: [{ tick: 1, error: 'PRIVATE ERROR', selectedAction: { type: 'chat', text: 'PRIVATE CHAT' } }] };
  const row = summarizeStudyRun(raw, 'jev'), text = JSON.stringify(row);
  assert.equal(row.result, null); assert.equal(row.ownIndustry, null); assert.equal(row.errorPresent, true);
  assert.equal(row.decisionErrors, 1); assert.equal(row.acceptedMessages, 1);
  for (const privateText of ['PRIVATE', 'SECRET']) assert.ok(!text.includes(privateText));
});
test('position consistency uses complete shuffled-position pairs without hiding failed calls', () => {
  const rows = [
    { position: 'a', repeat: 0, selector: 'jev', choice: 'x', heuristicChoice: 'x', wallMs: 200 },
    { position: 'a', repeat: 1, selector: 'jev', error: 'private provider response' },
    { position: 'a', repeat: 0, selector: 'llm', choice: 'x', heuristicChoice: 'x', wallMs: 3000 },
    { position: 'a', repeat: 1, selector: 'llm', choice: 'y', heuristicChoice: 'x', wallMs: 3000 },
  ];
  const result = summarizePositions({ positions: 1, rows });
  assert.equal(result.selectors.jev.errors, 1); assert.equal(result.selectors.jev.consistencyDenominator, 0);
  assert.equal(result.selectors.llm.orderConsistentPositions, 0); assert.equal(result.matchedCalls, 1);
  assert.ok(!JSON.stringify(result).includes('private provider response'));
});
