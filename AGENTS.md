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

## v0.4 review contract

The public replay/report is not the private action log. Keep public fields allowlisted, refuse live-match history requests, verify reconstruction against the saved final military state and score, and fail closed with saved scores intact if legacy history cannot be proved. Preserve materialized public archives across restart. Playback has no command capability. Per-country combat kills are not defined for shared battles; do not fabricate an attribution. Alliance score is the sum of final-member Prestige, not a new reward.

Run all Node tests plus `python tests/browser.py` (now includes the focused recorded-match review browser suite). The 630-tick handplay golden replay must still match without changing production balance. Read-only reserve/admission/development forecasts must be available to both browser and agent clients and clearly state assumptions. Map instances must have distinct SVG IDs and scoped selectors; hidden live and review maps must never paint each other.


## v0.7 full-screen contract (supersedes the v0.5 presentation contract)

`public/presentation.js` stays an allowlisted set of original decorative SVG fragments and a pure completed-battle signal selector. Never interpolate player text into SVG or HTML; new UI builds nodes and uses `textContent`. Keep country labels beside insignia.

The live match (players, spectators, lobby) is one full-screen stage: `#map` is exactly the viewport (100dvw×100dvh), the document never scrolls, and there is no framed board or permanent sidebar. Everything else floats over the map, stays compact and translucent, never permanently covers the map centre, and must not overlap another overlay at 1920×1080, 1366×768, 1280×720, 390×844, 844×390 or 768×1024. At 1366×768 at least 65% of the map stays uncovered with nothing selected. Layout: HUD strip on top (menu, country, ally and war chips, stats, clock, panel buttons, which become a bottom navigation bar on phones/tablets held upright); alerts top-left; right rail with the leaderboard above the persistent World history; map camera buttons and the command panel bottom-left. Safe-area insets apply. Review/replay keep their page layout.

Nothing opens until the player asks: a province click opens the order card (peek → half → full); Orders, Council and Dispatches are HUD buttons with `aria-expanded` and unread badges. The March submit stays form-associated (`form="move-form"`) in the commit dock outside any scrolling region, visible and unobstructed in every sheet size. Escape closes the top-most overlay (menu, war log, panel) and returns focus to its opener; HUD buttons move focus into the panel. Keyboard shortcuts (J, C, Q/E, M) never fire inside text entry, selects or dialogs. Keep the skip link and accessible names, including for icon-only buttons.

The World history is always available: rows are appended, never re-rendered; auto-scroll only when the reader is at the bottom, otherwise show "N new ↓"; new rows arrive clamped to four lines and shrink to two after a few seconds (immediately under reduced motion); clamped text expands by click, Enter or Space with `aria-expanded`. Reconnecting must not replay banners; banners stay brief, centred and `pointer-events:none`. Roster focus must survive polling.

Relations are public-only and shared: the HUD shows allies (alliance colour, "forming" dashed during the notice) and enemies; leaderboard rows show alliance bands and ⚔/⛓ relation markers; Council → Wars lists exactly `observation.wars` as side-vs-side fronts; the order card states the target owner's relation. Browser, CLI (`wars`, `leaderboard`) and MCP (`wars`, `leaderboard`) use the same DOM-free helpers (`public/relations.js`; `warsOf` in `public/leaderboard.js`). Camera moves pass the visible-area insets as an optional trailing argument; do not change `atlas.js` signatures incompatibly.

The full browser entry point also runs `tests/ui-browser.py`. Its paused fixtures and private stdin stepping (including the test-only alliance acceptance in the war room) are test-only. No production advance endpoint or new game rule is implied. Screenshots/GIFs of those fixtures must be labeled recorded-position UI, never passed off as a new live match.
