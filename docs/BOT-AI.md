# Traditional commanders — v0.6

The built-in opponents are deterministic game AI, not LLMs. They need no inference keys, subscriptions, browser scraping or extra runtime dependencies. The goal is an opponent whose moves make sense, whose weaknesses you can exploit, and whose cooperation is useful—not an opponent that wins by reading private orders or receiving free troops.

## Playing against them

Create a room and claim your country. Under **Computer commanders**, select a difficulty and doctrine, then fill the empty seats. Alternatively, choose one open country to add a particular opponent. Choose an occupied **bot** seat to update its settings before starting; this cannot replace a human or external agent. Filling the remaining seats does not overwrite already-configured bots. The roster displays each actual doctrine, including the resolved choices from Mixed.

| Difficulty | Decision interval, game seconds | Proactive hostile opening | Coordination |
|---|---:|---:|---|
| Easy | 12 | After 150 seconds | Up to 2 sources, 120-second danger horizon |
| Standard | 5 | After 60 seconds | Up to 6 sources, 180-second danger horizon |
| Hard | 3 | After 30 seconds | Up to 16 sources, 240-second danger horizon |

All three expand into neutral land immediately, defend against committed attacks, and may react to aggression or an imminent enemy victory during their opening grace period. The interval is a decision opportunity, not a guaranteed order. Public arrivals and long travel can still be forecast when needed for an attack; the danger horizon bounds defensive attention. Hard still shares the same three-military-commands-per-ten-seconds limit as every other seat. Quick mode accelerates these intervals along with the entire game.

**Marshal** balances defense, concentrated attacks and reinforcement. **Raider** prioritizes expansion and exposed enemies, leaving thinner reserves you can counterattack. **Industrialist** prefers secure investment and larger reserves; early pressure can interrupt its buildup. **Diplomat** is more willing to seek useful allies, but still evaluates its own payout. Every doctrine can use every legal mechanic. They are preferences, not national restrictions or isolated scripts. Mixed resolves deterministically from the match seed and country and stays stable after reconnect/restart.

### Diplomacy that does not pretend to understand prose

Use the normal Council panel to invite a bot or respond to its offers. Bots can propose, accept, decline and, in unusual circumstances, leave. They compare an explicit relative-strength estimate with the value of their current allegiance, equal prize dilution and remaining maturity time. An expected-share heuristic is not a calibrated win probability. Recent attacks reduce trust; established coalitions have inertia. They do not form an all-player coalition just to manufacture a draw, or instantly drop weak partners to enlarge a prize.

In a DM, **Ask status** and **Bot commands** draft a supported message for approval. With a formal ally and a map destination selected, a contextual button drafts an attack/defense request naming that province. Drafting never sends a message or spends a command. CLI/MCP players can type the same requests:

```text
/help
/status
/attack low-countries
/defend england
```

Requests are suggestions, not delegated control. The bot considers a valid allied target for 120 game seconds, but may prioritize defense, arrival feasibility or available troops. One request per sender is considered every 45 game seconds; replies also share the normal game chat budget and a slower internal cadence. Response queues are bounded and expire. Unrelated messages and free-form promises do not become instructions. Military plans stay private, and non-allies cannot order the bot's armies. No shell command, URL fetching, model invocation or arbitrary text execution exists in this controller.

## Military behavior

**Rescue before impact.** Evaluate public incoming waves using actual travel time, recruitment, industry and confirmed allegiance changes. Reinforce your own or an ally's province before a losing battle, combine sources when useful, and avoid duplicate rescues when committed reinforcements already solve it. Stop exporting local recruits from threatened borders. Cancel a waiting departure to retain defenders. If rescue is infeasible, move the useful garrison to a safe neighbor before it is destroyed rather than feed another army into the loss.

**Attack a position, not a number.** Estimate the garrison at arrival, including observed incoming troops and recruitment. Choose a sufficient commitment while retaining useful reserves. Candidate source groups are nearest-donor prefixes, not an exhaustive optimizer; a distant port should not delay an otherwise viable attack. A visible allied march can supply a common arrival tick. Do not send another attack to a province already predicted to be secured. Industry, expansion access, travel and opposition affect target value. A short-lived focus discourages arbitrary target switching.

**Recover from changed circumstances.** Recall an outmatched outbound group when a safe return remains useful. Waiting components cancel and marching troops physically return under normal rules. A retarget cooldown reduces repeated launch/recall loops; close exchanges may still be worth fighting. An opponent's victory hold increases the priority of feasible attacks that can break it.

**Move reserves deliberately.** Weighted shortest paths bring accumulated troops through owned territory to useful fronts. An ally's province is not treated as controllable transit: arrival there gifts away the army. Rear garrisons move explicitly, because recruitment arrows only forward new local recruits. Adjacent allied fronts can receive gifts when reserves would otherwise be stranded. Corridor memory discourages immediate reversal of the same transfer.

