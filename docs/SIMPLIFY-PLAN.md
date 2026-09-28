# Simplification pass (2026-09-28)

User request: *"Ruthlessly cut unneeded complexity, focusing on having the best gameplay loop."*
Direction from the playtests: territorial.io / HoI4 flavour, trench era, faster movement, slower battles,
rally points instead of micromanagement, clear war / alliance / messaging, **keep the map**, and the key
complaint *"too complex, I get lost"*. The user approved both buckets below ("do both"); this file is the
record of each rule before → after.

## The core loop

**Expand, build, bargain, fight, hold.** Grab neutral land; turn troops into factories (more troops later)
or spend them now; talk to the other leaders and form an alliance; declare war; march on the fronts and
let rally points feed them while slow trench battles grind; win by holding 60% of the world's industry for
90 seconds (or by having the most at 30:00).

Every rule is judged against the five decisions that make that loop fun:

1. **Where to push** — which province, with how many troops, from where.
2. **Guns or factories** — spend troops on an attack now or on industry that pays later.
3. **Who to trust** — whom to ally with, and when to leave.
4. **When to fight** — whom to declare war on, when to make peace.
5. **Where to hold** — which front gets the new troops (rally), when to pull back (recall).

Anything that adds a concept without sharpening one of these five is cut.

## Evidence used

Real play is thin: one hand-played 8-seat match (one model controlling every seat), one 8-model LAN match,
one 4-agent quick room, 50 single-agent benchmark runs against bots, and the user's own mobile playtests.
Heuristic self-play is only used for invariants and "matches still resolve", never as a fun signal.

