# Logistics: rally points and the logistics-1 ruleset

Status: implemented on branch `logistics`. Evidence: [BALANCE.md](BALANCE.md#logistics-1-2026-09), [summaries](testing/logistics-summary.json). None of it is human-playtested yet.

## The problem (playtest, USA seat)

1. "Moving troops … is a lot to manage. My provinces kept building up troops … I was left with large amounts of troops just sitting around." Rear provinces recruit every 20 ticks and nothing moves those troops unless the player drags them, one hop and one command at a time.
2. "It takes too long to move troops long distances. It was hard to move across the Pacific." A classic Pacific crossing (Pacific States → Philippines) takes 345 ticks, 19% of a 30-minute match. The concern: "balancing moving troops in places like the US with lots of space vs moving in Europe."

## What other games do (principles only)

| Game | Mechanism | Principle we take |
|---|---|---|
| RTS (StarCraft, AoE) | Rally point per production building | New units go somewhere useful by default. One order, not one per unit |
| Hearts of Iron IV | Army groups and front lines; automatic reinforcement; strategic redeployment by rail; naval transport | Moving inside your own network is fast and cheap to command. Crossing contested ground is slow and deliberate. Reinforcement flows automatically to where fronts are |
| EU4 / Victoria 3 | Auto-reinforce, rally points for new regiments, merge | Standing orders replace repeated micromanagement. Visible state explains what the automation is doing |
| Supremacy 1914 / Conflict of Nations | Slow real-time marches; railways/roads speed friendly movement; convoys | Speed depends on whose land you cross. Long hauls are planned, not babysat |
| territorial.io / OpenFront | Continuous "send %" streams from territory to the front | Surplus should flow to the border automatically. The player sets the ratio, not each transfer |

What we reject for this small game: supply/attrition systems, unit types, rail/port construction, a front-line AI that fights for you, or any new currency. Development already costs troop manpower.

## Decisions

### 1. Rally points (implemented)

`rally {from, to, keep?}` is one standing order per source province, shared by browser, CLI, MCP and bots through the ordinary `act()` path.

- **Multi-hop, friendly only.** At each recruitment of the source, a column leaves along the *current* fastest path (Dijkstra over the room's travel times, ID tie-break) through your own or allied provinces to one of **your own** provinces. It never enters neutral or enemy land, never passes through a battle, and uses only your own land while your side has a departure pending, so a standing stream cannot hold an ally's departure open.
- **Two modes.** Without `keep`, only the new recruits march (what the player asked for: "always send Mexico's new troops to Pacific States"). With `keep: N`, everything above N uncommitted troops marches at each recruitment, which cleans up the idle surplus. The default is recruits-only, so setting a rally never empties a province by surprise. Reserved troops (queued orders) are never taken.
- **Ordinary armies.** Each dispatch is a normal public army (`transit:true, rally:true, path`) that can be recalled, or turned around while outbound (a recall). It keeps your nationality through allied land. It behaves like `transit` at intermediate provinces. At the destination it only reinforces: if the destination is no longer friendly it turns back (`rally_blocked`). **Automatic dispatches never attack.**
- **Budget.** Setting or clearing costs one military command for 1–16 sources (a "rally this whole region to X" bulk order is one command, like a coordinated attack). Automatic dispatches cost nothing, like the old recruitment arrow. The order executes next tick, like every other order.
- **Visible reasons.** A rally pauses (not deleted) only when territory is lost: the destination is not yours, or no friendly path exists (user decision: a battle at the source does not pause it). It resumes automatically. Status and reason are in `observe.rallies` (owner only), and every transition sends a private event. A captured source loses its rally.
- **Privacy.** Rally settings are private standing orders, like reserved orders. The resulting armies are public, like all armies.
- **`route` kept.** The one-hop recruitment arrow stays for API compatibility. Setting either one on a province replaces the other.

Exploits considered: free movement without commands (bounded to recruitment ticks and friendly land, same as the old `route`); draining a border (the default is recruits-only, and `keep` is explicit); pinning an ally's departure with a stream (paths avoid allied land while a departure is pending); sneaking an attack (a column can't attack, and a lost destination turns it back); hidden information (the path uses only public ownership and battles).

### 2. Strategic redeployment and speed (implemented as the logistics-1 ruleset)

**User direction, recorded as given:** "This is the trench-warfare era. Slower battles, faster movement is the right way to go." Then: "I like your B option. Let's have double internal movement." And finally, fixing the numbers: **"increase ALL movement by 20%, slow down ALL battles by 25%, and apply a 2× speed boost internally."** Later, for the same ruleset: **"make development a lot harder and a lot slower"**, which we implemented as ×2 cost and ×2 time (the lead's reading of "a lot"; the user can override it).

| Rule | logistics-1 | Mechanism |
|---|---|---|
| All movement ×1.2 | `moveSpeedPercent: 120` | `ceil(classic_ticks × 100/120)` on every link, setup included |
| Internal ×2 more | `internalSpeedPercent: 200` | Internal link: `ceil(classic_ticks × 10000/24000)` (×2.4 vs classic) |
| Battles 25% slower | `battleSlowdownPercent: 125` | A round happens at elapsed tick `e` only when `floor(e×100/125)` increases: 4 rounds per 5 ticks. **Dice and casualties per round unchanged.** Integer arithmetic, deterministic |
| Development ×2 | `developmentCosts [0,24,48]`, `developmentTicks [0,120,180]` | Same capture risk and manpower spending, no new currency |

**Definition of "internal".** Checked **per link, when that leg departs**: both ends are owned by the mover **or a current ally**. Sea lanes count when both ends are friendly: Pacific States → Philippines is 144 ticks for the USA instead of 345. Multi-leg transit and rally columns re-evaluate each leg as it starts. A coordinated attack keeps the arrival fixed when it was accepted.

Why allies count: a coalition's shared logistics is how fronts get relieved in a trench war, and allied reinforcement and transit are existing mechanics that would otherwise feel sluggish next to solo movement. Why sea lanes count: the user named the Pacific as the pain point, and a lane between two of your own provinces is a friendly convoy route. Crossing into anyone else's land, neutral included, is only ×1.2.

**Determinism and ETAs.** The engine stores `travelTimes` (non-internal) and `internalTravelTimes` per room. Every preview (browser drag label and order plan, `/preview`, `/plan`, `plan_rally`, turn-around) charges the same table. An army on an internal leg carries `leg` so recall and turn-around ETAs stay exact.

**Old rooms unchanged.** `createGame` defaults to `classic`, which adds no fields, so old rooms and the 630-tick golden handplay replay match byte for byte. The server creates new rooms with `ruleset: "logistics-1"` unless the host passes `"classic"`. The fixture is also in `tests/balance-cases.json` (`logistics-1`), and a test asserts that both copies are identical.

### 3. Deferred

- **Defender (entrenchment) bonus:** proposed, not added. In self-play, battles under logistics-1 stay short (median 9 ticks) and there is no stalemate problem to fix. Slower rounds with unchanged recruitment already favour a defender slightly. Test it with humans first. A candidate would be "defender wins ties **and** rolls a third die after 60 ticks of battle".
- **Idle-surplus map overlay:** the tournament now measures idle share. The browser shows each province's free troops and rally status on its card, but no heat-map (left for the War Room UI).
- **Bots:** `agents/industrial-policy.js` is unchanged. It reads costs and travel times from `observe`, so it adapts, and it has no attention limit that a rally point would relieve. Bots now rarely build level III, because the payback check in the policy (not a hard-coded cost) rejects late upgrades.

## Browser (functional, to be restyled)

On your province card: **Rally troops to…** then tap one of your provinces. That's 3 taps from a closed card: tap Scotland, tap Rally, tap Southern England. The walkthrough is in `tests/ui_tasks.py`; the British seat stands in for Mexico → Pacific States. The card's detail section has a "Rally keeps at least N" field, the card shows status/pause reasons and **Clear rally**, and a dashed arrow in your colour links source and rally province on the map (faded when paused). Drag labels and order plans use internal travel times.
