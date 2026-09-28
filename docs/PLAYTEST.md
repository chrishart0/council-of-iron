# Long-distance group marches — 27 September 2026

The updated rules passed 93 Node tests and `npm run check`. Focused tests sent 100% of available troops from West US and Central US to East US in one reserved group order, leaving one troop at each source; they also verified a distant source joining an attack through controlled intermediate land and preserved adjacency when `distanceMovement` is absent. The 32-round diplomacy heuristic run completed with zero invariant failures. This simulation is a regression check, not evidence of human enjoyment or numerical balance.

The native `python tests/browser.py --gif docs/media/gameplay.gif` run passed the live gameplay, recorded review and focused UI suites with no page errors. The browser selected two owned sources, defaulted the group to 100% available, previewed the shared arrival and committed one long-distance transfer. The actual live-match recording contains 61 frames at the whole-clock 12× test scale; the recorded-position UI fixture remains separately labeled.

# Opening, combat forecasts, development defense and faster marches — 27 September 2026

The existing eight-model match `5b3f1596` was inspected as a recorded game. Qing’s order to send 20 troops from North China to Manchuria was chosen from an observation at tick 183, when Manchuria was Qing-owned. The model decision was accepted at tick 238 after Japan had captured the province; a visible Japanese reinforcement of 20 was already due at tick 298, before Qing’s arrival at tick 311. Manchuria had 24 defenders on Qing’s arrival. This is evidence of stale observation and missing arrival-aware guidance for that order, not proof that the model misunderstood Risk odds in general. The agent handoff and model runner now provide current and conditional arrival odds, and the runner discards a military order when the destination owner changes during model inference.

The revised engine passed **85 Node rules and HTTP tests** and JavaScript syntax checks, including exact dice forecasts with industry defense, known inbound reinforcements, allied troops joining an active battle, opening messages and timeouts, and public-archive filtering of introductions. The 32-round seeded diplomacy heuristic run (seeds 1000–1031) had zero invariant failures, mean 11.91 developments, mean first battle tick 17.16 and mean match duration 1268.78 ticks. Its country outcomes were uneven; the heuristic sample is a regression signal, not evidence of competitive balance or human enjoyment.

The native `python tests/browser.py --gif docs/media/gameplay.gif` run passed live gameplay, recorded review and focused UI suites with no captured page errors. The 12× whole-clock browser match finished with a French solo decisive win and produced 70 actual gameplay frames. A second two-seat room exercised opening introductions, recall and level-II construction without practice-bot intervention. The focused UI suite clicked a recorded active battle to inspect its odds and per-roll losses. Its fixture uses the original saved movement/development rules to preserve the historical handplay board; the recorded-position screenshot is not presented as a new live match.

# Eight-model normal-speed match — 27 September 2026

An experimental eight-seat room (`5b3f1596`) ran for all 1,800 ticks at normal wall-clock speed on `192.168.1.216:3107`. All seats were public AI agents with distinct usernames and ignored local controller folders: Grok 4.6/Britain, Grok 4.7/France, Sonnet 5/Germany, Luna-6 Xhigh A/Russia, Luna-6 Xhigh B/Ottoman, Luna-6 Xhigh C/Qing, GPT-6-Sol/USA and Opus 5.5/Japan. Grok used Grok CLI, Claude models used Claude Code, and the OpenAI models used Codex CLI. Every game command went through the ordinary HTTP client and server validation. The operator restarted the controller harness during the match to clarify raw HTTP action fields and to raise a Grok timeout; later Grok 4.7 used low reasoning effort after repeated four-minute timeouts. No operator-issued game commands or accelerated clock were used. These changes make this one run unsuitable as a controlled model comparison.

The authoritative deadline result gave the Eastern Compact (Germany 49 industry, Russia 37) first place and 400 team points: Germany received 220.99 and Russia 179.01. The USA (43 industry) received 200 for second. The Mediterranean Entente (France 21, Ottoman 15) received 200 for third, split 112.55/87.45 by their industry-weighted shares. Britain, Japan and Qing received no payout. The Entente formed late enough to compete for a place but early enough for both members to finish with full allegiance tenure. Its Ottoman member improved from a zero-payout solo position to 87.45 points, though still below the 100-point Prestige baseline.

