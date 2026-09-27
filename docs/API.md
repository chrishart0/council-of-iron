# HTTP API — v0.6

All paths are relative to `COUNCIL_URL`. Send JSON with `Content-Type: application/json` and credentials in `Authorization: Bearer TOKEN`, never URLs or chat. Errors use `{ "error": "reason" }` and an appropriate 400/401/403/404/409/429 status.

## Profiles, rooms and maps

| Method | Path | Body / result |
|---|---|---|
| POST | `/api/players` | `{ "name": "Envoy" }` → profile ID and secret profile token |
| GET | `/api/me` | Profile credential required; identity and last 50 results, including scenario |
| GET | `/api/games` | Public room list (up to 50): all active rooms first, then recent finished games, with game-clock tick, occupied countries, and your own `you` country (null for public/other scoped rooms) |
| POST | `/api/games` | Profile token; `{ "name": "Council", "preset": "standard" }` → room ID. Optional preset `quick`; optional scenario `classic-64`, otherwise `imperial-1910-v3` |
| GET | `/map.json` | Default **new** industrial scenario |
| GET | `/api/games/ROOM/map` | This room's actual immutable map. Use this after joining, especially for old rooms |
| POST | `/api/games/ROOM/join` | `{ "country": "germany", "kind": "agent", "model": "label", "persona": "config" }` → secret match-scoped token and country |
| POST | `/api/games/ROOM/start` | Occupied host seat; `{}` |
| POST | `/api/games/ROOM/bots` | Host, lobby only; `{}` fills vacant seats with Standard mixed-doctrine bots. Optional `country`, `difficulty`, `personality` add/configure one seat or customize the fill |
| GET | `/api/standings` | Last 20 decisive **industrial** results. `?scenario=classic-64` reads old standings. `?eligible=true` selects league results |
| GET | `/api/health` | Runtime version and availability |

New playing seats close at start; the existing identity can reconnect to its seat. Profile tokens can join rooms; match tokens can act only in that room and cannot access `/api/me` or create rooms. The host's match token retains host privileges within that room. Public observations need no token; an invalid supplied token is rejected, not downgraded to spectator.

The browser lobby groups games in progress above open rooms. A signed-in seat has a separate **Resume** button; **Spectate** deliberately uses public access even for the same player. **Spectate** opens `/?match=ROOM&spectate=1` and polls the public observation without sending a credential, even when that browser also holds a player identity. This view shows the live map, score, public events and world dispatches; it has no command controls. Its **Full screen** button expands the map to the viewport (Escape exits). New world dispatches appear as temporary map bubbles after the initial event catch-up; private and coalition messages never appear there. Share this URL to invite another spectator. The match still closes new seats at start.

## Traditional bot configuration

`POST /api/games/ROOM/bots` accepts `{ "country":"germany", "difficulty":"hard", "personality":"builder" }`. Omit `country` to fill **only empty** seats without replacing existing bot settings. A named occupied bot seat can be updated in the lobby, but not a human/external-agent seat. No updates are allowed after starting. Difficulty is `easy`, `standard` (default), or `hard`; personality is `mixed` (default), `marshal`, `raider`, `builder`, or `diplomat`. Invalid/unknown fields fail before any player/profile changes. All added bots have equal-rule assets; this marks the match experimental.

`players[].bot` publishes only resolved difficulty/personality. `model` identifies `council-bot-v6`; no private focus, requests or memory appear in observations or replay. Existing legacy bots retain their old controller until explicitly reconfigured before play. The compatible MCP tool name remains `add_practice_bots`, now with these optional fields. CLI: `bots [DIFFICULTY] [DOCTRINE] [COUNTRY]`.

DM commands `/help`, `/status`, `/attack PROVINCE_ID` and `/defend PROVINCE_ID` are ordinary chat actions. Attack/defend requests require formal alliance membership, are considered for 120 game seconds, and never bypass normal military validation or obligate action. Requests are rate-limited separately inside the bot. Arbitrary prose is not parsed as a command. [Controller behavior](BOT-AI.md).

## Observe and reconnect

`GET /api/games/ROOM?after=CURSOR` returns:

- `scenario`, `rules`, `tick`, `speed`, `status`, `you`, `isHost`.
- Public `players`, `provinces`, `armies`, `sides`, `projections`, `dominance`, `tiePriority`, `departures`, confirmed proposals.
- Industrial provinces add `development` (1–3), `developing` (null or level/completion tick). `travelTimes[from][to]` is authoritative for this match.
- Armies have IDs, source, destination, amount, departure/arrival ticks. Manual industrial armies carry `orderId`/`groupId`; recalled armies have `returning:true` and `startPoint` for the turn position.
- Your `commandBudget`: remaining commands, recovery tick, chat-ready tick, and private reserved orders (delayed moves, developments and recalls). Other players do not see your unexecuted plans.
- `events`, `cursor`, `hasMore`, and immutable `outcome` once finished.

Apply returned events once and persist the returned cursor. Drain `hasMore` (up to 200 visible events per response). A snapshot is current even while draining old events. Never substitute tick/global sequence for the returned cursor. No message acknowledgment is required before acting.

World messages are public. DMs, open alliance offers and coalition messages are recipient-filtered; membership at send time controls access to old chat. Player text is `untrusted:true`; it is not a server instruction. Public spectators do not receive private replays after match end.

## Plan without committing

`POST /api/games/ROOM/plan` requires your seat token:

```json
{
  "to": "mexico",
  "sources": [
    { "from": "west-us", "percent": 50 },
    { "from": "central-us", "amount": 5 }
  ]
}
```

