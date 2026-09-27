# Full-screen spectator verification — 27 September 2026

The native `python tests/browser.py` run passed with no page errors. Its spectator check expanded the live map to the desktop and 390-pixel mobile viewports, exited with Escape, displayed a newly sent world dispatch as an escaped bubble, and found no private dispatch in the spectator view. The full live match, agent interaction and recorded-match review suites also passed. All 81 Node tests, `npm run check`, and the 32-round diplomacy balance run passed; the balance run reported zero invariant failures. These are automated checks, not a human playtest.

# Spectator mode verification — 27 September 2026

Local verification passed: 81 Node tests, `npm run check`, and a 32-round diplomacy balance run with zero invariant failures. The native `python tests/browser.py` run passed with no page errors. Its new browser check found a running match in the lobby, opened its read-only live view, saw all eight standings, and confirmed that a private dispatch visible to a seated player was absent for the spectator. The same run completed its live match, after-action review, and second-room industrial checks. This is automated browser and heuristic-agent evidence, not a human playtest.

# v0.4 review and feedback verification — 27 September 2026

The after-action feature and live explanatory controls do not change the industrial/classic battle, movement, recruitment, scoring or country-balance rules. The original 343-action hands-on match still reproduces its event digest and final result.

Local verification: **80 Node tests passed**, including exact public replay comparison at every tick from 0 through 630, all 75 private messages excluded, saved outcome/alliance sum reconciliation, troop ledger, classic/legacy behavior, lifecycle/privacy/scope checks, phase-aware forecasts and persistence. JavaScript syntax checks passed.

The full browser-plus-external-HTTP-agent playthrough passed with the new review workflow at completion. A focused recorded-match browser run separately checked all five tabs, exact slider states, playback, backwards seeks, event links, filtered charts, multiple maps without ID collisions, 390-pixel layouts, unsafe display text, score-only fallback and reopen behavior. No captured page errors occurred.

**Local Chromium navigation is restricted by the execution environment**, so those two local runs used the explicitly documented in-memory module render/Python HTTP bridge. They exercised actual server requests and DOM behavior, not native browser navigation/CSP. The native publication verification is recorded separately only when it actually completes. No live LLM or independent human participant was used, and replaying a recorded game is not another balance sample.

See [feature/report definitions](AFTER-ACTION.md) and the machine-readable evidence in `docs/testing/v04-local.json`.

## Native v0.4 verification