The saved public review reports `historyAvailable:true` and 72 disclosed messages: 31 direct, 38 alliance and three world dispatches. It reconstructs two activated alliances, ten war declarations, two accepted peace treaties, 60 battles, 50 captures and eight industry-damage events. A native Chromium smoke check opened this actual report, displayed all 72 messages across 15 conversation filters, searched them, and found no page errors or document overflow at 390 pixels. This is actual model diplomacy and combat in one match, not evidence of numerical balance or human enjoyment. Median decision latency varied substantially by controller; Grok 4.7 completed 12 accepted commands and hit three timeouts, so country/model ranking from this room is confounded by response time as well as strategy.

# Strength-weighted coalition scoring and deadline prizes — 27 September 2026

The revised rules passed **79 Node tests** and `npm run check`. Focused score tests verified that a 5% industry contributor to a two-member coalition receives about 10% of its decisive prize before tenure adjustment; the decisive pool sums to `100 × seats`; the deadline allocates 50%/25%/25% to first/second/third; tied second/third sides split their occupied slots; tied first draws; and an unfilled prize slot remains unawarded. The historical handplay finished on the same tick with the same military board, troop ledger and action count; only its score-bearing state and final event hashes changed under the new formula. The public review reconstructed every tick and retained the saved final scores.

The required 32-round diplomacy heuristic simulation (seeds 1000–1031) completed with **zero invariant failures**: 27 games ended by a 60% hold and 5 at the deadline; winning sides contained 1, 2, 3 and 4 countries in 2, 5, 15 and 10 games respectively. Realized payout per winning member averaged 320, 151.81, 174.73 and 148.59 points for those respective alliance sizes, including zero-strength members who earned no share. These policy outcomes are a regression and incentive sanity check, not evidence of human enjoyment or numerical country balance.

The native `python tests/browser.py --gif docs/media/gameplay.gif` run passed its live gameplay, recorded after-action and focused UI suites with no captured page errors. The live browser match ended in a French solo decisive win at tick 1637; its recording contains 78 actual rendered frames with a whole-clock 12× test scale. The recorded review displayed weighted individual scores, alliance aggregates, exact replay and eligible public AI conversation threads. A focused review rerun after the final placement-label change also passed with no page errors.

# Public agent conversations in the after-action viewer — 27 September 2026

The public/private seat choice and completed-match diplomatic wire passed 75 Node tests and `npm run check`. The 32-round diplomacy heuristic run completed with zero invariant failures. The native `python tests/browser.py --gif docs/media/gameplay.gif` run passed its recorded-review, focused UI and live gameplay suites with no captured page errors. The review browser checked public thread filtering, search, exact-tick jumps, HTML-inert message text, mobile layout, and exclusion of private dispatches. The live browser match ended at tick 1800 with a French solo deadline win; the recorded GIF contains 85 actual rendered frames at a whole-clock 12× test speed. This verifies the disclosure mechanism and browser behavior, not model diplomacy quality or human enjoyment.

# War, peace, multi-round combat and transit verification — 27 September 2026

After integrating the v0.5 command-table UI, 72 Node tests passed and `npm run check` passed. Focused new tests exercised peaceful attack rejection without reservation, coalition majority war and peace votes, 60-tick expiry, automatic treaty recall, delayed Risk-style battle rounds, small-battle industry protection, large-battle damage, and allied transit without ownership transfer. The 32-round diplomacy heuristic balance run completed with zero invariant failures; that is a regression sample, not evidence of human balance or enjoyment.

The native browser gameplay playthrough, recorded-match review suite, and focused command-table suite passed after adapting their recorded fixtures to the new war and economic victory rules. The final gameplay run recorded 62 real browser frames in `docs/media/gameplay.gif`. Browser and CLI actions, alliance consent, private/public chat filtering, spectator view, coordinated orders and recalls, responsive layout, and exact review playback were exercised. The focused UI suite reported no page errors. A large-battle probe exposed correlated seeded dice that made the defender effectively unbeatable; an avalanche mixing step corrected the dice, and the focused large-capture test passed afterward. The final native browser run passed after the dice change, including gameplay, recorded-match review, and focused command-table checks.

# Economic victory verification — 27 September 2026

After changing victory to 60% of active industry, `npm test` passed 62/62 Node tests and `npm run check` passed. Focused rules tests covered victory through a completed upgrade without conquest, a countdown broken by an opponent upgrade, and a deadline decided by industry despite fewer provinces. The 32-round diplomacy balance run completed with zero invariant failures; it is an automated heuristic sample, not evidence of human balance or enjoyment.

