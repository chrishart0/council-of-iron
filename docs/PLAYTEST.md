# Playtest record

Actual test evidence only, newest first. Automated self-play and bot matches check that the rules hold and that matches resolve; they do not show balance or that people enjoy the game.

## Mobile rendering investigation — 30 September 2026

A human reported whole-game lag after a mobile round on a Samsung S25 Ultra, despite the earlier performance
changes. They could not identify one interaction or distinguish rendering cost from device or network delay.
There was no physical-device trace or confirmed browser, so the cause of that particular round is not proven.

Chromium phone emulation at 4× CPU throttle reproduced full-terrain repaints from army movement, repeated merged
counter class changes on unchanged polls, coastline walks during name placement, and forced layout reads during
pinch handling. In a paused recorded-position rendering probe, moving the armies into their own SVG reduced
two seconds of paint slices from 22.1 to 3.3 ms. Native pinch move handling's 95th percentile fell from 29 to 1 ms;
this is handler time, not full input-to-display latency. The new rendering regression observed moving-army paints
with zero terrain paints at 390×844, 844×390 and 1366×768, and checked camera alignment, keyboard selection and
disposal. Details and measurement limits are in `docs/PERFORMANCE.md`. These are recorded-position UI checks,
not a new live match or evidence of phone enjoyment; the user has not yet retested the changes on the S25.

Verification passed: 235 Node tests, JavaScript parsing, 32 diplomacy rounds with zero invariant failures, and the
native live, review, UI, task, voice and rendering suites. After correcting the performance test's row-retention
probe and report-reopening loop, its full run passed the unchanged CPU, payload, animation and memory budgets:
41.0% map / 17.5% Messages main-thread load at 4× throttle, 1.3 MB post-GC growth through the 30:00 finish, and
5.8/5.9/6.0 MB after three report reopenings. Touch map effects are brief static highlights. The live service was
not restarted or deployed.

The earlier Pi model results below used the former v5 map. Master now uses the v6 map, with different starting industry, adjacency and impassable borders. The v5 wins remain historical evidence and must not be used as a current v6 model win rate. Some interrupted attempts were stopped by `earlyoom` and have no result.

# v6 agent results — 29 September 2026

## Current Pi baselines — 29 September 2026

DeepSeek V4 Flash Vision Exp and the local Qwen3.8 27B Unsloth Q4 XL played isolated normal-speed rooms against seven practice bots on revision `a73cd6530a2b`, with `decision-turn-v4`, the same country and combat seed within each pair, and a 120-second turn limit. Qwen used the healthy direct backend on port 18082 because the configured port-8081 proxy was unavailable; `/props` reported a 204,800-token context. The ignored local `.env` now points the Qwen alias at the direct backend. This changed the route, not the model or game rules.

| Start | DeepSeek | Qwen |
| --- | --- | --- |
| France, `v6-current-france-01` | Domination win at tick 518, 24 own industry; 37 accepted / 3 rejected actions, 4 failed calls of 124, 16 turns, no timeout, 1,344,533 reported tokens | Domination win at tick 560, 18 own industry; 42 accepted / 5 rejected actions, 7 failed calls of 113, 19 turns, no timeout, 1,258,972 reported tokens |
| Qing, `v6-current-qing-02` | Domination win at tick 1583, **4 own industry**; 93 accepted / 6 rejected actions, 27 failed calls of 335, 39 turns, no timeout, 3,878,506 reported tokens | Loss with 0 industry at the tick-1800 deadline; 111 accepted / 19 rejected actions, 29 failed calls of 371, 47 turns, 3 timed-out turns, 4,189,429 reported tokens |

DeepSeek's Qing nearly disappeared before a late alliance with France supplied most of the winning side's industry. Qwen's Qing allied with Russia, later brought in Japan, then lost its final province. These two seeds show a France win for both models and a weak coalition win versus elimination on Qing. They do not establish a reliable win rate.

Qwen repeated the Qing seed with a 60-second rather than 120-second turn limit, still using `decision-turn-v4`. It again lost at the tick-1800 deadline, but retained **30 own industry** after allying with Russia and Ottoman (54 turns, 36 failed calls of 395, 4 timed-out turns, 5,034,705 reported tokens). The shorter limit ended four long turns after accepted actions; the model's decisions also diverged from the first attempt, so the stronger personal position cannot be attributed to the limit alone. DeepSeek played Japan on `v6-current-japan-03`, the same revision and v4 interface: it won by domination at tick 1730 with 26 own industry after a late alliance with France (131 accepted / 1 rejected actions, 14 failed calls of 397, 51 turns, 4,414,491 reported tokens).

