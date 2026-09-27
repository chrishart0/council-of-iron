# Action-path experiments — 2026-09-27

## Question

Can a rule or read-only agent tool make conquest a plausible route to individual Prestige without instructing players to act more aggressively?

The eight-model public match `5b3f1596` motivated the test. Its winning German–Russian side finished with 86 of 220 active industry (39.1%), far from the existing 60% decisive hold. At tick 1700 it had 84 of 222 (37.8%): five industry short of a hypothetical 40% hold, but fifty short of the actual 60% hold. It did capture original French and Ottoman provinces late, yet never attained 40% before the deadline. A lower conquest route would have made earlier attacks consequential without retroactively changing that match's result.

## Controlled heuristic runs

Each row used the same 64 seeds, `940000`–`940063`, eight countries, the published map and `diplomacy` tournament mode. The base engine was a copy of the working tree on this date: it included the in-progress faster march, level-IV development, and industry-based defense changes. A temporary experimental copy removed the engine's fixed `economyShare: .6` override to permit map-rule variants. The conquest alternatives also marked original owners at join and allowed a side to begin the ordinary 90-tick decisive hold at the alternative share if it currently owned the specified number of provinces that began under a rival seat. The main 60% route remained available. No experimental rule was installed in the live repository.

| Rule | Decisive / 64 | Mean finish tick | Mean battles |
| --- | ---: | ---: | ---: |
| Current 60% hold | 56 | 1082 | 348 |
| Plain 50% hold | 63 | 827 | 282 |
| Plain 45% hold | 64 | 694 | 245 |
| Plain 40% hold | 64 | 578 | 211 |
| 60%, or 40% plus two rival starting provinces | 64 | 586 | 213 |
| Above conquest route opens at tick 900 | 64 | 907 | 306 |
| Above conquest route opens at tick 1200 | 64 | 1016 | 332 |
| 60%, or 45% plus two rival starting provinces, opens at tick 900 | 64 | 933 | 313 |

The first attempted threshold comparison was invalid: `createGame` forced `economyShare: .6` after loading map rules. It produced four identical baselines and is excluded above. All listed threshold variants used the corrected **temporary** experimental copy.

These controllers are intentionally simple and highly combative. Even at 60%, they averaged 348 battles and about ten alliance activations per match, whereas the eight-model match had 60 battles and two alliance activations. They do not understand messages or weigh individual Prestige like the model players. Consequently, the table measures mechanical pacing under one controller family, **not** likely LLM behavior, strategic quality or enjoyment. A current-worktree versus committed-HEAD comparison (mean finish 1082 versus 1194, mean battles 348 versus 299) combines several in-progress rule changes, so it does not isolate travel, development or defense effects.

## Decision from this iteration

Do not replace 60% with a plain 40–50% threshold: it ended these games substantially earlier and gave them fewer battles. Keep the conquest-gated lower threshold as an experimental candidate, especially an opening time near tick 1200, but test it with actual model seats before adopting it. The condition must be communicated to humans and agents, score/replay reconstruction must preserve original ownership, and the extra decisive path needs dedicated rule tests.

The additive `strategic_options` tool only derives facts from the normal player observation and match map: the exact current decisive gap, last possible hold start, static effect of nearby captures, and possible independent partners. It makes the current rule's incentives legible without changing the rule, issuing orders, or modifying agent instructions. Combat and diplomatic outcomes remain uncertain. The model-match runner now includes the same result in its observation data by default. Set `COUNCIL_STRATEGIC_OPTIONS=0` for a control run; its manifest records the choice and rejects a resume with a different setting. The runner's decision prompt is otherwise unchanged.

Next model comparison: keep the same prompt and model roster, rotate country assignments, compare a control match with the read-only options exposed, and review accepted war declarations, attacks on occupied rivals, alliance decisions, decisive-hold attempts, personal Prestige and spectator pacing. Repeat across more than one seed before attributing behavior to a rule or tool.