The native `python tests/browser.py --gif docs/media/gameplay.gif` run passed its live browser, CLI/external agent, and recorded-match review suites with no captured page errors. The final rerun recorded 84 frames of actual gameplay. Its live match ended with an Ottoman solo victory by economic output; a prior successful run recorded 85 frames and ended with a German solo victory. The earlier recorded handplay input now ends at tick 530 under the new rule; all 295 accepted actions before that finish replayed exactly, the public review reconstructed every tick, and private messages remained excluded from the review.

# v0.5 command-table verification — 27 September 2026

**86 Node tests and JavaScript syntax checks passed locally.** Four new unit tests cover eight distinct decorative insignia, safe fallback for malicious/unknown SVG lookup names, factual battle notifications, and suppression of old/future/unrelated/spectator events. The original 343-action golden game, every public historical tick, privacy and scoring tests remain passing.

The complete local browser/CLI/API-agent playthrough passed, including docked troop submission, coordinated arrivals, recalls, construction, chat, reconnect and a final result. The recorded-match review suite passed. The new focused UI suite passed six groups of assertions: desktop viewport fit, retained roster focus and the event drawer, command modes/disclosures, actual battle-loss/defense notifications, responsive layouts/faction selection, and result/replay identity separation. No captured JavaScript page errors occurred in any of the three suites.

The local environment restricts Chromium navigation. Those runs used the existing **explicit bridge** (unchanged browser policy, real modules, real HTTP server); they do not establish native origin/storage/CSP behavior. Native verification is recorded separately when completed. The focused test resumes a recorded match using a private test-process channel, not a public clock API and not another independent game.

**64 seeded smoke games completed with zero invariant failures**, 32 solo from seed 950000 and 32 diplomacy from 960000. This was a regression check, not a new balance-selection campaign. Engine, maps, movement, forecast and replay-rule files are byte-unchanged. No claim of improved country balance or human enjoyment is made.

During visual review, fixed the primary attack action falling below a 1366×768 viewport by placing it in a proper non-scrolling command dock. Replaced zoom-amplified diagonal shading (which looked like an occupation indicator) with fixed-screen fine stipple. Removed a stale room-change toast, hid the inapplicable War log button during review, kept roster focus stable through polling, and separated province-label decluttering from counter visibility. Recruitment controls now require expanding their named section; the full browser test follows that user interaction.

[Design rationale and references](UI-DESIGN.md) · [Local machine-readable verification](testing/v05-local.json)

The first native UI run passed all browser suites but refused publication because master advanced to `125cf3c` with spectator features. Those changes were merged rather than overwritten. The integrated build preserves full-screen public spectating and escaped message bubbles, adds an explicit authenticated Resume action, and checks its credential scoping. Final integrated verification is recorded separately below.

## Native v0.5 integrated verification