With `decision-turn-v5` (rejected-call guidance), DeepSeek Russia won by domination at tick 706 on `v6-current-russia-04`, holding 16 own industry in a Russia/Germany/Qing alliance (59 accepted / 5 rejected actions, 10 failed calls of 182, 19 turns, no timeout, 2,179,762 reported tokens). Qwen Japan on the matched `v6-current-japan-03` seed also won by domination at tick 1267, holding 11 own industry in a Japan/Qing alliance (88 accepted / 12 rejected actions, 17 failed calls of 205, 43 turns, no timeout, 2,022,543 reported tokens; its turn limit was 90 seconds). The Qing and Russia DeepSeek wins, and Qwen's Japan win, relied heavily on allied industry; these are coalition play outcomes, not evidence that each model can conquer alone.

With `decision-turn-v6` (the actionable fields first), DeepSeek Germany won the `v6-current-germany-05` start by domination at tick 1625, holding 9 own industry in a Germany/Britain/Russia alliance (97 accepted / 1 rejected actions, 17 failed calls of 337, 44 turns, no timeout, 3,835,191 reported tokens). Qwen Germany, using the same combat seed and a 90-second turn limit, won at the tick-1800 deadline with 16 own industry in its Germany/Britain/Russia alliance (122 accepted / 13 rejected actions, 25 failed calls of 353, 56 turns, 2 timed-out turns, 4,353,060 reported tokens). The agents separately formed the same three-country alliance, though the subsequent games diverged.

Across the five distinct recent country starts, DeepSeek won five of five (France, Qing, Japan, Russia, Germany); Qwen won three of four completed matched starts (France, Japan, Germany; Qing lost). These results support a bot-match win majority for both models in this sample. Several wins relied heavily on allied industry, and this does not establish solo strength, human-opponent performance or a causal benefit from the v5/v6 prompt changes.

## Matched harness starts — 29 September 2026

We ran isolated, normal-speed games against seven practice bots on revision `e29afedd6fa1`. Each model's Pi and CLI starts used the same country and combat seed, with one agent seat per room. These match the opening conditions, but subsequent decisions and combat paths diverge. The Space Bunny starts used OpenRouter `stealth/space-bunny-alpha` through Pi and Hermes; GPT-6 Sol low used Pi and Codex CLI. All finished rows are in the HTML benchmark ledger.

| Model and start | Pi | CLI |
| --- | --- | --- |
| Space Bunny, France, `v6-bunny-france-01` | Win by domination, tick 757, 29 own industry; 54 accepted / 8 rejected actions, 9 failed calls of 91, 26 turns, 951,332 reported tokens | Hermes: win by domination, tick 890, 31 own industry; 60 accepted / 5 rejected actions, 5 failed calls of 69, 16 turns; complete token coverage unavailable |
| Space Bunny, Japan, `v6-bunny-japan-02` | Loss at the tick-1800 deadline, 24 own industry; 125 accepted / 15 rejected actions, 15 failed calls of 177, 60 turns, 1,543,744 reported tokens | Hermes: draw at the tick-1800 deadline, 13 own industry; 75 accepted / 3 rejected actions, 4 failed calls of 99, 33 turns; complete token coverage unavailable |
| GPT-6 Sol, France, `v6-sol-france-01` | Win by domination, tick 439, 21 own industry; 24 accepted / 0 rejected actions, 1 failed call of 54, 14 turns, 534,624 reported tokens | Codex CLI: win by domination, tick 568, 24 own industry; 53 accepted / 3 rejected actions, 5 failed calls of 84, 17 turns; complete token coverage unavailable |
| GPT-6 Sol, Japan, `v6-sol-japan-02` | Win by domination, tick 1066, 32 own industry; 54 accepted / 1 rejected actions, 7 failed calls of 119, 36 turns, 1,191,396 reported tokens | Codex CLI: loss to another side's domination at tick 1750, 18 own industry; 135 accepted / 2 rejected actions, 3 failed calls of 207, 49 turns, 7,676,997 reported tokens |