The [native publication run](https://github.com/chrishart0/council-of-iron/actions/runs/36300841635) passed all 80 Node tests and reproduced 64 seeded smoke games. It completed the actual-browser/external-agent playthrough and focused after-action suite, including exact backward scrubbing, report tabs, privacy, mobile layouts and legacy fallback. The README review GIF was captured from this native run. [Machine-readable receipt](testing/v04-native-ci.json).

## Earlier verification records

# v0.3 refinement test record

The current implementation adds an industrial 79-province scenario, local manpower investment, distance-based travel, atomic multi-source attack scheduling, timed recalls and a browser mode for each decision. The original map and saved-game behavior are preserved instead of silently migrating old matches to new rules.

**59 Node tests pass locally**, including new timing-boundary and full-modern-replay regressions. Syntax checks pass. The current refinement retained **2,368 complete heuristic simulation matches**; [balance report](BALANCE.md) and [machine-readable summary](testing/v03-summary.json). Counts exclude interrupted attempts and repeated CI verification. No live LLMs or independent-human enjoyment testing.

A complete local browser/CLI/API-agent run passed on the first industrial candidate using the explicit managed-browser HTTP bridge. It tested the new coordination, recall and construction controls in a second room. The **final scenario and three-mode UI also passed** the complete local bridge playthrough with no captured page errors. It produced 65 actual rendered GIF frames, including coordinated planning, group recall and investment. The final run included 421 battles and 969 manual army departures. Native verification is recorded separately when executed; the bridge is not proof of native origin/CSP behavior.

Local Chromium blocks URL navigation under its managed policy. The bridge uses actual Chromium rendering and the unchanged modules, forwarding fetch through the Python test process to the real local HTTP server. It does not modify browser policy or prove native navigation/origin/CSP behavior. The ordinary CI test uses real browser HTTP. Every accelerated browser run scales the whole simulation, not just movement or the deadline.

## Refinements caught by testing

The first scenario overpowered Germany and left Britain weak; later fresh-seed F validation rejected another candidate. The final candidate uses visible province assets, not an altered score formula. Multi-source controls initially sat too far down a long Orders pane; March/Coordinate/Develop are now explicit modes. The new movement model required removing old no-recall warnings, using per-game map retrieval, updating bot arrival forecasts, handling reservations for both development and delayed troops, and separating old/new standings. GUI group recall, captured-home returns, build interruption, invalid-source atomicity and persistence all have focused tests.

## Native v0.3 verification

The [native publication run](https://github.com/chrishart0/council-of-iron/actions/runs/36295149158) passed all 59 Node tests, reproduced both 256-match fresh-seed holdouts with identical aggregate results, and completed the actual-browser/external-agent playthrough. Coordinated arrivals, timed group recall and completed industry investment were exercised. The README GIF was recorded from this native run. [Machine-readable receipt](testing/v03-native-ci.json).

## Historical v0.2 test record

# Playtest record — v0.2

## Local verification, 26 September 2026 (America/New_York)

**41 Node tests passed**; JavaScript syntax checks passed. Six of seven newly added behavior regressions failed before their corresponding fixes; the cursor-pagination test already passed and was retained. An eighth new regression protects British map-counter placement.

The seeded campaign completed **3,488 retained-report matches**, including fresh-seed solo and diplomacy holdouts. No conservation, troop-validity, terminal-timing or score-pool invariant failures were reported. The [balance report](BALANCE.md) and [machine-readable summaries](testing/summary.json) give counts, seeds and limitations. These are heuristic controllers, not live LLMs or independent humans.

The expanded browser playthrough passed locally using the documented managed-browser bridge. It drives a browser USA seat, separate CLI/API Britain seat and six practice bots through orders, capture, reinforcement, alliance, DM, reconnect, mobile layout, a scored ending and a second room. Added checks cover real map clicks, Shift-click source selection, troop presets, keyboard tabs, leave-confirmation cancellation, unread state, and retained message drafts. Browser and external agent see the same final scores; no JavaScript page errors were recorded.

`tests/browser.py --gif docs/media/gameplay.gif` records actual rendered frames from that playthrough, with an explicit accelerated-clock/heuristic-agent label. It does not inject outcomes or manufacture gameplay frames. CI's ordinary browser path uses real HTTP navigation, origin/storage and served CSP. Consult the actual workflow result for native verification of this release; the local bridge alone is not evidence of native browser networking or CSP behavior.

### Fixed defects

A CLI-created new room no longer inherits the previous match's scoped credential. Changing CLI identity clears the old match. A coalition offer can progress when its last missing voter is eliminated. Declined/expired private offers do not expose cancellation details publicly. Attack previews account for the owner's reserved troops without leaking those reservations. Browser requests from old rooms/identities cannot overwrite the new seat's state. Two remote disconnected-polygon counter anchors were corrected. These fixes retain the original numerical game rules.

### Remaining boundaries

The world scenario is demonstrably uneven under the tested controllers, not competitively balanced. No live model was attached; no independent second coding agent or human enjoyment panel reviewed this pass. A small tools-only MCP implementation is tested through subprocesses, not certified against every client. Public deployment hardening, calibrated skill ranking, and normal-speed human/LLM response latency remain unproven.

---

## Native v0.2 verification

The [native publication run](https://github.com/chrishart0/council-of-iron/actions/runs/36289994282) passed 41 Node tests, repeated both 256-match holdouts with identical aggregate results, and completed the actual-browser/external-agent playthrough. It generated the checked-in README GIF from that native playthrough. [Machine-readable receipt](testing/native-ci.json).

## Historical v0.1 record


## Local verification, 26 September 2026

Environment: Node 22.16.0; Python 3.13; Playwright 1.57.0; Chromium. No paid model inference or subscription tokens were used.

**33 automated tests passed** through `npm test`, covering map connectivity/equal starting budgets, reservations and next-tick execution, deterministic two-/three-sided battles, allied ownership tie priority, recruitment arrows, command and chat budgets, admission/departure consent, elimination, maturity/scoring, deadline order, idempotency, privacy, HTTP permissions, SQLite restart and exactly-once results, CLI processes, and stdio MCP negotiation/tool execution.

A complete eight-policy simulation replayed from its accepted action log to the same final board, event history and scores. These practice policies are deterministic heuristics, not LLMs. This is evidence of mechanics and replay consistency, not model capability or game balance.

## Browser plus external-agent playthrough

A browser-controlled USA seat created the room, joined, and started alongside a separately registered CLI-controlled British seat and six built-in practice bots. The browser issued a real move through the shared action API, captured Mexico after travel/combat, set a recruitment route, proposed the Atlantic Accord, and exchanged private dispatches. The CLI accepted the alliance; the public notice elapsed before benefits appeared. After setup, an external Node agent process controlled Britain through the HTTP API until the match ended.

The game reached an early victory at **26:21 game time**. The Ottoman practice bot held the required territory; it received +700 Prestige and each other seat received −100. The browser and external agent saw identical final scores. Persistent experimental standings included the browser identity afterward. This was not a demonstration of successful human strategy: after the scripted interactions, the USA seat mostly defended passively.

Other browser checks: reconnecting the same identity; private-message delivery; spectator API exclusion of DMs; injected HTML rendered as text; world/Europe zoom; a 390-pixel mobile layout with no document-level horizontal overflow; no captured JavaScript page errors. Screenshots and a machine-readable report were generated by the test harness.

### Important local environment limitation

The managed Chromium supplied in the local execution environment blocks URL navigation. The local run therefore used the explicit `--bridge` test mode: real Chromium rendering of the unchanged app module in an in-memory document, with fetch requests forwarded by the Python runner to the actual local HTTP server. Browser policy was not modified.

That run tests DOM behavior and integration with the real server, CLI and agent. **It does not establish native browser navigation, browser-network security, CSP enforcement or real-origin localStorage behavior.** The normal `python tests/browser.py` path uses native HTTP navigation; the repository's GitHub Actions workflow runs that normal path and publishes its result and screenshots separately. Consult the actual workflow result rather than treating this local report as proof that CI passed.

The browser harness accelerates the whole simulation clock 12× solely to finish a full match in a test run. It does not inject final outcomes, mutate the board, or expose a public time-advance endpoint. It does not test ordinary-speed LLM latency fairness.

## Native-browser CI verification

The normal, non-bridge browser test also **passed** on GitHub Actions for implementation commit `a1555ccaa370956333f6d0139f27f1568c2c0780`, on 26 September 2026. The same job passed the 33 Node tests and JavaScript syntax checks. Run: https://github.com/chrishart0/council-of-iron/actions/runs/36270303625

That run used real Chromium HTTP navigation, the real page origin and localStorage, the delivered CSP, a separate CLI process, and an external HTTP agent through match completion. It also disabled `crypto.randomUUID` during browser actions to exercise the command-ID fallback needed on plain-HTTP LAN origins. The workflow uploaded screenshots and its JSON report as the `browser-playtest` artifact. This closes the local bridge's normal-browser integration gap; it is not a security audit or a live-LLM trial.

## Findings and fixes

During integration, fixed event handling that could suppress form-button defaults, cleared the old diplomatic inbox when changing local identity, keyed rendered inboxes by room and country to avoid stale messages, and added a room-link fallback for browsers that deny clipboard access, and supported command IDs on plain-HTTP LAN origins. Tests explicitly exercise private messages, source ownership, scoped credentials, route behavior and command retries.

The map is usable and connected, but not demonstrated balanced. Southern expansion routes and crowded European starts deserve specific human/agent playtesting. An expansion-first bot winning from the Ottoman start is a reason to inspect that position, not evidence that it is a statistically proven best country.

## What remains untested or unproven

Actual independent human participants have not rated enjoyment or legibility. No attached live LLM has been tested, and no claim is made about vendor-specific MCP setup, model bias or negotiation quality. The tools-only MCP adapter has subprocess protocol tests, not certification against every client. Docker configuration has not been built locally. Public deployment hardening, load testing, moderation, account recovery, operator verification and calibrated rankings are outside this prototype.

Before promoting this to a competitive game, run ordinary-speed matches with real humans and several independently controlled LLM agents; rotate countries, record latency, inspect coalition-size and late-join behavior, and change map connectivity before adding economic complexity.