The [native publication run](https://github.com/chrishart0/council-of-iron/actions/runs/36341145508) passed 86 Node tests and reproduced all 64 seeded smoke games. All three actual-browser suites passed: complete gameplay with an external agent and public spectating, exact after-action review, and focused command-table interactions including battle signals, docked controls, roster focus and responsive layouts. No captured page errors occurred. Concurrent spectator features and their tests are preserved; authenticated Resume remains distinct from public Spectate. README screenshots and GIFs were recorded by that native run. [Machine-readable receipt](testing/v05-native-ci.json).

## Earlier verification records

# Full-screen spectator verification — 27 September 2026

The native `python tests/browser.py` run passed with no page errors. Its spectator check expanded the live map to the desktop and 390-pixel mobile viewports, exited with Escape, displayed a newly sent world dispatch as an escaped bubble, and found no private dispatch in the spectator view. The full live match, agent interaction and recorded-match review suites also passed. All 81 Node tests, `npm run check`, and the 32-round diplomacy balance run passed; the balance run reported zero invariant failures. These are automated checks, not a human playtest.

# Spectator mode verification — 27 September 2026

Local verification passed: 81 Node tests, `npm run check`, and a 32-round diplomacy balance run with zero invariant failures. The native `python tests/browser.py` run passed with no page errors. Its new browser check found a running match in the lobby, opened its read-only live view, saw all eight standings, and confirmed that a private dispatch visible to a seated player was absent for the spectator. The same run completed its live match, after-action review, and second-room industrial checks. This is automated browser and heuristic-agent evidence, not a human playtest.

# Local four-agent and LAN playtest — 27 September 2026

On a local Node 22.22.2 server, four separate `gpt-6-luna` high-effort controllers joined a quick experimental industrial room (`895f000d`) as USA, Britain, Germany and Ottoman. Each used its own match session and the regular client/API. The room ran to its tick-1800 deadline. The authoritative outcome and public review agreed: Germany won solo with 25 provinces, a 400 payout and 300 Prestige; Britain had 23 provinces, USA 19 and Ottoman 12, each with −100 Prestige. The public review reported `historyAvailable:true`, and its exact-tick replay was available at tick 1800. This was one same-operator test match, not a balance estimate or an independent competitive trial.

`npm test` passed 80/80 tests initially and 81/81 after the UI additions in this workspace; `npm run check` passed. `npm run test:balance -- --rounds 32 --mode diplomacy` completed with zero invariant failures. The native `python tests/browser.py` run passed before and after the LAN defaults, including its complete browser/CLI/external-agent playthrough and focused after-action suite, with no captured page errors. After setting LAN defaults, the server listened on `0.0.0.0:3107`; HTTP health and the saved review returned successfully through `192.168.1.216:3107`, and Chromium opened that address in Review state without page errors. A separate Docker bridge container also received HTTP 200 from the LAN IP. UFW was active, but its rule set required administrator access and an independent physical device connection was not verified.

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

# Practice lobby recovery — 27 September 2026

The live room `15c7f20e` on port 3108 was observed through its public API while still in the lobby: all eight countries were held by practice bots and no human seat was present. The service runs from the separate `council-ui-fullscreen` worktree, so this checkout's fix was not deployed to that room during verification.

In this checkout, 88 Node tests passed. A focused HTTP regression confirmed that filling bots before joining takes the host's selected country, that an older full-bot lobby lets only its host claim a bot seat, and that the claimed match starts and produces a verifiable public review. `npm run check` passed. The 32-round diplomacy heuristic run reported zero invariant failures; it is a mechanics regression, not evidence of numerical balance or human enjoyment.

The native `python tests/browser.py` run passed the live gameplay, recorded review, and recorded-position UI suites with no captured page errors. Its new browser check filled a third room before a separate join, saw one human and seven bots, and started opening. The final timed browser run ended at tick 1658 with a coalition victory; all three browser suites passed with no page errors. Browser artifacts were written under `/tmp/council-practice-recovery-browser-final`, not committed.

# Pi model integration — 28 September 2026

The Pi harness played isolated Britain seats against seven ordinary practice bots. The first local-Qwen quick room (`6831a26b`) finished at tick 1686 with France dominating: 25 Pi tool calls, five rejected calls (two attacks before war, one unaffordable development, one development in a lost province, and one after finish), six accepted actions, and Britain Prestige −100. After the harness allowed multiple actions per turn and the MCP move description stated the war requirement, a second quick room (`1ae1cbff`) finished at tick 1800 with France first and Britain third: 43 tool calls, four rejections all after the match had finished, 12 accepted actions, and Britain Prestige 100. These are different bot games and do not isolate the cause of the improvement.

Luna x-high in Pi played a normal-speed room (`1270ff04`) to a decisive France–Britain coalition win at tick 1090. Its 70 tool calls had zero failures and it committed 14 accepted actions. Britain received −63.76 Prestige despite being on the winning side: its final victory share was 15.1% and its alliance maturity was 0.3. This is one game, not a skill ranking.

Luna x-high in Codex completed a separate normal-speed Council-MCP room (`4ebdaee2`) at tick 875. Britain joined France's winning coalition, took 20.5% of its victory share, and received −50.79 Prestige after the maturity adjustment. The Codex stream recorded 45 completed Council MCP calls without a tool error; seven game action HTTP requests were accepted. The independent maps and bot decisions mean this is an integration and latency comparison, not an equal-position contest.

A second Pi Luna normal-speed room (`14decd34`) reached the tick-1800 deadline. Britain finished in the winning coalition with 31.9% victory share and 27.57 Prestige. Pi recorded 105 tool calls, five failures, and 29 accepted actions among 32 attempted actions. The failures were an attack plan before war, an arrival scheduled too early, a plan exceeding available troops, an invalid allied transit path, and a move after the match ended. Both clients completed normal-speed games and negotiated winning alliances, but these few independent bot rooms do not establish which client plays better.

An additional configured vLLM profile completed a quick room (`a74c2867`) at tick 1144. It made 19 Pi tool calls with zero failures and three accepted actions; France dominated and Britain earned −100 Prestige. Its settings live in the ignored local `.env`, and its run record is also ignored.

The same external endpoint later returned HTTP 500 on a minimal chat completion and then reset a connection. Its attempted normal-speed rooms were stopped, so no normal-speed result is claimed for that profile. The profile loader did resolve its 1,048,576-token configured window and chat-completions transport; that is a configuration check, not a context-length inference test.

The local Qwen model's advertised 262,144-token context was exercised with a 260,056-token input without truncation. In the measured full-GPU configuration, its process peaked at 24,200 MiB of GPU memory and a short decode measured 75.4 tokens per second. The Codex Qwen comparison's first direct-MCP attempt did not expose Council gameplay tools to the model, so it is excluded from gameplay results. A distinct Codex CLI fallback quick room (`4be5d632`) reached a deadline result with 19 accepted game actions and Britain Prestige 100; the CLI interface differs from Pi's 25 separate Council MCP tools. A second CLI fallback quick room (`63463a6a`) recorded four game action HTTP calls, all accepted, and 44 shell calls, one with a nonzero exit; Britain again earned 100 Prestige at the deadline. These independent rooms cannot rank the model clients.

For this integration work, 96 Node tests and `npm run check` passed. The 32-round diplomacy regression had zero invariant failures. The native browser suite passed its live, review, and recorded-position UI sections with no page errors. Automated self-play does not establish numerical balance or human enjoyment.

# Agent client benchmark iteration — 28 September 2026

The benchmark harness now records authoritative final Prestige, accepted actions, failed tool calls, reported token use, first accepted action and model-turn wall time in ignored raw files. The tracked `agents/pi/benchmarks.json` contains only aggregate allowlisted fields, and `agents/pi/bench.html` plots them over time. Pi uses its native extension loader with a local context hook that removes old large tool results from the next model request while retaining the saved transcript. Both clients can use the same combat seed in separate test rooms; this fixes combat rolls for a given state but does not force opponents to make the same decisions.

In the `pair01` quick-room baseline, Qwen Pi earned −100 Prestige with 22 failed calls in 113, while Qwen Codex CLI earned 100 Prestige with zero accepted game actions. Luna Pi earned 100 Prestige with no failed calls in 33; Luna Codex MCP also earned 100, with six accepted game actions. The agents faced the same bot policy and room seed, but their own actions changed the board, and Codex Qwen used a CLI fallback instead of Council MCP.

The Pi changes added a concise `situation` view, `strategic_options.readyDevelopments`, payable-source guidance, a 120-second turn cap, persistent/fresh session choices, and old-result context trimming. On `pair02`, Qwen Pi earned **167.72 Prestige** in a France–Britain coalition, with 14 accepted actions, **2 failed calls in 39**, 673,852 total reported tokens (223,008 uncached), and its first accepted action at 9.34 seconds. The context hook trimmed 257 old tool responses during model requests. Qwen Codex CLI earned **−42.38 Prestige** in a different Germany–Britain coalition on the same seed, with four accepted game actions, **0 failed calls in 52**, 1,808,069 total reported tokens (54,289 uncached), and its first action at 70.44 seconds. Pi won this one comparison on score, total tokens and first-action latency; Codex had fewer failed calls and uncached tokens. The two Qwen Pi failures were a war vote after its offer expired and a move after the match finished.

The configured external profile became reachable again and completed an isolated quick Pi room (`a09b0d68`): 26 accepted actions, **3 failed calls in 83**, 1,530,998 reported total tokens, and −100 Prestige after Germany dominated at tick 1727. Its private endpoint and provider identity remain only in ignored config and raw run files; the published benchmark uses the anonymous `external` group.

On `pair02`, Luna Pi and Luna Codex MCP both earned −100 Prestige after separate German victories. Pi made two accepted actions, had three failed calls in 22, used 502,800 total reported tokens, and acted first at 73.87 seconds. Codex made one accepted action, had one failed call in 15, used 672,721 total reported tokens, and acted first at 246.1 seconds. This quick-clock setting curtailed Luna x-high responses; Pi's first two turns reached the 120-second cap.

On `pair03`, Qwen Pi earned **163.36 Prestige** in a winning coalition; Qwen Codex CLI earned **100** at the deadline as an independent side. Pi had seven accepted actions, six failed calls in 35, 530,647 total reported tokens (99,335 uncached), and a first action at 20.21 seconds. Codex had two accepted game actions, 13 failed shell calls in 98, 4,791,538 total reported tokens (75,151 uncached), and a first action at 242.19 seconds. Pi thus beat Codex on Prestige, failed calls, total tokens and first-action time in this seed, though its uncached token count was higher. The six Pi failures included duplicate/expired war motions, an attack before war, unavailable troops, and a development attempt after finish. After this run, war and troop-availability guidance was clarified for later trials; it did not affect `pair03`.

On `pair03`, Luna Pi earned −55.45 Prestige in a coalition while Luna Codex MCP earned −100 after a separate French victory. Pi had three failed calls in 21, 309,439 total reported tokens, and first acted at 45.25 seconds; Codex had two failed calls in 23, 1,060,943 tokens, and first acted at 106.95 seconds. The quick clock and different player decisions still limit what this single paired seed proves.

The clarified war and troop guidance was used in Qwen `pair04`. Pi issued 12 accepted actions with **zero failed tool calls or rejected orders** in 47 calls, but finished at −51.10 Prestige after sharing a deadline prize in a smaller coalition. Codex CLI earned 100 Prestige as a solo side, with 15 accepted orders, four failed shell calls in 32, and seven rejected game orders. Pi used 828,609 total reported tokens versus Codex's 996,873 and first acted at 21.94 versus 45.42 seconds. Reducing tool errors did not itself improve strategy or final score. A subsequent MCP change made `strategic_options` display the strength-weighted point share and conditional full-maturity Prestige for each possible independent partner, to clarify the alliance cost before proposing one.

Luna Pi with a fresh session each turn in `pair04` finished at −100 Prestige. It made three accepted actions, had two failed calls in 28, and first acted at 159.55 seconds after its first 120-second turn ended without any action. Luna Codex MCP in the same seed also earned −100, with two accepted actions, zero failed calls in 19, and a first action at 102.87 seconds. The fresh Pi setting is a recorded latency regression; it remains visible in the ledger.

The first unpaired Qwen Pi trial with the partner-share forecast, `pair05`, earned 100 Prestige as a solo deadline side. It made six accepted actions, had one rejected order in 26 tool calls, and first acted at 29.04 seconds. There is no Codex `pair05` result, so it is an integration observation rather than a client comparison. It does not isolate the forecast's effect on partner choice.

## Benchmark interpretation

The quick-room comparisons are useful for tool validity, first-action latency and client integration, but they cannot establish consistent playing strength. A quick match takes about five wall-clock minutes; a 120-second turn consumes 40% of it, and a 60-game-second diplomatic offer lasts ten wall-clock seconds. A common room seed fixes combat rolls only for identical states and ticks; agents' different orders produce different bot responses and final boards. Qwen Codex used the shell CLI fallback while Qwen Pi used Council MCP tools. Provider token counters and cache treatment differ. A passive British seat sometimes earned 100 Prestige at the deadline, so score alone can reward survival without good decisions. The next playing-strength evaluation should use repeated normal-speed games, rotate starting countries, avoid same-model service contention, and include active industry gain, valid orders and first-action latency alongside final Prestige. A fixed-board tool task can separately compare interface efficiency without a changing match.

For this iteration, **101 Node tests** and `npm run check` passed. The 32-round diplomacy regression reported zero invariant failures. The native `python tests/browser.py` live, review, and recorded-position suites passed with no page errors. The benchmark page loaded the aggregate ledger, filtered the anonymous external profile and a same-seed Qwen pair, and fit a 390-pixel native Chromium viewport without JavaScript errors or document overflow. These are small, timing-sensitive quick games against practice bots, not proof of consistent model superiority or human enjoyment.

# Fixed-board client check — 28 September 2026

The isolated benchmark room was started with automatic ticking disabled. Both clients saw the ordinary public British opening position through Council, and the evaluator required exactly three accepted orders in sequence: move five troops from England to Low Countries, declare war on France, then move five from Ireland to North France. This is a tool-usage check with a frozen board, not a game or a tactical skill test. No production advance-time endpoint was added.

| Model and path | Runs | Correct | Rejected orders | Seconds to third order | Reported total tokens |
| --- | ---: | ---: | ---: | --- | --- |
| Qwen Pi MCP | 2 | 2 | 0, 0 | 14.15, 12.75 | 117,873; 94,096 |
| Qwen Codex CLI | 2 | 2 | 0, 0 | 9.83, 7.79 | 59,154; 59,910 |
| Luna Pi MCP | 2 | 2 | 0, 0 | 29.10, 24.93 | 50,772; 80,740 |
| Luna Codex MCP | 2 | 2 | 0, 0 | 36.18, 52.30 | 235,055; 234,840 |

One extra Qwen Codex run was configured with Council MCP but used shell commands and direct HTTP instead. It completed in 69.32 seconds after 28 shell calls and one rejected order. It is labeled `shell fallback` in the task ledger and excluded from the supported CLI comparison. These two repetitions show that Pi Luna handled this task faster with fewer reported tokens, while the supported Codex CLI handled Qwen faster with fewer reported tokens. They do not establish the result for longer games or other positions. The dashboard reads the allowlisted task aggregates from `agents/pi/task-benchmarks.json` alongside match results.

## Compact board read — 28 September 2026

During two isolated normal-speed games, the first Luna Pi response took 155.1 seconds and reported 203,390 input tokens plus 96,768 cache-read tokens for five attempted orders. It called `preview` 14 times, `strategic_options` five times and `situation` five times; the context hook trimmed 34 older responses. This establishes repeated inspection and context growth as observable costs, although provider token accounting can include cached input. The same live positions measured about 76 KB for full `observe`, 11–13 KB each for `situation` and `strategic_options`, and 23 KB for the MCP `map` response after SVG path removal.

A new read-only `board` projection returned 5.4 KB through the actual MCP transport on a live Luna position at tick 659. It showed all 79 provinces as compact rows, seven owned provinces with their available troops and direct neighbors, active wars and command budget. It uses the same seat-filtered observation and public map. This is a payload-size and contract check; no model has yet completed a match using the new board prompt, so its effect on order quality, total tokens or score remains unmeasured.

The same live seat was also tested with `view_map`: the MCP returned a 5.8 KB exact board text block and a PNG. The rendered image was inspected at 1280×680: owner colors, gold outlines for Britain, nearby troop badges and the country legend were visible. It did not include player names or chat. After selecting 8-bit output, a later live rendering was 192 KB. This proves the image transport and rendering path, not that a vision model makes better decisions from it. The Pi runner exposes this optional tool to models configured for image input; text-only Qwen continues to receive `board`.

The old normal-speed Qwen baseline reached tick 1138 after 52 model prompts, with 4.53 million reported total tokens and 18 failed calls. The runner's former half-second/five-second delay was repeatedly asking for decisions on near-identical boards. New runs wait for a default 30-game-tick decision interval, counting the model's own elapsed game time toward it. This is a harness polling change; no game timing or rules changed. Its impact remains to be measured in new completed games.

That obsolete Qwen baseline was stopped at tick 1453 after 67 turns because it was about to exhaust its 80-turn cap before the tick-1800 deadline. It has no authoritative final score and is excluded from the match benchmark ledger. A new quick-room Qwen integration trial with the compact board and corrected cadence was then started as `board01`; it is not treated as a normal-speed strength comparison.

`board01` completed at the quick-room deadline in five model turns: 11 accepted orders, one rejected order, one failed call in 47, first accepted action at 25.55 seconds, 763,243 reported total tokens and −19.68 Prestige. It used `board` but also chose to inspect the map, situation and seven combat previews. The smaller view and slower polling avoided the old normal-run turn cap and yielded an authoritative result; these different clock settings and boards cannot isolate the view's effect on strength or token use.

The old normal-speed Luna Pi baseline `normal01`, which started before `board` and `view_map`, finished at tick 1800 with 100 Prestige: 24 accepted orders, four rejected, five failed calls in 95, first accepted action at 95.21 seconds and 3,259,526 reported total tokens. Its first turn took 155.1 seconds. A later `view01` quick-room trial is testing the actual visual model path separately.
