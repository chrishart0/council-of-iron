# Balance and pacing investigation — v0.2

**The game is playable. The equal-budget world scenario is not yet competitively balanced.** This release fixes defects and makes the problems measurable; it does not hide the remaining geographic advantage behind a new rating formula.

## What ran

The retained local reports contain **3,488 complete matches**: an initial 32-match baseline, 23 configurations at 128 matches each (2,944), and two fresh-seed 256-match holdouts (512). Repeated verification runs are not added to this headline. Every match reached an authoritative terminal result. Zero troop-conservation, nonnegative-garrison, valid-army, terminal-timing or prize-pool invariant failures were observed in these runs.

The tests are **seeded heuristic self-play**, not 3,488 independent human/LLM trials. Four policies vary aggression, neutral preference, reserve size and attack fraction. Their 5/10/15-game-second decision cadence, style assignments and request order vary by seed. They deliberately consume the same engine action validation and observations as players. They are much weaker than a good adaptive player and have no language understanding. Their results diagnose risks; they do not estimate human or LLM win probabilities.

The fixtures include added sea connections, distributed starting possessions, relocated home areas, and different starting-army budgets. Experimental setup happens before play. No test injects a mid-match capture, final outcome or extra troops. See `tests/balance-cases.json`; **none of those balance candidates changes the shipped scenario**.

## Fresh-seed holdout: published scenario

Solo mode, seeds **100000–100255**, eight seats, 256 complete matches:

| Country | Solo wins | Share of all 256 games | Mean match Prestige |
|---|---:|---:|---:|
| Britain | 0 | 0.0% | -97.3 |
| France | 2 | 0.8% | -91.0 |
| Germany | 0 | 0.0% | -97.3 |
| Russia | 1 | 0.4% | -94.1 |
| Ottoman Empire | 89 | 34.8% | +180.9 |
| Qing Empire | 19 | 7.4% | -37.9 |
| Japan | 27 | 10.5% | -12.9 |
| USA | 111 | 43.4% | +249.6 |

Seven draws account for the remainder. The USA and Ottomans won **200/256 games (78.1%)**. This is strong evidence that this scenario/controller combination is not an even contest. It is not proof that an expert human cannot win from Britain.

The likely mechanism, consistent with the map and observed expansion, is unequal access to uncontested recruitment land: crowded European positions fight over limited openings while some peripheral positions expand. Equal troop budgets do not compensate for that. This is an interpretation to test further, not a causal estimate isolated from policy weaknesses.

### Diplomacy does not erase the problem

Diplomacy mode, seeds **200000–200255**, 256 matches: controllers sometimes propose small alliances, accept them and leave. This is mechanical coalition stress-testing, **not natural-language negotiation**.

| Country | Winning-roster appearances | Mean match Prestige |
|---|---:|---:|
| Britain | 44 | -73.2 |
| France | 72 | -50.3 |
| Germany | 47 | -72.4 |
| Russia | 56 | -62.1 |
| Ottoman Empire | 170 | +16.7 |
| Qing Empire | 94 | -26.4 |
| Japan | 97 | -30.5 |
| USA | 197 | +35.7 |

There was one draw. Multiple members can share a winning roster, so these counts must not be summed as independent wins. A retained eliminated ally can appear on a winning roster while still earning negative Prestige. This is why tracking only a team-win flag would misrepresent the objective.

## Pacing observations

| Measure | Solo | Diplomacy |
|---|---:|---:|
| Mean match duration, game time | 28:09 | 18:17 |
| Mean first combat | 00:46 | 00:46 |
| Mean first elimination among games with one | 08:27 | 08:38 |
| Mean accepted moves per match, all eight seats | 662.2 | 484.5 |
| Mean battles per match | 495.8 | 332.7 |

Neutral expansion combat is included in “first combat”; 46 seconds is the predictable first order tick plus travel time, not evidence that humans meet enemies that quickly. Coalition formation shortened matches in this fixture. It does not establish that 45-second movement is ideal or that an LLM has enough wall-clock time to reason and negotiate. Test that at **Standard speed**, with real controller latencies; Quick and accelerated CI are not fairness benchmarks.

## What was rejected

Several obvious fixes moved the advantage rather than removing it. In 128-game discovery runs, the `colonies` candidate produced 99 USA wins; `crossings` produced 58 Japan wins; `home-crossings` produced 65 France wins. Starting-army handicaps could spread the bot wins more evenly, but needed large country-specific compensations and remained dependent on weak policy behavior.

Do not ship those numbers as “balanced.” The release retains equal starts and the original graph, flags the imbalance, and commits reproducible alternative fixtures so the next change can be compared against the same cases and fresh seeds. Scotland and Ireland's troop counters were moved back near their named land; that is a rendering correction only and does not change adjacency or production.

## Reproduce

```sh
npm test
npm run test:balance -- --rounds 256 --seed 100000 --mode solo --out artifacts/holdout-solo.json
npm run test:balance -- --rounds 256 --seed 200000 --mode diplomacy --out artifacts/holdout-diplomacy.json
# A rejected candidate, without changing the public game:
npm run test:balance -- --rounds 128 --seed 1000 --variant crossings --out artifacts/crossings.json
```

`docs/testing/summary.json` preserves every discovery summary, both holdouts, seed ranges, engine/map hashes, and the counting method. The raw per-match JSON is generated under `artifacts/`; it is not loaded by the game. CI runs smaller fresh-seed smoke tournaments to catch regressions. An accepted command log still replays deterministically in the engine test suite.

## Next balance gate

Before competitive use, revise accessible neutral land and travel connections, then require several materially different competent controllers to rotate through every country. Retest on unused seeds and run Standard-speed human/LLM matches. Report both individual Prestige and winning-roster membership. Evaluate last-minute admissions, alliance collapse and survival—not just country win counts. Do not add economies, units or opaque contribution scoring to mask an unresolved map problem.
