# Hands-on eight-seat playtest — 27 September 2026

> **Historical record, earlier rules.** This match was played with recruitment arrows, coalition war votes, a command budget and Prestige scoring, none of which exist now. Its findings #1 (coordinated arrivals and recalls earn their complexity) and #2 (recruitment arrows are a trap) motivated the single `march` order and rally-only reinforcement in the [simplification pass](SIMPLIFY-PLAN.md). Replayed under today's rules on the v6 board (merged province ids mapped by the replay adapter), the same decisions reach the 1800-tick deadline, where the same Atlantic Accord wins on industry.

**One complete game, controlled by one ChatGPT assistant across all eight countries.** This is not a subagent tournament, live model comparison, or independent human usability test. Production base: `e9d8d768d27e04b6555aeb5c772e80f12d9e4512`, industrial scenario `imperial-1910-v3`. No production rules, starting assets, or balance settings were changed for this test.

## Method

The assistant read the board, selected concrete troop orders and investments, authored diplomatic messages, evaluated offers from each country's position, and revised plans after observing results. No practice policy selected actions. Eight distinct authenticated player profiles joined through the real HTTP API; none had the built-in `bot` kind. The initial game and HTTP replay both stored results as experimental.

The clock was locally stepped between decision rounds using the existing server test seam, not a public advance-time endpoint. Commands still went through normal authentication, ownership checks, budgets, reservations, travel, combat and scoring. Decision ticks were 0, 30, 70, 95, 130, 205, 305, 335, 410, 480, 540 and 580. Thirteen advances reached tick 630. All factions got attention, but this coarse, irregular cadence is **not a continuous Standard-speed latency test**.

This shared context cannot conceal one faction's intentions from the controller playing another. Formal inbox visibility was still enforced by the server, but strategic information isolation was not. Opposing interests were an effort at role separation, not independent minds. Cooperating factions may have coordinated unrealistically well. Do not infer country win rates or deception resistance from this game.

## Result

The **Atlantic Accord (Britain, France, USA)** won by domination at **630 ticks / 10:30 game time**, controlling **50 of 79 provinces** after its final uninterrupted 90-tick hold.

| Country | Final provinces | Individual Prestige |
|---|---:|---:|
| Britain | 17 | +166.67 |
| France | 17 | +166.67 |
| USA | 16 | +162.22 |
| Russia | 13 | −100.00 |
| Ottoman | 7 | −100.00 |
| Qing | 7 | −100.00 |
| Germany | 2 | −100.00 |
| Japan | 0 | −100.00 |

Japan retained nine troops sailing toward the Philippines, arriving after the match ended. It was correctly not marked eliminated, but still received the losing score. The USA joined the Accord at tick 335, giving it 295/300 ticks of maturity at the finish. Total paid points were 795.5556 of the maximum 800; the unearned portion was not redistributed.

### Activity

343 accepted actions: 202 single-source moves, 16 coordinated attacks, 75 private messages, 5 alliance proposals, 7 acceptances, 5 recalls, 14 development orders, and 19 recruitment-route orders. The game resolved 108 battles; all 14 investments completed. There were no execution-time `order_failed` events.

Accepted actions by country: Britain 44, France 48, Germany 47, Russia 47, Ottoman 39, Qing 41, Japan 33, USA 44. These are recorded inputs, not a claim of equal strategic attention or optimal play.

## The course of the game

**Opening:** Britain and France negotiated separate continental expansion targets and formed the Atlantic Accord at tick 30. Germany and the Ottomans formed the Continental Compact at the same time. Russia and Qing formed the Eastern League at tick 60. America initially stayed independent, negotiated borders in Canada and the Pacific, and expanded in the Americas.

**Early reversals:** Germany's synchronized Low Countries attack met Britain's bridgehead after its initial capture. Japan turned back a Manchurian commitment when visible opposition made it unattractive. Britain and Qing also recalled unfavorable attacks. The Low Countries changed hands repeatedly; capturing a province did not mean it was safe from the next arriving wave.

**Coalition bargaining:** Japan entered the Continental Compact at tick 125 after obtaining both incumbent votes. America later considered German and Atlantic overtures, then joined Britain and France at tick 335. Its broader territorial base made the three-country coalition much closer to the global target. Britain rejected further dilution by a Russian entrant. Russia and Germany instead negotiated an informal ceasefire to attack the leader; the Ottoman seat similarly redirected against Britain.

**Consequential cooperation:** France transferred 70 troops to Britain's Low Countries garrison. When a 120-troop Russian attack arrived at tick 539, the 136 defenders held with 16 survivors. Separately, Russia and Qing submitted independently controlled orders for the same tick 535: 54 Russian and 16 Qing troops combined against 64 defenders in North India. Russia received the captured province and six survivors. These are actual adjudicated events, not a hypothetical battle calculation.

