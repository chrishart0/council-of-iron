# Map imperial-1910-v4: Hawaii (user-requested published-map change)

A player reported that "the Pacific is hard" and asked for a development-1 Hawaii province. This is a deliberate change to the published map, requested by the user. It is not a silent balance tweak (see AGENTS.md: balance candidates normally live in `tests/balance-cases.json`).

## What changed
- **New province `hawaii`:** neutral (nobody starts there), development 1, the standard neutral garrison of 2. The three real Hawaiian island rings that v3 drew inside `west-us` (a side effect of the nearest-seed partition) now belong to Hawaii. The chain is enlarged 2.2× about its centre so it stays visible and tappable. Its counter anchor is (93.77, 295.38), the middle island, near the left edge of the 1280-unit world; with the wraparound it sits mid-Pacific, next to the dateline seam.
- **Sea links:** `west-us`, `south-japan` and `philippines`. The existing direct links `west-us↔south-japan`, `west-us↔philippines` and `alaska↔far-east` are kept, so Hawaii adds a staging base and removes nothing. Links to `alaska`, `new-zealand` and `east-indies` were considered and left out: they would give the USA more reach without making the Pacific crossing easier.
- **`west-us` geometry:** loses only those island rings. Its anchor, borders, neighbours and play data are unchanged. Every other province keeps identical geometry and data, except that the three linked ports gain `hawaii` as a neighbour. No country's start, garrison or industry changed.

## Travel times (game seconds, current rules: 15 s setup + distance ÷ 35 km/s)
| Link | Ticks |
|---|---|
| West US → Hawaii | 136 |
| Hawaii → Southern Japan | 219 |
| Hawaii → Philippines | 264 |
| West US → Southern Japan (direct, kept) | 281 |
| West US → Philippines (direct, kept) | 345 |

Going via Hawaii is slower end to end (136 + 219 = 355 s versus 281 s direct), because each leg pays the setup time. What Hawaii offers instead is:
- **A forward base:** once Hawaii is held, Japan is 219 s away instead of 281, and the Philippines 264 instead of 345.
- **A way to reinforce in stages:** recruits and transits can gather there first.
- **A contestable neutral prize.**

For the proposed logistics ruleset (not yet merged or pushed, so its doc wasn't available to check): if movement becomes 1.2× faster, every figure scales to about 1/1.2 (for example 136 → ~113 and 219 → ~183). If the ×2 speed-up applies only to links owned at both ends, it would apply to the Hawaii links only when the same side holds both Hawaii and the far port; the times above are the unowned or contested case.

## Versioning (superseded)
Since the 2026-09-27 merge the game keeps no backward compatibility: v4 is the only map, `public/maps/imperial-1910-v3.json`, `scripts/build_imperial_v4.js`, `tests/map-versions.test.js` and the per-room map registry are removed, and v3 rooms are skipped at startup. The notes below describe the earlier two-map arrangement.
- **Registry:** `src/maps.js` exposes `CURRENT` (v4), `MAPS` (v4 and the byte-frozen `public/maps/imperial-1910-v3.json`), and `mapFor(g)`, which returns the map a room was created with (`g.scenario`).
- **Server:**
  - It loads rooms of any known scenario.
  - It passes `mapFor(g)` to every rule call (actions, previews, plans, bots) and to after-action review.
  - `/api/games/:id/map` returns the room's own map; `/map.json` is the current one.
  - `makeServer({ newRoomMap })` lets tests replay a v3 recording through HTTP.
  - Standings group v3 and v4 results together: same rules, and v4 adds only a neutral province.
- **Rooms:** each room already froze its coordinates and travel times at creation, so a v3 room never sees Hawaii.
- **Recorded match:** the golden handplay replay runs on v3. Its event-log hash and the HTTP replay hash are unchanged.
- **Tests:** `tests/map-versions.test.js` covers the v3 hash, the v4 builder output, the v3→v4 diff, a v3 room observed/acted/ticked/reviewed without Hawaii, and a stored v3 room served by the server next to new v4 rooms. It also records the Pacific travel times above.
- **Real data:** a read-only copy of a real database (`council-ux`, 2 finished v3 rooms) was loaded and every room observed, previewed and reviewed on its own map with no errors. That check is a local script and the copy is not committed.

## Victory threshold
The industry threshold is 60% of **owned** development (`economyThreshold`). An unowned Hawaii adds nothing, so thresholds at the start of a new room are unchanged. Whoever captures Hawaii adds 1 to the total active industry, which can raise the threshold by at most 1.

## Heuristic balance (not a claim about human play)
`npm run test:balance -- --rounds 32 --mode diplomacy` uses the same seeds (1000–1031) and the same heuristic bots. `countryWins` counts the rounds where the country was on the winning side:

| | v3 | v4 |
|---|---|---|
| USA | 18/32 (56%) | 19/32 (59%) |
| Japan | 10/32 (31%) | 8/32 (25%) |
| Qing | 6 | 2 |
| Germany | 9 | 17 |

With the same seeds and 0 invariant failures, one extra neutral province changes early bot decisions across the whole map. Changes of this size in heuristic self-play are noise-level for 32 rounds and do not measure human balance. Watch Japan in real play.
