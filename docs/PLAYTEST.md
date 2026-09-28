# Playtest record

Actual test evidence only, newest first. Automated self-play and bot matches check that the rules hold and that matches resolve; they do not show balance or that people enjoy the game.

# Simplification pass — 28 September 2026

The rules were cut down to one `march` order, rally points only, recall only, alliance-wide war and peace without votes, win/lose/draw results with your own industry as score, alliances capped at half the countries, no opening council, no industry damage on capture and invisible anti-spam limits (the rule-by-rule record is [SIMPLIFY-PLAN.md](SIMPLIFY-PLAN.md)). Results from runs on the `simplify` branch:

- **Node:** `npm test` 161 pass / 0 fail; `npm run check` passes.
- **Browser:** the full `python tests/browser.py` passed with no page errors: a live match with a browser seat, a CLI player and six bots to a finished result, the after-action review, the UI layout, overlap and contrast audits at seven viewports (1920×1080, 1536×864, 1440×900, 1366×768, 1280×800, 390×844, 844×390), the `tests/ui_tasks.py` walkthroughs and the voice suite.
- **Tap counts** are equal to or better than before on every task; two bounds were tightened: declare war and march 4 → 3, reply to a DM 3 → 2. The `turn` (turn around) task was removed with the mechanic. Current bounds are in [UI-DESIGN.md](UI-DESIGN.md#verified-automated-not-a-usability-study).
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

## Hand-played match

- **27 September 2026** (commit 6062d8c): one assistant played all eight seats over real HTTP on a stepped clock; the Atlantic Accord (Britain, France, USA) won by domination at tick 630. See [PLAYTEST-HANDPLAY.md](PLAYTEST-HANDPLAY.md).

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

Early local runs used a managed-Chromium HTTP bridge because the sandbox blocked navigation; native navigation, origin and CSP were verified only by the CI runs linked above and later native local runs. Their machine-readable receipts (`docs/testing/*.json`, except the handplay record) were removed in commit 06d3ec6 and remain in git history.

## Still unproven

Apart from the user's own phone playtests of earlier versions (the feedback behind [SIMPLIFY-PLAN.md](SIMPLIFY-PLAN.md): "too complex, I get lost"; "the map is good"), no human players have rated clarity or enjoyment. Real devices and iOS Safari, screen readers, public-internet hardening, load and calibrated rankings are untested.