The first Space Bunny Pi Japan attempt stopped after 23 turns, without an authoritative final result. The local game server was responsive; the harness stopped producing turns and the cause was not established. It is excluded from the ledger and not counted as a loss. The replacement uses the same seed and is the Pi row above. The sample is too small, and the models use different combat seeds, to rank the models or infer that tooling changes caused a win. The Japan Sol split shows a harness comparison can reveal a material difference that the shared France wins would have hidden. Token totals are provider-reported and missing for CLI runs with incomplete turn coverage.

## CLI harness benchmark — 29 September 2026

Three finished normal-speed CLI seats now appear in the HTML benchmark ledger with their harness, model, arena and industry-over-time trace. In shared room `v6-cli-grok-hermes-04` (Grok CLI 4.7 low as Japan, Hermes Luna low as Russia, six practice bots), a solo German bot won at the tick-1800 deadline with 57 industry. Grok Japan lost with 11 industry (70 accepted / 7 rejected orders; 10 failed tool calls of 156; 23 turns, 2 timeouts). Hermes Luna Russia was eliminated and lost with 0 industry (86 accepted / 19 rejected; 27 failed calls of 178; 34 turns, 1 timeout). Model-reported input/output token counts covered only 20 of Grok's 23 turns and 33 of Luna's 34, so the ledger leaves their full token totals blank.

In a separate seven-bot room, `v6-cli-hermes-sol-france-01`, Hermes GPT-6 Sol low played France and won by domination at tick 1419. France held 59 industry and its Britain ally 11; it made 100 accepted / 4 rejected orders, 4 failed calls of 126, and 12 messages over 41 turns without a timeout. The CLI reported 696,897 input-plus-output tokens across all 41 turns. These are one start per model, with different countries and opponents in the shared room; the win and losses do not rank models or harnesses. The report keeps shared-room rows separate from seven-bot rows. Both rooms used game source revision `774febc`; the local launcher's PATH was corrected before they started so the systemd Hermes command could be found.

After integrating master revision `8237a58`, `npm test` passed 231 tests, `npm run check` passed, the 32-round diplomacy balance run had zero invariant failures (23 decisive wins, 8 deadline wins, 1 draw), and the native `python tests/browser.py --executable /usr/bin/google-chrome` suite passed live, review, UI tasks, voice, performance and UI checks. The arena-label importer correction then passed the same 231 Node tests and syntax check; it does not change game or browser code.

Qwen3.8 27B Unsloth Q4 XL played France at normal speed against seven practice bots (`v6-france-03`, `decision-turn-v4`, revision `43aea05`). France allied with Qing, fell to one province by tick 664, and was eliminated at tick 770. The room finished at the tick-1800 deadline with a solo German bot winning on 51 industry; France and Qing had 0. Qwen made 49 accepted and 13 rejected actions, 163 tool calls (19 failed), reported 1,699,239 tokens over 23 turns, and had no timed-out turn. Failed calls included invalid routes, unavailable development manpower, and messages addressed to a non-country. This run used the newer alliance-war revision, so its outcome cannot be attributed to the model alone when compared with the earlier DeepSeek France run. Its numeric industry path is in the HTML benchmark ledger.

DeepSeek V4 Flash Vision Exp played Britain at normal speed against seven practice bots (`v6-britain-01`, v6 map and standard preset, `decision-turn-v3`). It won by domination at tick 701 in a Britain–France–USA coalition, with 33 own industry (50 accepted and 3 rejected actions, 6 failed tool calls of 150, 1,614,813 reported tokens, 22 turns, no timed-out turn).

The first Qing attempt stopped at tick 1206 with no final result after a 120-second turn and two connection errors; the model endpoint tunnel timed out and restarted. It is excluded from the ledger. A fresh Qing start (`v6-qing-02r`, same v3 interface) won by domination at tick 953 in a Qing–Russia–USA coalition, but Qing owned one province and 2 industry while Russia and USA owned 30 and 31. Qing made 64 actions and 215 tool calls (19 failed, mostly route previews and rallies), reported 2,450,790 tokens, and had one timed-out turn after five accepted actions. This is a valid win under the rules but weak individual performance. Route and rally guidance was clarified for the next interface version before the France start.

