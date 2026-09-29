# Balance runs

**Heuristic self-play does not prove balance or fun.** The practice bots (`agents/industrial-policy.js`, seeded styles in `tests/simulation.js`) attack only with clear superiority, never tire and do not bargain. These runs check invariants (troop conservation, valid garrisons and armies, the deadline, consistent results, the alliance size cap) and that matches still resolve. Starting positions are deliberately asymmetric; do not tune starting armies to these bots.

## Map v6 (2026-09-28)

The published map became `imperial-1910-v6`:
- 59 larger provinces in eight regions, with smoothed borders;
- five impassable borders: the Himalayas, the Urals, the Alps between Italy and France, and the Sahara (twice);
- Hawaii as the only mid-Pacific crossing;
- new starting setups.

The full analysis, the static exposure table and the self-play comparison are in [MAP-V6.md](MAP-V6.md).

On the final merged engine (border attack rule, alliances of at most three), over 256 matches the spread of winning-side appearances fell:
- diplomacy: from 130/25 (SD 44.9) on v5 to 133/53 (SD 25.9) on v6;
- solo: from 108/0 to 83/3.

The watch items are the USA's lead, Japan, and Britain in solo mode. These results come from heuristic bots, not humans.

## Simplification pass (2026-09-28)

Same seeds, same map (`imperial-1910-v4`), before (merge commit a148680) and after the simplified rules: one march order through own and allied land, rallies instead of recruitment arrows, recall without resume, alliance-wide war and peace without votes, win-or-lose results with alliances capped at half the countries, no opening council, no capture damage, an invisible 10-per-10 s order limit instead of 3 per 10 s. The bots now rally their interior to the nearest front instead of setting recruitment arrows. 256 matches per row; zero invariant failures in every run.

| Diplomacy mode (seeds 950000–950255) | before | after |
|---|---:|---:|
| Mean / median match length (ticks) | 1212 / 1200 | 1260 / 1260 |
| Decisive (60% hold) · deadline wins · deadline draws | 207 · 49 · 0 | 203 · 53 · 0 |
| Battles per match · median / mean / p90 battle length | 322 · 9 / 12.1 / 23 | 322 · 10 / 12.9 / 24 |
| Develop orders per match · matches reaching industry III · final industry per province | 7.7 · 42 · 1.56 | 6.9 · 37 · 1.67 |
| Recalls · multi-source marches per match | 30.7 · 126.5 | 30.8 · 129.0 |
| Idle share (surplus unmoved > 120 ticks) · interior only | 20.5% · 7.0% | 20.6% · 7.1% |
| Mean leg ticks internal / foreign / sea | 21.8 / 40.8 / 51.6 | 21.9 / 41.1 / 50.6 |
| Winning-side appearances Britain / France / USA / Russia / Germany | 159 / 131 / 138 / 117 / 109 | 151 / 138 / 129 / 109 / 106 |
| … Japan / Ottoman / Qing | 53 / 49 / 32 | 57 / 46 / 30 |

| Solo mode (seeds 960000–960255) | before | after |
|---|---:|---:|
| Mean match length · decisive · deadline wins · deadline draws | 1764 · 39 · 213 · 4 | 1749 · 53 · 198 · 5 |
| Battles per match · median battle length | 477 · 10 | 456 · 10 |
| Wins France / USA / Russia / Germany / Britain | 92 / 59 / 48 / 33 / 14 | 107 / 43 / 36 / 36 / 22 |
| Wins Ottoman / Japan / Qing | 5 / 1 / 0 | 7 / 0 / 0 |
| Matches reaching industry III · final industry per province | 4 · 1.50 | 12 · 1.66 |

Readings (not claims):

- **Matches still resolve** at the same rate and length. No stalemates appeared in diplomacy; solo deadline draws stay at about 2%.
- **Industry survives captures** now, so final industry per province rises (1.56 → 1.67) and slightly more solo matches end by a 60% hold. Conquest is worth more; watch for snowballing in human play.
- **Country spread is unchanged within noise** in diplomacy. In solo, France gains and the USA loses some deadline wins; solo is not the normal mode, and bots do not use the USA's space well. Keep the USA and Britain/Japan seats as watch items for human playtests.
- **Battles** are as long as before (median 10 ticks, p90 24): the simplification did not change combat pacing.
- The **alliance size cap** (at most half the countries) never triggered an invariant; the tournament's diplomacy script already proposed rosters of at most four.

Reproduce: `node scripts/tournament.js --rounds 256 --seed 950000 --mode diplomacy` and `--seed 960000 --mode solo` (run the same command in a checkout of a148680 for the "before" column). The required gate is `npm run test:balance -- --rounds 32 --mode diplomacy`.

## Earlier evidence

The movement and pacing numbers (links ×1.2, internal links ×2, four battle rounds per five seconds, development 24/120 s then 48/180 s) were chosen by the user and checked with the same harness in September 2026; that write-up, the v0.2/v0.3 map candidates and their machine-readable summaries are in git history before this pass.