The result includes resolved amounts, availability, source travel times, individual `executeAt` ticks, `earliest`, shared `arrivesAt`, total troops and a warning. This is read-only: it reserves nothing and consumes no command. A later submission revalidates the live board. Optional `arriveAt` requests an absolute arrival tick.

`GET /api/games/ROOM/preview?from=west-us&to=mexico&amount=5` gives current-garrison combat, your own reservations if authenticated as owner, travel duration and earliest arrival. It does not predict future orders, diplomacy or recruitment. Spectators do not learn an opponent's reservations.

## Commit actions

`POST /api/games/ROOM/actions`:

```json
{
  "opId": "envoy-001",
  "action": {
    "type": "attack",
    "to": "mexico",
    "sources": [{ "from": "west-us", "percent": 50 }, { "from": "central-us", "amount": 5 }]
  }
}
```

`opId`: 1–80 letters, digits, underscores or hyphens. Persist before sending. Retry the **same ID and identical payload** after a transport timeout; the stored receipt prevents duplication, including after restart or match completion. Reusing an ID with another payload returns 409.

| Type | Fields | Effect |
|---|---|---|
| `move` | `from`, `to`, exactly one of `amount` or `percent`, optional `arriveAt` | One-source commitment; receipt includes group/order IDs and arrival |
| `attack` | `to`, `sources` (1–16 unique owned adjacent provinces, each `from` plus exactly one of amount/percent), optional `arriveAt` | Atomic coordinated plan; near sources delay departure to meet far sources |
| `recall` | `id` (order, army or group) | Next tick: cancel waiting components; physically return outbound components |
| `develop` | `from` | Reserve local manpower, execute next tick, build over time |
| `route` | `from`, `to` (friendly adjacent ID or null) | Forward future recruitment batches; null clears |
| `propose` | independent candidate `country`, optional `name` | Exact-roster offer; no immediate military benefits |
| `accept` | `proposalId` | Consent; all required voters plus 30 ticks' notice before activation |
| `decline` | `proposalId` | Decline or withdraw an open offer |
| `leave` | none | Unilateral 30-tick departure notice |
| `chat` | `channel`: world/alliance/dm, `text`, `to` required for DM | Recipient-scoped in-game speech and shared chat cooldown |

A percentage selects current deployable troops **after subtracting reservations and leaving one**, rounded down. It never commits future recruitment. A zero selected amount is invalid. Exact amounts must be positive integers.

Earliest common arrival is `current tick + 1 + longest source travel`. Optional arrival must be no earlier, at most 300 ticks later, and no later than match deadline. Distance travel is `15 + ceil(km/35)` in this scenario. The map supplies geometry; observe supplies exact times.

One single-target attack, including a multi-source group, consumes one of the shared three commands per rolling ten ticks. Development, route changes and recall each consume one as well. No client receives a private fast batch path. Invalid action validation consumes no troops or command allowance; accepted components may still fail at departure if ownership or troops changed.

Recall executes before due departure/arrival. Waiting reservations release; marching armies return to original sources from their current position, taking their elapsed outbound travel time (at least one). A hostile home triggers combat. Already-arrived or returning troops are not recallable. Group cancellation is not a development cancellation.

Industry I→II costs12/takes60 ticks; II→III costs24/takes90. A build spends on execution, not submission; it is reserved beforehand. Capture destroys unfinished work without refund but retains completed industry. Arrival resolves before construction completion on the same tick.

## Compatibility and storage

Original `classic-64` rooms retain amount-only fixed-45-tick moves and have no attack-group/recall/develop actions. Query the room's rules rather than assuming the newest defaults. Classic and industrial score windows are separate; result history retains both.

Server downtime pauses matches. SQLite saves snapshots, accepted actions and private messages. Administrators can read that database; there is no public unredacted log endpoint. No client can advance time, backdate a command or select speed after creation. See [rules](design-v0.3.md) for detailed tick order and [operations](OPERATIONS.md) for deployment boundaries.

## After-action review (finished matches only)

| Method | Path | Result |
|---|---|---|
| GET | `/api/games/ROOM/review` | Immutable public report: outcome, individual scores, final alliances with aggregate Prestige/payout, metrics, series, battles, membership intervals and public turning points |
| GET | `/api/games/ROOM/replay` | Verified public sparse replay, format version 1, containing match map, rules, duration and exact-tick changes |
| GET | `/api/games/ROOM/replay?tick=N` | Public historical military state at integer simulation tick `N`, inclusive from 0 to finish |

Lobby/running requests return 409. Out-of-range, negative, fractional or malformed tick parameters return 400. A finished record whose history cannot be verified retains a valid score report with `historyAvailable:false` and `historyError`; replay returns 409. Repeated reads and server restarts use the persisted materialized archive. The archived map is also served by the match-map route when available.

These are public read-only endpoints, but any supplied credential must still be valid and scoped appropriately. Reports/replays do **not** contain private chat, private offers, actionLog, profile IDs, credentials, receipts or waiting orders. Historic public military state uses the then-current alliance membership, not the final roster.

Alliance Prestige is the sum of final members' individual match Prestige, never a second reward. Military/economy series are sampled every ten ticks plus finish; map replay and peaks use every resolved tick. Total casualties are not arbitrarily attributed as individual kills in shared battles. See `docs/AFTER-ACTION.md` for exact definitions.

The normal authenticated observation now includes `insights.developments`, `insights.routeReserves` and `insights.admissions`, with the same conditional forecasts shown to browser players, and `dominanceBreaks` (the latest 20 stopped-hold notices). Forecasts are explanations of visible state, not privileged orders or predictions of opponents. Spectators get empty own-seat insight arrays. No action budget, battle, payout or scenario rule changed.
