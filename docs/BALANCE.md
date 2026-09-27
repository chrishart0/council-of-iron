> **Controller version matters.** The archived figures below used earlier policies. v0.6 introduces stronger traditional opponents without changing map assets or rules. See [the new bot test record](testing/v06-local.json); do not treat the old results as current human win probabilities.

# Balance refinement — v0.3

## Target and result

The target changed: five strong great powers (USA, Britain, Germany, France, Russia), with an Ottoman start below that group, rather than eight equal win rates. We changed the scenario and added visible/capturable industry, more European provinces, colonial holdings, distance-based movement and coordinated/recallable attacks. **Do not compare this directly against v0.2 as a controlled single-variable experiment.**

The selected scenario is candidate **q**. Final fresh-seed validation uses 610000–610255 (solo) and 710000–710255 (mechanical diplomacy). These ranges were not used to select q. The intended five are the highest group both by solo victories and by mean individual coalition-mode Prestige in these runs. France is still strongest in solo play; Britain leads coalition-mode Prestige. This is not a guarantee of equal opportunities or historical accuracy.

| Country | Solo wins / 256 | Share of all games | Mean Prestige, diplomacy |
|---|---:|---:|---:|
| French Republic | 79 | 30.9% | -5.5 |
| United States | 51 | 19.9% | -22.0 |
| German Empire | 47 | 18.4% | -22.6 |
| British Empire | 36 | 14.1% | +10.9 |
| Russian Empire | 26 | 10.2% | -23.8 |
| Ottoman Empire | 11 | 4.3% | -59.2 |
| Empire of Japan | 0 | 0.0% | -67.1 |
| Qing Empire | 0 | 0.0% | -67.6 |

Solo: **6 draws**, mean duration **29:05 game time**. Diplomacy: **1 draw**, mean duration **21:50 game time**. Coalition membership is not an exclusive win count; winning-roster appearances and positive Prestige are different. Eliminated allies or recent joiners can be on the winning side yet have negative Prestige. The partly paid scoring pool is deliberately negative-sum.

## What actually ran

**2,368 retained complete v0.3 simulation matches**, not counting interrupted attempts, unit-test replay or CI repetitions: 17 discovery configurations ×64 (1,088), two F validation sets ×256 (512), final q solo/diplomacy ×256 (512), and four controller ablations ×64 (256). All reached a terminal result with zero checked conservation, nonnegative-garrison, valid-army, deadline or prize-pool invariant failures.

Four **related heuristic controllers**, not LLMs, vary aggression, neutral preference, reserve, investment, synchronization, recall and attack fractions. Assignment and actor order rotate by seed; 5/10/15-tick decision cadences vary. They see only ordinary observations and submit ordinary validated actions. Mechanical diplomacy offers, accepts and sometimes leaves coalitions; it does not understand chat or model human persuasion. No inference tokens were used. There are no independent-human playtest results. A second competent controller family and Standard-speed human/LLM trials are still needed before competitive claims.

[Machine-readable summaries](testing/v03-summary.json), [candidate fixtures](../tests/industrial-cases.json), [tournament harness](../scripts/tournament.js). The final map hash is `5e71abad601fbb2411415eb3371eef02c1814cdc93f5467bf3befb06201ed8f1`. Reports store every seed's territory, Prestige, style/cadence and event counters; full retained reports are supplied in the release evidence bundle.

## Refine → test → refine

Initial industrial map: Germany won 31/64; Britain 0. The first attempt overcorrected the previous scenario. Stronger Ottoman industry (6→8 recruits per cycle) also made that start too strong, so it was rejected. Candidate F improved discovery results, but a 256-game validation still gave Britain only seven solo wins. That failed validation became discovery evidence; it is not the final holdout.

Additional British colonial provinces and long sea routes were tested separately; they were not a reliable cure in these controllers. Large colonial garrison increases helped but were not selected. The shipped q instead strengthens visible colonial industry and moderate garrisons, retaining Germany's developed compact homeland and African footholds. Starting development is a province asset available to any captor, not a hidden faction multiplier.

| Country | Holdings | Starting troops | Recruits per game minute |
|---|---:|---:|---:|
| British Empire | 9 | 126 | 66 |
| French Republic | 9 | 88 | 54 |
| German Empire | 8 | 86 | 48 |
| Russian Empire | 8 | 96 | 45 |
| Ottoman Empire | 4 | 56 | 18 |
| Qing Empire | 5 | 60 | 15 |
| Empire of Japan | 3 | 36 | 18 |
| United States | 5 | 55 | 33 |

Those deliberately unequal budgets are part of the authored scenario. They are not historical census figures. Colony count alone is not the balance metric: distance, neighboring powers, accessible neutral provinces, concentrated industry and reinforcement delays all matter.

## Feature ablations, same seeds 820000–820063

These restrict what the controllers use, not the rules available to real players. They do **not** erase starting industry or isolate the cause of the entire balance improvement. In particular, the no-build controller still benefits from its starting factories.

| Controller restriction | Mean game duration | Develop orders / match | Recall orders / match | Synchronized attacks / match |
|---|---:|---:|---:|---:|
| mixed | 29:08 | 17.7 | 52.6 | 169.6 |
| no-build | 28:41 | 0.0 | 54.5 | 168.8 |
| no-sync | 29:32 | 18.2 | 47.7 | 0.0 |
| no-recall | 29:28 | 16.7 | 0.0 | 172.0 |

Development was used in ordinary matches, but suppressing new construction barely changed some win counts. That is evidence against claiming the build button alone solved balance: starting assets, map structure and movement changed too. Synchronization and recalls create visible choices and materially change these controllers' behavior; the tests do not establish that either is fun for humans.

## Reproduce

```sh
node scripts/tournament.js --rounds 256 --seed 610000 --mode solo
node scripts/tournament.js --rounds 256 --seed 710000 --mode diplomacy
python scripts/balance_scenario.py f artifacts/f-map.json
node scripts/tournament.js --rounds 256 --seed 410000 --map artifacts/f-map.json --mode solo
node scripts/tournament.js --rounds 64 --seed 820000 --policy no-build
```

Do not tune further against the final holdout while continuing to call it held out. New designs need new validation seeds and stronger/different controllers. France's solo lead, British coalition strength, very weak Qing/Japanese solo outcomes, late-entry timing, and factory-vs-expansion choices remain explicit human/LLM test targets. Smaller lobbies are supported but these balance conclusions are for eight seats only.

---

# Historical v0.2 investigation (superseded scenario)

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
