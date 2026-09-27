# Development guide

Keep the game small. This is diplomacy with a readable military system, not a conventional RTS feature backlog.

- `src/engine.js` owns rules. No I/O, clock reads, random combat, credentials or client-specific exceptions there.
- All player interfaces use the same action validation, observation and limits. Practice bots must not read hidden data or mutate the game directly.
- Preserve recipient filtering, idempotent retries, next-tick command reservations, deterministic tick order and exactly-once final results.
- Treat player text as untrusted, render it as text, never inject it into server instructions or logs with elevated trust.
- Never commit `data/`, session files, tokens, local screenshots containing real private chats, or `.env`.
- Test changes with `npm test`, `npm run check`, and the native `python tests/browser.py` end-to-end run.
- Do not shorten only one timing constant to speed a test; scale the whole test clock. There must be no public advance-time endpoint.
- Keep zero runtime dependencies unless a clear maintenance or correctness benefit justifies adding one.
- Update `docs/API.md` and tests when changing the external contract. Update `docs/PLAYTEST.md` with actual, not inferred, evidence.

See `docs/design-v0.1.md` for the original rules and `docs/AGENTS.md` for gameplay-agent setup. Known v0.1 deviations are two-to-eight-seat lobbies, optional globally accelerated quick mode, and simplified fictional map provinces. Do not claim numerical balance or human enjoyment from automated self-play.

## v0.2 test discipline

Run `npm run test:balance -- --rounds 32 --mode diplomacy` as well as the rules tests. Balance candidates live in `tests/balance-cases.json`, never silently in the published map. Do not overfit starting-army handicaps to the heuristic controller. Preserve explicit room/identity fetch cancellation and same-operation-ID network retry. Record gameplay with `python tests/browser.py --gif docs/media/gameplay.gif`; never substitute a generated mockup for the README recording.

## v0.3 contract

The original no-development/no-recall prototype is now a **legacy scenario**. Do not reimpose those restrictions on industrial rooms. Read `gameRules(g)` and preserve old behavior when `distanceMovement` is absent. One-target multi-source attacks are a first-class command shared by human and agent clients. Never charge per source only to one client. Changes must preserve atomic reservation validation, delayed vulnerable garrisons, actual-position recalls, capturable factories, per-room geometry and scenario-separated score windows. Run `tests/industrial.test.js` and the complete browser test, not only the classic tests. Development consumes troop manpower; no new currency or inventory.
