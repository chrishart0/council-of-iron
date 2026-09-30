# Jev Council study

The question is whether a fast decision model improves Council play enough to justify a second model. This is an isolated experiment in the optional PI package, not a live-game feature. The committed engine and map at `f016d21` are held fixed. No deployment or service restart is involved.

## Prior work

- [JEV-Star](https://arxiv.org/html/2609.27331v1), with [code](https://github.com/sc2musa/Jev_Star), combines an occasional persistent LLM plan with frequent Jev choices among feasible StarCraft II commands. It reports four full-game wins and median Jev response time of 0.422 seconds. The paper explicitly says candidate descriptions and execution also improved: its planner ablation is not controlled.
- [Jev × Civilization II](https://github.com/phyous/tsai-civ2) covers economy, diplomacy and warfare through named choices over player-observable state. Its README reports no verified complete-game win. A comparable game and a working harness are not evidence of superior play.
- [Craftax Jev experiments](https://github.com/mansicer/jev-plays) compare raw actions, macro actions, an LLM planner, an LLM choosing every action, and random choice over three seeds. The authors found that plan wording could worsen immediate danger handling. Their final planner improvement was small and within seed noise. This motivates concrete candidate descriptions, shuffled option order, a simple-code control and separating latency from strength.
- [OpenRouter's Decisions API example](https://openrouter.ai/blog/insights/what-is-jev/) provides Jev through the existing OpenRouter key, without a new provider account. [TypeSafe's limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) recommend keeping numeric logic in code. [Confidence](https://docs.typesafe.ai/confidence) measures concentration among candidate probabilities; it is not combat win probability.

## Protocol

[jev-protocol.json](jev-protocol.json) is the machine-readable protocol. Freeze it and the controller implementation before the main runs. The orchestrator records its SHA-256 at launch. Pilot games use a different seed and the entire quick clock, and are excluded from the main evidence.

Eight matched blocks cover all eight countries, with a distinct combat seed per country. Every block has four normal-speed games against the same seven unchanged practice bots:

1. Existing PI `decision-turn-v6`, fresh contexts, one-to-three orders per turn, 30-tick cadence and 120-second turn deadline.
2. The same LLM profile for strategy and diplomacy, plus a deterministic military selector every five ticks.
3. The same hybrid architecture with Jev choosing military actions.
4. Pure Jev with the default fixed strategy and finite diplomatic choices, including alliance proposals, accept/decline, war and peace. It cannot negotiate in generated text.

The model profile is the existing Space Bunny OpenRouter profile, including its reasoning compatibility setting. The model is a proprietary stealth alias; this experiment cannot establish conclusions about other planners. Each run has a new alias and workspace. The main arms start under the same concurrent load window, with rotated launch order. Every game has a separate loopback HTTP server and SQLite file. All commands use ordinary seat authentication, server validation, troop reservations and operation IDs. No game clock pauses for inference.

Hybrid military choices are attacks from neighboring sources, own-territory reinforcement, interior rally and development. Server forecasts compute arrival defenses and combat probabilities. A persistent strategy specifies priority province IDs, reserve troops, a minimum forecast attack chance and whether to develop. Jev cannot declare a war in the hybrid arms: that remains the LLM's decision. The same candidate builder and restrictions are used by the coded selector and Jev; option order is seeded and shuffled independently of preference scores. One submission queue serializes planner and executor commands. Provider failure waits or fails the trial; a substituted coded move is never counted as a Jev choice.

The primary endpoint is final **own industry**, paired Jev minus coded-selector, using authoritative saved results. Secondary endpoints include wins, survival, own-industry trajectory, order validity, decision latency, planner usage and reported Jev cost. Complete games are the units of playing-strength evidence, not thousands of correlated model calls. Eight pairs support only a small initial estimate. Report a paired exact sign-flip test and an exploratory paired bootstrap interval; secondary comparisons remain exploratory. Report incomplete trials separately and retain all attempts.

Baseline versus hybrid is a complete-system comparison: both the action interface and cadence change. Jev versus the coded selector tests the choice mechanism within the same hybrid architecture, although the LLM's independently generated strategies and downstream states can diverge. Pure Jev is a limited ablation of free-form strategy and diplomacy, not a fully equivalent conversational player.

## Matched-position diagnostics

`position-bench.js` records naturally reached positions at ticks 0, 60, 180 and 300 from an unchanged bot simulation. It keeps only living seats with at least two candidate choices; the initial dataset has 22 such positions. Each position is tested under two option permutations. The PI LLM and Jev receive the same state, strategy and candidate descriptions. Which model runs first alternates. Report latency, failures, option-order consistency and choice agreement. Agreement with the heuristic is a diagnostic, **not** an optimality label or playing-strength score. These positions are held fixed during calls, so their timing is not a real-time match reaction measurement.

## Reproduce

Keep credentials in an ignored env file. These commands create only isolated test rooms:

```sh
npm ci --prefix agents/pi
node --env-file=/path/to/private.env agents/pi/jev-study.js --phase pilot --out data/jev-study/pilot
node --env-file=/path/to/private.env agents/pi/position-bench.js space_bunny
node --env-file=/path/to/private.env agents/pi/jev-study.js --phase main --out data/jev-study/main
```

For long runs, use durable workers (independent transient user units, with per-job exit records):

```sh
node --env-file=/path/to/private.env agents/pi/jev-study.js --phase main --out data/jev-study/main-durable --durable-env-file /path/to/private.env
```

`hybrid-play.js` has no live-room URL option. Raw runs, databases, credentials, strategy outputs and chats remain ignored under `data/` and model workspaces. Only allowlisted aggregate statistics are published. A code or configuration fix after a main run begins requires a new labeled implementation batch; do not silently pool it with the frozen batch.

## Pilot observations

An authenticated Jev smoke test returned in 328 ms and reported cost $0.00001449. Initial hybrid pilots rejected the LLM request because the experiment omitted the existing profile's `offReasoningEffort=low` compatibility mapping; they are retained as incomplete pilot attempts. The mapping was corrected before the main study. Four replacement pilot arms exercised the candidate builder and ordinary HTTP order validation. Quick games verify integration and are not used for playing-strength comparisons.

Main results will be recorded after completion, with no claim of human enjoyment, human-opponent strength or game balance.

## Original-batch interruption and complete replacement

The original launcher exited with signal 15, observed through the execution tool. Seven baseline processes disappeared without authoritative final records. Six unfinished hybrid processes subsequently disappeared too. The cause is not established; the system earlyoom log inspected during the incident did not report a kill. No missing final result is counted as a loss, and no unfinished run is imported into a completed-match ledger.

All eight baseline cases were repeated in one durable batch, including the one original baseline that finished. All 24 hybrid cases were also repeated in one durable batch, including earlier completed cases, to avoid selecting only the fast-finish survivors. The model settings, seeds and controller files were unchanged (`git diff fbaf56c -- agents/pi/hybrid-play.js agents/pi/tactical-candidates.js agents/pi/decision-api.js agents/pi/play.js src/engine.js public/imperial-map.json` was empty before replacement launch). Changes concern only launch durability and analysis bookkeeping.

The primary paired Jev-versus-code comparison uses only the complete replacement hybrid batch. Baselines started earlier in a separate replacement window, so baseline comparisons are exploratory and cannot attribute differences solely to architecture or model latency. The complete original records are retained as descriptive attempts, not pooled into the final eight-per-arm summary. The published exporter includes every attempt and its status. Durable workers keep exit status independently of the launcher; saved finished results also remain usable when a launcher disappears.

Replacement analysis command:

```sh
node agents/pi/study-analysis.js data/jev-study/main --baseline-replacement data/jev-study/baseline2 --hybrid-replacement data/jev-study/hybrid2
python scripts/plot-jev-study.py
```