DeepSeek then played France (`v6-france-03`, `decision-turn-v4`) at normal speed against seven practice bots. France won by domination at tick 659 with 25 own industry in a France–Britain coalition; Britain held 36. France made 50 accepted and 2 rejected actions, 164 tool calls (7 failed), used 1,893,895 reported tokens over 19 turns, and had no timed-out turn. Four failures were previews requesting more troops than remained free after earlier orders; one preview occurred after the match ended.

A second Qing run used the same start and combat seed as `v6-qing-02r`, with the clarified v4 guidance. It lost at the tick-1800 deadline: a solo Ottoman bot won with 44 industry, while Qing held 31 and its Britain ally held 4 (Russia held 0). Qing made 120 accepted and 3 rejected actions, 392 tool calls (19 failed, mainly previews), and used 4,399,574 reported tokens across 48 turns without a timeout. The v4 Qing held much more own industry than the v3 Qing's 2, but the alliance lost. Reusing a seed does not hold model decisions or subsequent combat paths constant, so this pair cannot isolate the guidance's causal effect. These four completed v6 DeepSeek starts produced three coalition wins and one loss, with large variation in personal contribution; they do not establish a reliable win rate. Aggregate results are in `agents/pi/benchmarks.json`. All four were run at revision `3bdb228`, before the later alliance-war correction on master.

# v6 trial environment — 29 September 2026

The local Qwen llama.cpp service was idle but held about 24 GB host RAM and 28.5 GB VRAM with a 262,144-token slot. Its slot was set to 204,800 tokens (above the requested 200k minimum) and the service restarted while no client connection was open. Afterward `/props` reported 204800, the port-8081 health check and a short completion returned HTTP 200, and observed use was about 10 GB host RAM and 26 GB VRAM. This restored headroom for the pending native browser and v6 Pi trials. The observation does not isolate how much came from the smaller slot versus restarting the long-lived process.

# Additional Pi trials — 29 September 2026

DeepSeek played Qing at normal speed against seven practice bots with `cap3-qing-02`. It won by domination at tick 1196 with 12 own industry (80 accepted, 2 rejected orders; 6 failed tool calls of 254; 2,719,700 reported tokens). DeepSeek then played Britain with `cap3-britain-03` and won by domination at tick 288 with 28 own industry in a Britain/France/Germany alliance (20 accepted, 4 rejected orders; 6 failed tool calls of 64; 832,230 reported tokens). Its Germany run with `cap3-germany-04` won by domination at tick 879 with 35 own industry in a Germany/Britain alliance (64 accepted, 6 rejected orders; 11 failed tool calls of 205; 2,497,959 reported tokens). These are three more completed starts, with alliance wins rather than sole control of the 60% threshold. The paired Qwen Qing run stalled inside a Pi turn beyond its 120-second limit and was stopped without an authoritative final result; it is excluded from the ledger. The harness now has a hard deadline so such a stall ends as an incomplete trial.

DeepSeek Ottoman with `cap3-ottoman-05` won by domination at tick 802 with 31 own industry in an Ottoman/France/Russia alliance (60 accepted, 3 rejected orders; 15 failed tool calls of 203; 2,229,225 reported tokens). Together with the France row below, DeepSeek has five wins in five completed isolated normal-speed starts under the three-country cap, across five countries. The Japan win below used the preceding four-country cap and is reported separately. Russia and USA are still unmeasured under the current cap; these five wins are encouraging but do not prove a stable win rate under different seeds and opponents.

Qwen retried Qing with the same `cap3-qing-02` seed after the Pi hard-deadline fix. It won by domination at tick 1237 with 5 own industry in a Qing/Germany/Japan alliance (77 accepted, 10 rejected orders; 20 failed tool calls of 264; 3,059,669 reported tokens). One 120-second turn aborted and the agent resumed on the next turn; the earlier stalled Qing attempt is still excluded. Qing had only 3 provinces at the finish and contributed a small part of the alliance's industry; this is a valid individual win under the current rules, with a clear reliance on stronger allies. Qwen's Britain and Germany starts are queued.

The first follow-up DeepSeek Russia and Qwen Britain attempts ended without results when the host's `earlyoom` service sent SIGTERM to their Pi Node processes. The system journal records available RAM below 8% and nearly full swap. Restarts also ended the same way. These interrupted runs are excluded from the benchmark ledger; the queues were stopped until host memory recovers. This is a test-host interruption, not a game outcome.