**Contested endgame:** The Accord's dominance warnings began at ticks 473 and 518, but its territorial majority was interrupted both times, at 505 and 535. It recovered the threshold at 540 and finally held until 630. America asked its partners not to finish before its maturity reached 100% at tick 635. France declined to delay a secure victory. The natural game result was five ticks short of the American full share, not an injected outcome or manually set victory clock.

## Findings

### 1. Coordinated arrivals and recalls earn their complexity

They supported real decisions rather than decorative controls: concentrate separate garrisons, synchronize with an ally, or reverse a now-unfavorable commitment. Five recall commands reversed seven marching armies containing 127 troops and cancelled one still-waiting component. Their return journeys took time. The manpower ledger reconciled throughout; troops were not refunded instantly or duplicated.

**Recommendation:** keep these mechanics. Prioritize clear marching/waiting/returning states and actual arrival times over adding new unit types.

### 2. Recruitment arrows are not a reinforcement conveyor

The assistant set an East US → Central US → West US chain, then had to move accumulated reinforcements manually. A route forwards only newly recruited local troops, not incoming troops. Central US ended with 50 troops despite having a westbound recruitment arrow. This follows the documented rule; it is a usability trap, not a simulation bug.

**Recommendation:** make “new local recruits only” explicit at the point of use, and surface idle reserves at intermediate provinces. A separate forwarding mode would change the mechanic and should be considered deliberately, not quietly introduced as a bug fix.

### 3. A map advantage can become a coalition threshold advantage

America's admission made its distant holdings count toward the same global target as Britain's and France's. Opponents responded diplomatically and broke the countdown twice, which produced a useful climax. The resulting 10:30 finish was much faster than previous heuristic averages, but controller, coordination and cadence all differed; this is not a controlled speed comparison.

**Recommendation:** show coalition land gain and the resulting victory threshold before approving an admission. Do not rebalance the USA, France or coalition size from this single game.

### 4. Development competes with a possibly short war

Fourteen completed investments show that construction works during actual play. They do not prove every upgrade was profitable before victory. In particular, a level-II-to-III investment has a long recovery period relative to this match's duration. All captures and recruitment still reconciled correctly.

**Recommendation:** expose estimated additional recruits before the deadline and a clearly qualified manpower payback estimate. Keep the troop-versus-industry decision; collect more evidence before changing its costs.

### 5. Passing armies and repeated ownership changes need clear feedback

Crossing British/Ottoman attacks exchanged possession of Egypt and the Levant without intercepting each other. Other fronts saw capture followed by rapid recapture. This is consistent with combat occurring at provinces, not on connections. It can nevertheless look wrong without readable arrival history.

**Recommendation:** emphasize incoming waves, the previous battle and the reason a victory countdown stopped. Do not add road battles solely to conceal confusing presentation.

## Bugs, mistakes and verification

No new production adjudication bug was demonstrated. Three assistant-issued commands were correctly rejected: two nonadjacent Ottoman orders and one move committing troops that had not yet arrived. The HTTP replay confirmed each rejection leaves game state unchanged. These were operator mistakes, not bugs fixed in the engine.

The recorded game was then replayed through both the deterministic engine and eight real authenticated HTTP seats. Both reproduced the complete final military state, scores and event-log digest. Replaying the same game is verification, **not additional independent matches**.

The ledger checked the initial state and all 630 ticks:

```text
659 initial + 3,959 recruited − 192 invested − 2,102 casualties = 2,324 remaining troops
```

The six new regression tests cover full replay/conservation, all 75 DMs' recipient visibility, cross-player synchronized arrivals and reinforcement, recalls, partial maturity/in-transit survival/idempotency, and the real-HTTP replay with experimental result persistence. **All 65 Node tests and JavaScript syntax checks passed locally.** No new browser-UI or live-LLM test is claimed in this record.

## Reproduce

```sh
npm test
node scripts/replay-handplay.js
node scripts/replay-handplay.js --http
```

The runner now replays the recorded decisions under the current rules through an adapter (war declarations before marches, rejected orders skipped and counted), so its output no longer matches the tick-630 result described above.

The gzip fixture at `tests/fixtures/handplay-20260927.json.gz` contains every accepted command, the rejected inputs, clock advances and expected final state. The replay runner does not contain a decision policy. Read the fixture with `gzip -dc tests/fixtures/handplay-20260927.json.gz` or Node's built-in zlib. Messages are synthetic dialogue authored for this test, not real participants' private communications. No credential or database is included.

The [machine-readable verification](testing/handplay-20260927.json) records counts and hashes. Production game files and balance values are unchanged by this test-only addition.
