# Jev Council study

The question is whether a fast decision model improves Council play enough to justify a second model. The current evidence supports faster bounded decisions, but does not establish better play. Keep an LLM for strategy and diplomacy; do not add Jev to the default PI harness on this evidence. This is an isolated experiment in the optional PI package. The committed engine and map at `f016d21` are held fixed. No deployment or live-service restart is involved.

## Prior work

- [JEV-Star](https://arxiv.org/html/2609.27331v1), with [code](https://github.com/sc2musa/Jev_Star), combines an occasional persistent LLM plan with frequent Jev choices among feasible StarCraft II commands. It reports four full-game wins and median Jev response time of 0.422 seconds. The paper explicitly says candidate descriptions and execution also improved: its planner ablation is not controlled.
- [Jev × Civilization II](https://github.com/phyous/tsai-civ2) covers economy, diplomacy and warfare through named choices over player-observable state. Its README reports no verified complete-game win. A comparable game and a working harness are not evidence of superior play.
- [Craftax Jev experiments](https://github.com/mansicer/jev-plays) compare raw actions, macro actions, an LLM planner, an LLM choosing every action, and random choice over three seeds. The authors found that plan wording could worsen immediate danger handling. Their final planner improvement was small and within seed noise. This motivates concrete candidate descriptions, shuffled option order, a simple-code control and separating latency from strength.
- [OpenRouter's Decisions API example](https://openrouter.ai/blog/insights/what-is-jev/) provides Jev through the existing OpenRouter key, without a new provider account. [TypeSafe's limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) recommend keeping numeric logic in code. [Confidence](https://docs.typesafe.ai/confidence) measures concentration among candidate probabilities; it is not combat win probability.
- [Jeff](https://github.com/firelex/jeff) offers local 0.8B/2B decision models with the same request shape. Its own results distinguish strong classification performance from weaker reasoning and inconsistent game performance. Its published millisecond timings are on different hardware and cannot be substituted for Council measurements. [Laya](https://github.com/NandhaKishorM/laya) is another local typed-decision model; its authors describe the base as a starting point to specialize, with weak general zero-shot decision results. Neither was tested in Council here: introducing model serving or task-specific training before establishing a Jev advantage would add substantial work without current game evidence.

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

There is one request per permutation, without repeated identical-order controls. Changed choices therefore combine model variability and possible order effects; these diagnostics cannot isolate option-order bias.

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

## Measured decision speed

There were 44 valid calls per model on the 22 positions, with zero failures:

| Model | Median request | Mean request | 95th percentile | Same choice across permutations |
| --- | ---: | ---: | ---: | ---: |
| Jev `1.13-20260917` | 0.2134 s | 0.2516 s | 0.3825 s | 17/22 |
| PI Space Bunny | 2.9153 s | 3.3067 s | 5.8689 s | 12/22 |

The ratio of median request times was **13.7×**. Models chose the same option in 23/44 matched calls; each agreed with the heuristic in 18/44. This establishes latency for this bounded-choice interface, not tactical correctness. Jev reported approximately $0.0034 for these calls. The recorded dataset hash is `a5e54100982f2198bab4e8441d45986beeb476dc37f251e2d6259c524df55842`.

The deterministic selector in real matches takes milliseconds, including the same candidate construction. Jev is useful only if its choices improve outcomes enough to offset extra inference, failure handling and coupling to the planner. A faster cadence and forecasts do not intrinsically require another model. The experiment executes tactics every five seconds; a 0.21-second response alone does not imply a 0.21-second reaction time.

## Original-batch interruption and complete replacement

The original launcher exited with signal 15, observed through the execution tool. Seven baseline processes disappeared without authoritative final records. Six unfinished hybrid processes subsequently disappeared too. The cause is not established; the system earlyoom log inspected during the incident did not report a kill. No missing final result is counted as a loss, and no unfinished run is imported into a completed-match ledger.

All eight baseline cases were repeated in one durable batch, including the one original baseline that finished. All 24 hybrid cases were also repeated in one durable batch, including earlier completed cases, to avoid selecting only the fast-finish survivors. The model settings, seeds and controller files were unchanged (`git diff fbaf56c -- agents/pi/hybrid-play.js agents/pi/tactical-candidates.js agents/pi/decision-api.js agents/pi/play.js src/engine.js public/imperial-map.json` was empty before replacement launch). Changes concern only launch durability and analysis bookkeeping.

The planned primary paired Jev-versus-code comparison uses the replacement hybrid batch. Baselines started earlier in a separate replacement window, so baseline comparisons are exploratory and cannot attribute differences solely to architecture or model latency. The original completed records are retained as descriptive attempts, not pooled into the replacement summary. The published exporter includes every attempt and its status. Durable workers keep exit status independently of the launcher; saved finished results also remain usable when a launcher disappears.

## Paid endpoint stopped: no complete primary comparison

At approximately 18:26 UTC, OpenRouter returned HTTP 402, "Insufficient credits," for both Jev arms. All 16 replacement Jev trials exited after three consecutive provider failures, as specified by the frozen controller. They had each reached about tick 120–125. There was no substituted military controller, and their final industry and win/loss remain unknown. The free Space Bunny profile continued to work. This is an account-credit failure, not evidence of Jev choosing losing moves. The replacement Jev arms reported about $0.0259 before stopping; that is reported study usage, not a measurement of the account's initial balance or all other account activity.

The replacement primary comparison has **zero complete pairs**. There is no valid confirmatory p-value or effect confidence interval. The exporter supplies logical worst/best missing-outcome bounds from the 59-province map and its maximum development of three: personal industry lies between 0 and 177. These bounds are deliberately loose and are not estimated scores or confidence limits.

The original batch has 19 authoritative finished records and 13 interrupted attempts. All completed original records were coalition wins, but reporting their completion-conditioned win rate as a general success rate would select on early finishes. The four country/seed blocks with both original coded and Jev results were:

| Country | LLM + code own industry | LLM + Jev own industry | Jev minus code |
| --- | ---: | ---: | ---: |
| Britain | 25 | 18 | −7 |
| Germany | 29 | 28 | −1 |
| Ottoman | 14 | 21 | +7 |
| Qing | 30 | 24 | −6 |

Their descriptive mean difference is **−1.75 industry**. Jev is higher in one pair and lower in three. Do not apply the preregistered eight-block inference to this selected subset, or claim proof that Jev is worse. It gives no affirmative evidence of improvement.

Pure Jev completed seven original bot games, all coalition wins, with own industry ranging from 11 to 24. It sent no generated messages. Repeated rejected alliance proposals during a pending membership change exposed a defect in its finite candidate filter. That filter was left unchanged after the protocol freeze, rather than tuned on results. Bot alliances and coalition wins are insufficient evidence for human negotiation; retain an LLM for the part of the game the user cares about.

## Recommendation

Keep the default PI player unchanged. If faster military reactions are worth a follow-up, first compare LLM strategy/diplomacy plus the small coded selector against the current PI system over a complete matched batch. Only add Jev if a replenished-account study shows a useful improvement over that same coded selector. Do not start with local model serving, fine-tuning, multiple planners or a larger game system.

The remaining uncertainties are playing strength over complete pairs, response to human negotiation, planner-model dependence, and the restricted candidate menu. The normal PI baseline retains long-range attacks and turn-around, which this experimental tactical menu lacks. The study does not establish human enjoyment, human-opponent strength or game balance.

Replacement analysis command:

```sh
node agents/pi/study-analysis.js data/jev-study/main --baseline-replacement data/jev-study/baseline2 --hybrid-replacement data/jev-study/hybrid2
python scripts/plot-jev-study.py
```