Space Bunny Alpha Pi passed the three-order fixed task at normal speed (3/3 accepted, no failed calls, one turn). Its isolated France match against seven bots used the same `cap3-france-01` seed as the Qwen/DeepSeek France trials. It won by domination at tick 455 with 21 own industry in a France/Britain/Germany alliance (36 accepted, 4 rejected orders; 4 failed tool calls of 49; 475,901 reported tokens). The sanitized aggregate is in `agents/pi/benchmarks.json` under `external`. These individual matches do not establish a model win rate.

A second Space Bunny run used Britain and `cap3-britain-03`, matching the DeepSeek Britain start and seed. With image input enabled in its ignored local profile, Pi exposed `view_map`, but the model made zero calls to it. It won by domination at tick 400 with 27 own industry in a Britain/France/USA alliance (33 accepted, 3 rejected orders; 3 failed tool calls of 41; 403,321 reported tokens). This is a text-view result; it does not measure whether a picture helps.

# Three-country-cap France trials — 29 September 2026

Two isolated normal-speed Pi/MCP matches used the same France start and combat seed (`cap3-france-01`) against seven practice bots. Both reached an individual win by holding at least 60% of industry for 90 ticks. DeepSeek finished by domination at tick 568 with 31 own industry in a France/Britain/Russia alliance (45 accepted, 3 rejected orders; 7 failed tool calls of 144). Qwen finished by domination at tick 908 with 48 own industry in a France/Germany alliance (113 accepted, 67 rejected orders; 71 failed tool calls of 259). Qwen's rejected orders were 44 marches, 22 developments and one chat; 40 march rejections reported insufficient uncommitted troops. The sanitized aggregate records are in `agents/pi/benchmarks.json`. This pair is evidence of two wins from one starting country and seed, not a general win-rate estimate.

# Three-country alliance cap — 28 September 2026

The current rules cap a side at `min(3, floor(seats / 2))`. The eight-seat offer test reaches three members and rejects a fourth; four-seat rooms remain capped at two, and two- and three-seat rooms cannot form alliances. `npm test` passed 216 tests, `npm run check` passed, the 32-round diplomacy gate had 0 invariant failures (24 decisive outcomes, 0 draws), and the native `python tests/browser.py --executable /usr/bin/google-chrome` run passed its live-match, review, UI and voice suites. This is rule and interface verification, not a human balance verdict. Live room `39104252` was still running under its original four-seat cap when this change was tested.

# Mixed-client human room — 28 September 2026

Room `39104252` ran on the live HTTPS server at normal speed with a human Britain seat, Pi seats for Qwen 27B (France), DeepSeek V4 (Germany) and Luna (USA), Hermes Luna with low reasoning (Russia, using the existing `councilluna` profile), Grok 4.7 CLI with low reasoning (Japan), and two practice bots (Ottoman and Qing). The Qwen/DeepSeek alliance won at the tick-1800 deadline with 115 industry (Qwen 36, DeepSeek 79); Britain had 17, Pi Luna 30, Grok 17, and Hermes had been eliminated at tick 1288. The saved public review reconstructed the match after server restart (`historyAvailable: true`): 210 battles, 7 war declarations, 5 alliance activations and 81 disclosed alliance-chat messages. The Pi clients recorded 159 accepted / 25 rejected orders for Qwen, 149 / 8 for DeepSeek, and 48 / 1 for Luna; the CLI harness recorded 82 / 24 for Hermes and 87 / 1 for Grok. This one mixed-client match shows active diplomacy and functioning agents, but does not establish an isolated bot-match win rate or assess the human's enjoyment.

# Current-rules Japan trials — 28 September 2026

Two isolated normal-speed Pi/MCP matches used the same combat seed (`latest-japan-01`), Japan against seven practice bots, and the `decision-turn-v3` interface. These are individual observations, not a model win-rate estimate.

- Qwen 27B Japan issued 90 orders. It was eliminated at tick 1311 with no provinces or armies. Its Germany/Russia alliance won by domination at tick 1495, but the then-current result incorrectly recorded Japan as a winner with **0 industry**. This run is excluded from the new benchmark ledger; the importer now rejects such a result. The scoring rule now gives a zero-industry country a loss even if its alliance wins.
- DeepSeek Japan reached the tick-1800 deadline with 12 provinces and 27 industry, winning with its alliance. It issued 107 orders (101 accepted, 6 rejected); the Pi client recorded 30 failed tool calls out of 341. Its aggregate result is in `agents/pi/benchmarks.json`.
- **Rule-change checks:** `npm test` passed 215 tests, `npm run check` passed, the 32-round diplomacy balance gate reported 0 invariant failures, and the native `python tests/browser.py --executable /usr/bin/google-chrome` run passed its recorded-match, review and UI suites.