**Build when there is time to benefit.** Reuse the same development forecast the UI displays. Investment needs spare troops, a secure location, and enough time for manpower payback plus a margin. A visible victory countdown shortens that horizon. Construction is never a separate free resource and never takes priority over an immediate rescue.

## Architecture and fairness

The controller consumes only `observe(game, country, cursor)` and the public map. The server host and external `agents/bot.js` use the same `createBot → decideBot → normal action endpoint → recordDecision` flow. No controller imports the engine, reads enemy queued orders, inspects another inbox, or writes the board. Public `kind`, `model` and human-vs-agent labels are not target-selection inputs. Difficulty does not change production, combat, starting assets, travel or action allowance. All built-in-bot games are experimental.

The implementation is intentionally small:

- `position.js`: indexed public observation, known-order forecast and owned-territory pathfinding.
- `military.js`: emergency priorities plus scored concrete military candidates.
- `diplomacy.js`: coalition utility, loyalty and explicit request handling.
- `controller.js`: cadence, bounded per-seat memory and accepted-action bookkeeping.
- `public/bot-profiles.js`: shared validated settings and human-readable descriptions.

The forecast is a no-new-orders projection, **not a guarantee**. Opponents can issue unseen future orders, change their minds, and invalidate assumptions. Confirmed notices are modeled; open offers never confer military friendliness. The forecast uses an independent lightweight calculation, so regression tests compare it against actual adjudication for recruitment, gifting, combat, industry, recall and membership changes. It does not replace the authoritative engine.

Bot brains are JSON-serializable, saved privately with the match, and excluded from public observations and after-action replay. Restarting preserves decision cadence, focus, pending replies and invitations. Existing matches whose bots have the legacy model label continue with the old policy; updating the server does not silently replace an ongoing opponent. The old policy also remains available as a reproducible test baseline. Select/reconfigure a bot in the lobby to opt into the new controller.

The external bot saves a mode-0600 memory file scoped to server/match/country. It saves a pending operation ID before sending and retries that same ID after a lost response, preventing duplicate armies. Auth/schema/programming failures are not treated as transient network errors. Explicit settings that conflict with restored memory fail with an explanation rather than silently being ignored. One controller per seat/state file is the supported arrangement; this is not a multi-process shared-brain service.

## Testing and interpretation

[Verification record](testing/v06-local.json) retains summaries and source hashes. The raw local evidence bundle includes complete per-match metrics, failures, decision categories, ledgers and seeds. The fixture suites cover defense, simultaneous reinforcements, recalls, reserve logistics, investments, coalition incentives, request validation, deterministic memory, privacy, HTTP persistence and response-loss retries. The recorded 630-tick manual match and its public replay remain unchanged.

```sh
npm test
npm run test:bots -- --rounds 96 --seed 36000 --mode mixed --out artifacts/mixed.json
npm run test:bots -- --rounds 64 --seed 46000 --mode difficulty --out artifacts/difficulty.json
npm run test:bots -- --rounds 64 --seed 56000 --mode selfplay --diplomacy --out artifacts/selfplay.json
npm run test:bot-ui
```

**Mixed** uses four new Standard and four legacy opponents, rotating countries and doctrines/styles. Diplomacy is off in this strength comparison, so a bot cannot inflate its apparent win rate by joining the eventual winner. Both policy families get a five-second decision cadence, identical assets and the same adjudicator. Decisions within a tick use a seeded shuffled order. **Difficulty** uses two Easy, four Standard and two Hard seats: compare wins per participating seat, not raw counts alone. **Selfplay with diplomacy** exercises coalition incentives and records both winning-roster appearances and individual Prestige. A winning flag need not mean a positive payout.

Earlier balance reports used weaker controllers and must not be treated as current difficulty or country rankings. These new tests diagnose behavior in this authored map/controller family. Shared implementation, seeds and simulation conditions limit generalization; there is no independent human enjoyment study, live-LLM match, or verified competitive leaderboard here. More wins are evidence of strength against the specified baseline, not proof that an opponent is fun. Do not retune country assets from this bot pass alone.

## Design references

Soren Johnson's *Playing to Lose: AI and Civilization* (GDC 2008, author reconstruction published 2017) distinguishes effective AI from enjoyable AI. Here that motivates honest difficulty, readable doctrine and counterplay rather than secret advantages: https://www.designer-notes.com/playing-to-lose-ai-and-civilization-gdc-2008/

Kevin Dill's *Structural Architecture: Tricks of the Trade*, Game AI Pro (2013), discusses hierarchy, utility, modularity and decision inertia. Here those ideas motivate a small prioritized utility controller with explicit per-seat memory rather than a framework or sprawling behavior-tree graph: https://www.gameaipro.com/papers/structural-architecture-tricks-of-the-trade.html

These are design precedents, not evidence for the proposed numerical settings or measured human enjoyment. No third-party AI code is incorporated.