| Mechanic | What the evidence says |
|---|---|
| Coordinated multi-source attack | Handplay: 16 attacks; "coordinated arrivals and recalls earn their complexity". Keep the idea, fold it into one march. |
| `arriveAt` scheduling | One use in real play (two seats aiming at the same tick); one agent error ("arrival scheduled too early"). |
| Transit through allies | Never used by a human (not even in the browser UI); one agent failure ("invalid allied transit path"). |
| Long march through own land | Browser test only; answers the "hard to move across the Pacific" complaint. |
| Recruitment route | Handplay called it "a usability trap": the chain left 50 idle troops because a route forwards only new local recruits. |
| Rally | Built from the "large amounts of troops sitting around" complaint; no real use yet. |
| Turn around (resume) | No real-play use at all; tests only. |
| Recall | Handplay: 5 recalls, 127 troops pulled back; keep. |
| War/peace votes | 8-model match: 10 wars, 2 treaties; agent errors "vote after offer expired", "duplicate motions". |
| Attacking before war | The most common agent error (4 of Luna's first 10 orders). |
| Maturity / tenure / strength split | Winners scored **negative** Prestige (Luna −63.8 while winning, Codex −50.8 while winning). 13 of 50 benchmark runs scored exactly +100 by surviving to the deadline: "score alone can reward survival". |
| 50/25/25 deadline prizes | Never explained in the live UI (review page only). |
| 60% hold | 8-model match winner reached 39%; heuristic runs reach it. Kept; balance, not complexity. |
| Industry damage on capture | 8 events in the 8-model match; a hidden dice roll on top of the battle. |
| Opening council | Browser test only; bots and most agents take the default. |
| Command budget / chat cooldown | No complaints, but every test and agent works around them, and the UI must explain "next order in Ns" / "Send · Ns". |

## Bucket 1 — CUT NOW (no design debate)

| Cut | Why |
|---|---|
| `public/map.json` (58 KB legacy 64-province map), `scripts/build_map.py`, `scripts/build_imperial_map.py` (emits the old v3 map) | Not served; cannot rebuild the published map. |
| `scripts/balance_scenario.py`, `tests/industrial-cases.json` (74 KB) | Every case fails its hash against the current map. |
| `scripts/run-model-match.js` | Unreferenced; hard-coded LAN IP and model roster; the Pi harness replaced it. |
| 26 of 27 `tests/balance-cases.json` variants and the "logistics-1 equals RULES" test | Rejected v0.2/v0.3/logistics candidates; one ruleset. |
| `docs/design-v0.1.md`, `design-v0.3.md`, `design-logistics.md`, `MAP-V4-HAWAII.md`, `UI-CONCEPTS.md`, 12 of 13 `docs/testing/*` records | Describe old rules, old maps, removed UI; replaced by README "How to play" and `docs/AGENT-RULES.md`. |
| Historical sections of `docs/BALANCE.md`, `docs/PLAYTEST.md`, README v0.5 section and media | Describe superseded rules and screens. |
| Legacy tests ("legacy saves lack headlines", `classic-64` scenario rejection, old-lobby reclaim wording) | No backward compatibility. |
| Compatibility code: `distanceMovement` flag (always true), forced `economyShare`, `|| []` guards on fields `createGame` always sets, `?? default` rule fallbacks, store `scenario` column migration, `turnAroundLimit===undefined` guard, replay `threshold` branches, "legacy rooms" leaderboard text, unused `g.version`, `?scenario=` parameters | AGENTS.md: one ruleset, one map, no migrations. |
| Duplicate agent read tools: `situation` (= `board` + `news`), `leaderboard` (a second meaning of "leaderboard"), `wars`, `world_feed` (in `news`), `strategic_options` (in `board`), `plan_attack` (merged into `preview`) | 42 MCP tools → about 26; three copies of troop availability → one. |
| `GET /api/me` and `store.history` | No client uses them. |
| Browser dead code: `options()`/`syncOptions`, unused handlers (`data-open-alliance`, `data-show-army`, `data-compose`), `Comms.setRead`, the dead `sfx` hooks and ~87 inert `data-sfx` attributes, `reducedMotion`, `TIERS`, test-only `feed-model` exports, unreachable `'open'` relation, unused icons, dead CSS (`.thread-empty`, `.cx-toasts`, `.counter-hidden`, `.industry-label`), two unused legend placements, duplicate clock/`seatType`/`signed`/`atWar` helpers | Unused or duplicated. |
| Copy: "prototype", "experimental", "Industrial scenario allows…" in server/MCP/CLI strings; bot model label mismatch | Copy rule; one name for one bot. |

## Bucket 2 — mechanic cuts and merges (approved; implemented)

| # | Rule before | Rule after | Loop impact | Code removed | Risk | Call |
|---|---|---|---|---|---|---|
| M1 | Five ways to move: `move` (one neighbour), long `move` through own land, `attack` (several sources, optional `arriveAt`), `transit` (explicit path through an ally), `route` arrows | **One `march`**: pick a target and one or more of your provinces; each column takes the quickest path through your own and allied land; several sources arrive together. No `arriveAt`, no explicit paths. | Decision 1 becomes one gesture everywhere (drag / tap). Transit and long march become automatic. | `transit`, `transitPlan`, `maxTransitHops`, `controlledMarch`, `arriveAt`/`maxScheduleDelay`, two agent tools, UI arrival field | Agents lose manual arrival timing (one real use). | **Merge** |
| M2 | `route` (recruits hop one link) **and** `rally` (recruits, or "everything above N", march along a path) | **Rally only**: "new troops from these provinces march to X". No `keep`. | Decision 5 in one order; fixes the "route chain left 50 idle troops" trap. | `route`, route-reserve insights, recruitment-arrow UI, `keep` input | Stockpiles need one ordinary march. | **Merge** |
| M3 | `recall` **and** `turn_around` (resume toward the target, at most twice, with its own preview/endpoint) | **Recall only**: turn back home from where the army is. | Decision 5 keeps its pull-back; nothing unused left. | `turn_around`, `turnAroundPlan`, `/turn-around`, `preview_turn_around`, resume maths, 9 tests | None seen: resume was never used. | **Cut** |
| M4 | Solo countries declare instantly; alliances vote by majority (60 s); peace is a vote, then an offer, then a vote on the other side | **Any member speaks for the alliance.** Declaring war puts both whole sides at war at once (1914 chains). Peace: any member offers, any member of the other side accepts within 60 s. | Decision 4 is one button for everyone; "declare war & march" works in alliances too. Betrayal risk is real diplomacy. | `vote_war`, `vote_peace`, majority/motion states, war-vote UI and toasts | An ally can drag you into war — you can leave. | **Merge** |
| M5 | Prestige = payout − 100 from a 100×players pool, split by industry^0.75, × maturity over 300 s; deadline pays 50/25/25; all-player coalition draws; league eligibility | **Win or lose.** Your alliance holds 60% of the world's industry for 90 s → every member wins. At 30:00 the side with the most industry wins; a tie is a draw. **Alliances hold at most half the countries** (so there is always an opponent; 2–3 player games are free-for-all). Your score is your own industry at the end (bragging rights, tiebreak within a side). Standings count wins/draws/losses. | One obvious goal; ends negative-Prestige-while-winning and "+100 for surviving". The size cap keeps alliances meaningful without prize maths. | `score`/`leaderboard` prize maths, maturity/tenure, `deadlinePrizes`, `strengthExponent`, negotiated draw, `eligible`/league mode, `coalitionForecast`, `alliance_victory_share`, `match_leaderboard`, Prestige UI and review tenure track | Less incentive to be the biggest inside a winning alliance (score keeps a little). | **Replace** |
| M6 | 90 s opening council: lock a leader name and a declaration before armies move | **Start means start.** Say hello in World chat whenever you like. | Removes a phase and a form between "Start" and play. | `opening` status, `lockOpening`, `/opening`, `lock_opening`, dossier form | Slow agents lose 90 s of reading time; first recruitment (20 s) and slow battles cushion it. | **Cut** |
| M7 | "3 military commands per rolling 10 s" shown in rules/UI; chat cooldown 10 s across channels with a countdown | **Invisible anti-spam limits**: 10 orders per 10 s, one chat message per 2 s. Never in the rules, never a countdown. | Nobody plans around a budget; multi-front play is not throttled. | budget copy/UI/insights, chat countdown | Scripts can act faster than a human, but not much. | **Simplify** |
| M8 | Capture has a battle-size-based chance to knock a completed factory down a level | **Capture keeps the factory.** Unfinished construction is still lost. | Conquest is predictable; industry is a prize worth taking. | `industry_damaged` and its headline, crack effect, sound cue, review rows | Snowball slightly stronger. | **Cut** |
| M9 | Leaving an alliance waits while your transit columns are inside an ally | Columns that find the land no longer friendly turn home (as they already do). | One fewer exception. | `troopsInsideAlly` | None. | **Cut** |
| M10 | Defender +1 on the best die at industry II/III | unchanged | Factories are worth defending; trench feel. | — | — | **Keep** |
| M11 | Development I→II→III (24/120 s, 48/180 s) | unchanged | Decision 2. | — | — | **Keep** |
| M12 | 30 s notice to join or leave an alliance; offers expire | unchanged, stated as one rule | Backstab warning is the heart of diplomacy. | — | — | **Keep** |

## Bucket 3 — KEEP

- **The map** (80 provinces, borders, counters, wraparound, zoom) — the user's verdict: "the map is good".
- **Distance-based travel** with fast internal links (own/allied land ×2) — "faster movement".
- **Slow Risk-dice battles** (4 rounds per 5 s), reinforcements and recall mid-battle — "slower battles".
- **One resource** (troops) and **three industry levels**; recruitment every 20 s.
- **Rally points** — "avoid micromanagement".
- **Declare war before attacking**, with the atomic "declare war & march".
- **Alliances by consent**, 30 s notice, coalition chat, DMs, World chat.
- **Recipient filtering, idempotent retries, next-tick reservations, deterministic ticks, exactly-once results**.
- **Headlines + World feed, the Messages inbox with ACTION/PERSONAL/WORLD tiers**, one toast slot.
- **Spectating, the after-action replay** (minus Prestige), sound, voice input, practice bots, quick pace.

## How to play (one screen, after simplification)

1. **Goal.** Hold **60% of the world's industry** with your alliance for **90 seconds**. If nobody does by
   **30:00**, the side with the most industry wins. A tie is a draw. Everyone on the winning side wins.
2. **Troops.** Each province makes troops every 20 s: 1, 2 or 3 by its industry level.
3. **March.** Drag from your province to any target (or tap one, then the other). Add more of your provinces
   to attack together — they arrive at the same moment. Troops travel through your and your allies' land,
   twice as fast inside it. Always leave one troop at home.
4. **Battle.** Arriving attackers fight dice rounds until one side is gone. Defenders win ties, and a
   factory (industry II or III) gives them +1. Send help or **recall** to pull back.
5. **Rally.** Pick provinces and a rally point: their new troops march there automatically.
6. **Build.** Spend troops to raise a province's industry: I→II costs 24 (2 min), II→III costs 48 (3 min).
   Capture takes the factory; unfinished work is lost.
7. **War and peace.** You must declare war before attacking another country; the whole of both alliances
   goes to war. Anyone can offer peace; anyone on the other side can accept.
8. **Alliances.** Propose to a country; it starts 30 s after everyone accepts. Leaving also takes 30 s.
   An alliance holds at most half the countries. Promises in chat are not orders.

## Estimated reduction

| Bucket | Code | Docs | Tests |
|---|---|---|---|
| CUT NOW | −2–3k lines (map/fixtures/scripts, dead UI, duplicate tools) | −1.3k lines (historical design docs, records) | −74 KB fixture, legacy cases |
| Mechanics | −1.5–2.5k lines across engine, UI, agents | rules sections shrink to one screen | −25–35 tests of removed mechanics |

Actual numbers are in "Result" below.

## Result (2026-09-28)

Implemented on branch `simplify` (from the merge a148680): all CUT NOW items and mechanic changes M1–M9 as recommended above; M10–M12 kept.

Text lines (and bytes) per area, before → after (`git ls-files` text files; audio, fonts and images excluded):

| Area | Before | After |
|---|---:|---:|
| Engine + server (`src/`) | 1,826 (124 KB) | 1,482 (98 KB) — `engine.js` 1,173 → 875 lines, 81 → 58 KB |
| Browser (`public/`) | 6,353 (666 KB) | 6,153 (577 KB) — incl. the 58 KB legacy map removed |
| Agents (`agents/`, incl. Pi harness) | 3,930 (218 KB) | 1,717 (132 KB) — MCP tools 42 → 26; benchmark ledgers reset (−1.7k lines) |
| Scripts | 1,324 (93 KB) | 870 (60 KB) |
| Tests | 10,324 (539 KB) | 5,384 (421 KB) — Node tests 185 → 161; 74 KB dead fixture removed |
| Docs (`docs/`, README, AGENTS.md) | 8,384 (547 KB) | 1,072 (126 KB) |
| **Total** | **32,627 (2.21 MB)** | **17,164 (1.43 MB)** |

Player-facing concepts removed: transit, long-march-only-through-own-land, arrival scheduling, recruitment arrows, rally "keep", turn-around/resume, war votes, peace votes, the opening council, the command budget, the chat cooldown, Prestige, prize pool, strength shares, maturity/tenure, 50/25/25 deadline prizes, negotiated draws, league eligibility, capture damage. Orders a player can give: 12 action types → 12, but movement is one order (was five) and diplomacy has no votes.

Tap counts (tests/ui_tasks.py, 390×844 touch / 1366×768 mouse): declare 3/3 (bound 4 → 3), attack 3/3, recall 2/2, propose 3/3, respond 2/2, reply 2/2 (bound 3 → 2), develop 3/3, rally 3/3, converse 7/6; the turn-around task is gone. None got worse.

Gates: `npm test` 161/161, `npm run check`, full `python tests/browser.py` (live match, review, UI layout/overlap/contrast audits at 7 viewports, task walkthroughs, voice; no page errors), `npm run test:balance -- --rounds 32 --mode diplomacy` (0 invariant failures, 25 decisive, 7 deadline wins, 0 draws), and 256+256 same-seed before/after runs in `docs/BALANCE.md`. The handplay golden hashes were re-baselined (the recording now ends at tick 553). No human has played the simplified rules yet.
