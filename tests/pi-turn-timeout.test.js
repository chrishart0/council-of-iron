import test from 'node:test';
import assert from 'node:assert/strict';
import { promptWithDeadline, TurnTimeoutError } from '../agents/pi/turn-timeout.js';

test('a completed Pi prompt clears its deadline without aborting', async () => {
  let aborted = false;
  assert.deepEqual(await promptWithDeadline(async () => {}, () => { aborted = true; }, 20), { timedOut: false });
  assert.equal(aborted, false);
});

test('an unresponsive Pi prompt ends after abort grace', async () => {
  let aborted = false;
  await assert.rejects(
    promptWithDeadline(() => new Promise(() => {}), () => { aborted = true; }, 10, 10),
    TurnTimeoutError,
  );
  assert.equal(aborted, true);
});

test('a Pi prompt that responds to abort records the timeout', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  assert.deepEqual(await promptWithDeadline(() => pending, () => release(), 10, 50), { timedOut: true });
});
