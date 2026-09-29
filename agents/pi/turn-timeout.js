export class TurnTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Pi turn did not finish within ${timeoutMs} ms plus abort grace.`);
    this.name = 'TurnTimeoutError';
  }
}

export async function promptWithDeadline(prompt, abort, timeoutMs, graceMs = 10_000) {
  let deadlineTimer, graceTimer;
  let timedOut = false;
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      void Promise.resolve().then(abort).catch(() => {});
      graceTimer = setTimeout(() => reject(new TurnTimeoutError(timeoutMs)), graceMs);
    }, timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve().then(prompt), deadline]);
    return { timedOut };
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(graceTimer);
  }
}