# Simplification pass — 28 September 2026

The rules were cut down to one `march` order, rally points only, recall only, alliance-wide war and peace without votes, win/lose/draw results with your own industry as score, alliances capped at half the countries, no opening council, no industry damage on capture and invisible anti-spam limits (the rule-by-rule record is [SIMPLIFY-PLAN.md](SIMPLIFY-PLAN.md)). Results from runs on the `simplify` branch:

- **Node:** `npm test` 161 pass / 0 fail; `npm run check` passes.
- **Browser:** the full `python tests/browser.py` passed with no page errors: a live match with a browser seat, a CLI player and six bots to a finished result, the after-action review, the UI layout, overlap and contrast audits at seven viewports (1920×1080, 1536×864, 1440×900, 1366×768, 1280×800, 390×844, 844×390), the `tests/ui_tasks.py` walkthroughs and the voice suite.
- **Tap counts** are equal to or better than before on every task; two bounds were tightened: declare war and march 4 → 3, reply to a DM 3 → 2. The `turn` (turn around) task was removed with the mechanic (both were restored the same day). Current bounds are in [UI-DESIGN.md](UI-DESIGN.md#verified-automated-not-a-usability-study).
- **Balance gate:** `npm run test:balance -- --rounds 32 --mode diplomacy` had 0 invariant failures; 25 of 32 decisive, 7 deadline wins, 0 draws.
- **Same-seed before/after runs:** 256 diplomacy + 256 solo matches on each side, in [BALANCE.md](BALANCE.md).
- **Handplay replay** re-baselined: the recorded eight-seat match now ends at tick 553 by domination of the Britain/France/USA alliance.
- **Code reduction:** whole-repo text 32,627 → about 18,000 lines.
  Totals: see docs/SIMPLIFY-PLAN.md
- The Pi agent benchmark ledger (`agents/pi/benchmarks.json`, `task-benchmarks.json`) was reset for the new rules; earlier runs remain in git history.

**No human has played the simplified rules yet.** Nothing above shows that the game is clearer or more fun; that needs a real playtest.

# Before the simplification pass (rules since removed)

Everything below was measured under earlier rules: Prestige scores and prize pools, war and peace votes, recruitment arrows, explicit transit and turn-around, the opening council, a 3-per-10 s command budget and chat cooldown, and industry damage on capture. Figures are kept as recorded; the mechanics they mention no longer exist.

## Model and agent play

- **Eight-model normal-speed match, 27 September 2026** (`5b3f1596`, commit a09389c). All eight seats were public AI agents (Grok 4.6/4.7, Sonnet 5, three Luna-6 Xhigh, GPT-6-Sol, Opus 5.5) through the ordinary HTTP client, full 1,800 ticks at normal speed. The harness was restarted mid-match and one model's reasoning effort lowered, so it is not a controlled model comparison. Germany–Russia finished first at the deadline, the USA second, France–Ottoman third. The public review reconstructed 2 alliances, 10 war declarations, 2 peace treaties, 60 battles, 50 captures and 8 industry-damage events; the winner reached 39 % of world industry. 72 messages were disclosed and a browser opened the real report with no page errors. Later inspection found one Qing order issued on a stale observation (the province changed hands while the model was thinking); agents then got arrival odds and the runner discards orders whose target changed owner.
- **Local four-agent quick room, 27 September 2026** (`895f000d`): four `gpt-6-luna` controllers, run to the deadline; Germany won solo. The review and outcome agreed. One same-operator match, not a balance sample. The server was also reached over the LAN at `192.168.1.216:3107`; no independent physical device was tested.
- **Pi and Codex agent harnesses, 27–28 September 2026** (commits f7902bd–237e431). About 50 scored single-agent games against seven bots, plus fixed-board tool tasks. Findings that shaped later changes:
  - The most common rejected orders were attacks before war (4 of Luna's first 10 in one run), expired or duplicate war votes, an arrival scheduled too early, an invalid allied transit path, and developments without enough local troops.
  - Winners could score negative Prestige (Luna −63.8 and Codex Luna −50.8 while on the winning side), and passive seats sometimes scored exactly +100 by surviving to the deadline: the score rewarded survival over play.
  - Large reads cost the most: a full `observe` was about 76 KB, the compact `board` 5–6.5 KB; persistent model context grew to hundreds of thousands of cached tokens per turn. This led to `board`, `news`, a current-board turn prompt and context trimming.
  - Quick rooms (5 wall-clock minutes) are too short for slow models: 120-second turns consumed 40 % of a match. Quick pairs are integration and latency checks, not strength comparisons.
  - Fixed-board task (three orders in sequence, frozen board): Qwen and Luna completed it on both Pi and Codex paths with zero rejected orders.
  None of these games ranks models or clients; the details are in git history (this file at a148680).

- **Pi decision-view trials and a shared human lobby, 28 September 2026** (master, commits ee96c3d–43abad4; pre-simplification rules, `decision-turn-v3`…`v10`). Normal-speed Pi runs against seven practice bots, one completed room each unless stated:
  - Qwen won on the winning side in 8 of 10 completed normal-speed games with v6–v10 (7 of them also with positive personal Prestige); one DeepSeek Ottoman v3 game lost at the deadline (−39.88) despite 107 accepted orders. Versions, countries and seeds differ, so this is history, not a win rate.
  - Opening partners: Qing v7 (with distant France) was eliminated at tick 406, Russia v8 (with Britain, no shared border) finished at −8.27, France v9 (with Russia) was eliminated at tick 605; Russia v9 and France v10 allied with adjacent Germany and won (+79.05, +131.45). A diagnostic association, not a measured cause; it motivated the `sharedBorderLinks` partner hint now in `decision_view`.
  - Including delivered messages in the turn view coincided with far fewer `news` calls (19 → 2 on one seed). The same review found `position.ownIndustry` counted alliance industry; it was corrected (the simplified decision view computes own and side industry separately).
  - Infrastructure: a local model server's `503 Loading model` stopped one run and a read timeout another; the Pi runner now waits on loading responses and retries read-only observations. A server needing explicit `reasoning_effort: "none"` got the `OFF_REASONING_EFFORT` profile option.
  - In-process engine diagnostics with a fixed 30-tick cadence and local tool adapters (DeepSeek: four domination wins across Germany, Ottoman and Japan) are excluded from benchmark rows; they did not exercise MCP, the server clock or Pi.
  - A shared normal-speed LAN lobby (`2e50471e`) was set up with five public AI seats (Qwen, DeepSeek and Luna in Pi, Luna through Hermes, Grok 4.7 through Grok CLI), two practice bots and one open seat for a human, started by a seatless host. No gameplay result was recorded from it. The server capability (seatless host start, bounded `count` of practice bots) and the Pi live-seat mode were kept in the simplified game.

## Hand-played match

- **27 September 2026** (commit 6062d8c, map `imperial-1910-v3`): one ChatGPT assistant controlled all eight countries through eight authenticated HTTP seats on a locally stepped clock (the server test seam, not a public endpoint; 12 irregular decision rounds to tick 630). It is one controller, not independent players: no information isolation between countries, and the messages are synthetic dialogue authored for the test. The Atlantic Accord (Britain, France, USA) won by domination at tick 630 with 50 of 79 provinces: 343 accepted actions, 108 battles, three orders correctly rejected, no engine bug found; the troop ledger reconciled every tick (`659 + 3,959 recruited − 192 invested − 2,102 casualties = 2,324`). Findings that shaped the rules: coordinated arrivals and recalls earned their complexity; recruitment arrows were a trap (a chain left 50 idle troops), which led to the single `march` and rally-only reinforcement ([SIMPLIFY-PLAN.md](SIMPLIFY-PLAN.md)).
- **The fixture today:** `tests/fixtures/handplay-20260927.json.gz` holds every accepted command, rejected input and clock advance (no credentials, no database, no decision policy). `node scripts/replay-handplay.js` (`--http` for real HTTP seats) replays those decisions under the current rules through an adapter (war declarations before marches, merged province ids mapped, rejected orders skipped and counted); on the v6 map it reaches the 1800-tick deadline, where the same alliance wins on industry. Its golden hashes are re-baselined whenever the rules change, and the review tests compare its public replay at every tick. Replaying it is verification, not an additional match.

## Verification history

Each release passed its Node tests, syntax checks, the 32-round diplomacy balance run with zero invariant failures, and the full browser suite with no page errors unless noted.

- **28 Sep — War Room × master merge** (90ba16e, a148680): 181 Node tests; balance 24 decisive / 8 deadline, no draws; live 12× browser match finished by a decisive hold at tick 1247; a copy of the live database loaded its v4 match and skipped two old v3 rooms.
- **27 Sep — long-distance group marches** (f7902bd): 93 tests; browser committed a two-source long march.
- **27 Sep — opening council, combat forecasts, industry defence** (41ab611): 85 tests.
- **27 Sep — weighted coalition prizes, public AI message archive** (34a1caa): 75–79 tests; the review showed disclosed AI conversations.
- **27 Sep — formal war, multi-round battles, allied transit** (e3d13e4): 72 tests; a large-battle probe found correlated seeded dice that made defenders unbeatable, fixed by a mixing step.
- **27 Sep — industrial victory (60 % of industry)** (747e945): 62 tests; the handplay replay then ended at tick 530.
- **27 Sep — v0.5 command-table UI, spectating** (cd46a42, 125cf3c): 81–86 tests; native CI [run 36341145508](https://github.com/chrishart0/council-of-iron/actions/runs/36341145508).
- **27 Sep — practice lobby recovery**: 88 tests; filling bots before joining keeps the host's country.
- **27 Sep — v0.4 after-action review** (fe2ebd4): 80 tests; exact public replay at every tick 0–630; native CI [run 36300841635](https://github.com/chrishart0/council-of-iron/actions/runs/36300841635).
- **27 Sep — v0.3 industry, colonial starts, synchronized attacks, recalls** (e9d8d76): 59 tests; 2,368 heuristic matches; native CI [run 36295149158](https://github.com/chrishart0/council-of-iron/actions/runs/36295149158).
- **26 Sep — v0.2 seeded playtesting and atlas UX** (44a2435): 41 tests; 3,488 heuristic matches; native CI [run 36289994282](https://github.com/chrishart0/council-of-iron/actions/runs/36289994282).
- **26 Sep — v0.1** (7b6305f, a1555cc): 33 tests; a browser seat, a CLI seat and six bots played to a finished result; native CI [run 36270303625](https://github.com/chrishart0/council-of-iron/actions/runs/36270303625).

Early local runs used a managed-Chromium HTTP bridge because the sandbox blocked navigation; native navigation, origin and CSP were verified only by the CI runs linked above and later native local runs. Their machine-readable receipts (`docs/testing/*.json`) were removed (most in commit 06d3ec6, the handplay record later) and remain in git history.

## Still unproven

Apart from the user's own phone playtests of earlier versions (the feedback behind [SIMPLIFY-PLAN.md](SIMPLIFY-PLAN.md): "too complex, I get lost"; "the map is good"), no human players have rated clarity or enjoyment. Real devices and iOS Safari, screen readers, public-internet hardening, load and calibrated rankings are untested.

**Agent-harness evidence merged from master (old rules, 28 September 2026).** Review reconstruction of the external-profile quick room `a09b0d68` shows four model turns spanning ticks 0–1727 at the 6× clock (turn wall times 35.1, 120.0 capped, 72.5, 72.6 s); Britain ended with six provinces and no alliance. Two normal-speed external-profile records stopped early (a connection error at tick 291; an output-length stop at tick 295) and are excluded. Three completed normal-speed Qwen Pi Germany runs on seed `normal02` differ (one tool-led win, two compact-board losses) with divergent boards and alliances, so they cannot attribute the gap to the prompt; the harness now records `turnView` and a per-turn position trace for matched comparisons.

## History

Removed records, in git history: `docs/HARNESS-REVIEW.md` (28 Sep 2026 agent-harness review written under the Prestige rules: decision views, critical-state tests, verified memory), `docs/PLAYTEST-HANDPLAY.md` (the full hand-played match write-up) with its receipt `docs/testing/handplay-20260927.json`, `docs/AFTER-ACTION.md` (folded into docs/API.md and docs/UI-DESIGN.md), and the old-UI media `docs/media/after-action.gif`, `command-table.png` and `interface.gif`.
