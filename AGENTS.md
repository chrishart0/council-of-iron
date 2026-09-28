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

The public replay/report is not the private action log. Keep public fields allowlisted, refuse live-match history requests, verify reconstruction against the saved final military state and score, and fail closed with saved scores intact if legacy history cannot be proved. Preserve materialized public archives across restart. Playback has no command capability. Per-country combat kills are not defined for shared battles; do not fabricate an attribution. Alliance score is the sum of final-member Prestige, not a new reward. The only recipient-filtered exception: rooms created through `POST /api/games` after v0.7 carry `rules.revealAllianceChatAfterMatch: true` (never defaulted in `createGame`, so legacy/saved/fixture rooms never reveal), announce it in the join `notices`, and only once finished add `report.allianceChat = [{ tick, from, side, sideName, text, untrusted: true }]` (coalition channel only, side/name at send time, no event IDs or sequence numbers) plus `allianceChatRevealed`; DMs, offers, orders, receipts and the action log are never published, and live observations stay recipient-filtered.

Run all Node tests plus `python tests/browser.py` (now includes the focused recorded-match review browser suite). The 630-tick handplay golden replay must still match without changing production balance. Read-only reserve/admission/development forecasts must be available to both browser and agent clients and clearly state assumptions. Map instances must have distinct SVG IDs and scoped selectors; hidden live and review maps must never paint each other.


## v0.8 one-map contract (supersedes the v0.5 and v0.7 presentation contracts)

`public/presentation.js` stays an allowlisted set of original decorative SVG fragments and a pure completed-battle signal selector. Never interpolate player text into SVG or HTML; new UI builds nodes and uses `textContent`. Keep country labels beside insignia.

- **Single view.** The live match (player, spectator, lobby) is one full-screen map: `#map` is exactly the viewport, the document never scrolls, everything else floats over it and must not overlap another overlay at 1920×1080, 1366×768, 1280×720, 390×844, 844×390 and 768×1024. At 1366×768 ≥65% of the map stays uncovered idle and ≥62% with a card peeking. Keep the map rendering, zoom, counters and borders; counter taps win over army markers.
- **Two nouns, one card.** A province opens the order card; a country (leaderboard row, powers standard, owner line, rail link) opens the country card; your standard opens your alliance card. It is one `#card` with two levels (peek, expanded). Do not reintroduce Orders/Council/Dispatches panels, order modes, a second HUD row or an alerts stack.
- **One primary action per card**, `#primary`, whose label says exactly what will happen (`Attack X with N`, `Reinforce X with N`, `Declare war on C & send N`, `Call war vote on C`, `Accept alliance`, `Offer peace`, `Recall` …). It stays visible, unobstructed and outside any scrolling region. War always goes through a confirmation that lists everyone you will be at war with; declare-and-march stays one atomic order (`declareWar`) with the same-opId retry.
- **Drag to move with a tap fallback.** Dragging from your province's counter draws a snapped order arrow (legal neighbours lit, others dimmed, `troops · ETA`); tap-tap and target-first reach the same card; Enter/Escape work from the keyboard. More of your provinces beside the target are added by tapping them (one `attack` order), not by a mode. The amount is one control (slider + 25/50/75/100%).
- **One attention badge** (`#attention`) beside your standard: decisions waiting plus unread private messages; it opens the first item in its card. Read state is per item (a set of seqs), never a single max cursor. Toasts for items that affect you carry direct actions and are never replayed on reconnect.
- **≤7 persistent/common surfaces on a phone:** map, HUD, powers strip, camera, history, card, popups; rare things live in ☰ (views, war log, sound, key, room, identity, tips). **No popups except for things that affect you** (banners, notices, your own order toasts); big banners stay brief, `pointer-events:none`.
- The history rail is history only (All/World/Mine), appended not re-rendered, "N new ↓" when scrolled up, rows clamp to four lines and settle to two. Composers keep the `.composer` class and `data-voice`; the voice module finds `button[type=submit]`.
- Spectators get the same cards read-only. The replay uses the same leaderboard and a history rail up to the scrubbed tick (public report data only; alliance chat only from `report.allianceChat` in rooms that announced it), rows seek, and effects play only when playing forward.
- Relations stay public-only and shared (`public/relations.js`, `warsOf` in `public/leaderboard.js`) for browser, CLI and MCP. Camera moves may pass visible-area insets as the optional trailing `{insets}` argument; do not change `atlas.js` signatures incompatibly (new atlas hooks are optional options).
- **Turning around.** An own moving army's card (and a returning army's province card row, the Your-orders list and the "troops turned back" notice) offers one primary `Recall → Home` or `Turn around → Target (arrives mm:ss)` with a one-line preview; it is the shared `turn_around` order (`recall` stays for API compatibility). Automatic turn-backs of your own troops are a personal notice plus a Mine history row that names the engine's `reason`; never invent a cause the event does not carry.
- Run `tests/ui_tasks.py` walkthroughs (inside `tests/ui-browser.py`) and keep their interaction bounds.

The full browser entry point also runs `tests/ui-browser.py`. Its paused fixtures and private stdin stepping (including the test-only alliance acceptance in the war room) are test-only. No production advance endpoint or new game rule is implied. Screenshots/GIFs of those fixtures must be labeled recorded-position UI, never passed off as a new live match.
