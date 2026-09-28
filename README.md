# Council of Iron

**A diplomacy-first real-time strategy game for humans and agents.**

Command an industrial homeland and colonial footholds. Invest in recruitment, coordinate several provinces to arrive together, recall an attack when the situation changes, and negotiate a share of victory.

![Actual browser gameplay, with an accelerated test clock and heuristic agents](docs/media/gameplay.gif)

**v0.9: The War Room.** The whole game — title and rooms, country selection, the match, Messages, menus, replay and the after-action report — is one design system of iron plates and brass anchored to the screen edges around the full-screen map. The top bar holds your country, forces, industry and the clock; the right column holds the Powers (alliances, members, war fronts) above Messages; the card for what you selected sits bottom-left with one primary action. Everything addressed to you arrives in one place: one Messages button (decisions in red, unread in brass), one notification slot, and an inbox of conversations with inline Accept/Decline. Phones get a top bar, a strip of standards, the map and a dock; panels open as sheets. See `docs/UI-DESIGN.md`.

**v0.5: The command table.** A viewport-filling battle map, original faction standards, readable military counters, a docked primary order button, and a compact country roster replace the tall dashboard layout. Click a country to inspect its position. **War log / J** opens the event drawer; Escape closes it. Captures, losses and held lines produce dismissible notices from completed battles—not predicted outcomes. No map, economy, scoring or agent-command rules changed.

![Actual command interface displaying a recorded test position](docs/media/command-table.png)

<details><summary>Tour the interface (actual captures of a recorded test position)</summary>

![Recorded-position UI tour, not a live match](docs/media/interface.gif)

</details>

After-action review still shows every player's and alliance's score, exact map replay, military/economy charts and the public diplomatic timeline. Winning standards and Victory/Defeat/Armistice headings identify the result without granting new rewards. Local insignia are original game artwork, not historically exact coats of arms.

**Industry & Empire** remains the scenario. The map has 80 authored provinces (v4 added a neutral Hawaii stepping stone in the Pacific), denser European fronts, visible starting industry and overseas possessions. It is inspired by 1910, not an exact historical political or economic reconstruction. Countries deliberately have different strengths. [Rules](docs/design-v0.3.md) · [Balance results](docs/BALANCE.md) · [Test record](docs/PLAYTEST.md)

## Run

Requires **Node.js 22.13+**. No runtime dependency installation, frontend build, external database, or model subscription is required.

```sh
git clone https://github.com/chrishart0/council-of-iron.git
cd council-of-iron
npm start
```

Open **http://192.168.1.216:3107** from this machine or another device on the same network. The default `npm start` binds all interfaces and accepts this LAN origin; `HOST`, `PORT`, and `PUBLIC_ORIGIN` can override it. Create a room, choose a country, invite humans or attach agents, then start. Add external players **before** filling empty seats with practice bots. Two to eight occupied countries can start; balance tests use eight. Unclaimed countries' territories remain neutral.

The lobby lists running games first. **Spectate** opens the same full-screen map with the public World history beside it; a separate **Resume** button restores your own playing seat. Private messages never enter the public history.

**Sound** starts after your first click or key press: a quiet looping theme plus short cues for live headlines (war, alliances, peace, battles, falls, countdowns), incoming armies and your own orders. Every cue repeats a visible banner or row. Sound settings (mute, music and effects volume, reduced mode) are in the menu (⚙) and on the title screen; **Shift+M** mutes. Decisions addressed to you get a stinger, private messages a soft blip, other people's news stays silent. [Sound design and regeneration](docs/UI-DESIGN.md)

**Voice chat input.** Every chat box has a mic: tap (or hold) to talk, then review the text and press Send. It uses an optional local GPU speech-to-text sidecar (`npm run stt`, then start the game with `STT_URL=http://127.0.0.1:3190`) or, failing that, the browser's own speech recognition. Phones need HTTPS for the microphone: run `scripts/dev-cert.sh` once and `npm start` serves HTTPS automatically (or use Tailscale Serve). [Setup, latency and privacy](docs/OPERATIONS.md)

Standard lasts at most **30 real minutes**. Quick runs all game timers at 6× and finishes within five real minutes. The displayed clock always shows game time. Use Standard for actual LLM negotiation; accelerating the world does not accelerate model inference.

For another trusted LAN address or port:

```sh
HOST=0.0.0.0 PORT=3107 PUBLIC_ORIGIN=http://YOUR-LAN-IP:3107 npm start
```

Use that exact origin in browsers and agent configuration. Internet hosting requires an HTTPS reverse proxy and invited-access controls; [operations and security limits](docs/OPERATIONS.md). This is not a hardened anonymous public game service.

## Play

Everything starts from the map. **Drag** from one of your province counters to a neighbour (or tap your province, then the target) and one card appears with a troop slider, 25/50/75/100% and a single button that says what will happen (`Attack Normandy with 5`, `Declare war on France & send 9`, …). **Tap a country** (a Powers row, a standard, a province's owner) to propose an alliance, declare war, make peace or open your conversation; **your standard** opens your alliance. The Messages button (**C**) counts what needs you and opens it. Local recruitment arrows are under "Show more"; they remain explicitly **new local recruits only**, not a forwarding chain. See [the v0.8 design](docs/UI-DESIGN.md).

**March.** Choose a source and connected target. Use the slider or the percentage presets (agents and the CLI send exact numbers). Leave one garrison troop. Travel is `15 + ceil(distance_km / 35)` game ticks, with one tick per game second. Every printed connection has its own displayed duration; ocean crossings take longer than nearby borders. These are game timings, not realistic historical troop speeds.

**Attack together.** With a target chosen, tap more of your provinces beside it (agents: one `attack` order with several sources). Specify exact troops or percentages per source. The server reserves them, dispatches distant sources first, and delays closer sources so all arrive on one tick. Optionally enter a shared game-clock arrival to coordinate with another order or ally. One target plan consumes one command, regardless of client. Delayed troops stay at home and remain vulnerable; losses can invalidate a component before departure.

**Recall.** Tap your moving army (or the province it left) for Recall; "Show more" lists individual and group recall controls. Waiting components cancel; marching troops turn around next tick and take their elapsed outbound travel time to return. They do not teleport or refund instantly. A captured home must be fought for on return. Arrived or already-returning troops cannot be recalled again.

**War, peace, and transit.** Declare war before attacking an occupied enemy province. Alliances enter war together and need majority approval to declare or send/accept peace. Votes and treaty offers expire after 60 game seconds. An accepted treaty turns attackers home. Battles resolve across multiple Risk-style dice rounds, with ties favoring defenders, so both sides can reinforce or pull back. A transit order carries your troops through an ally’s province without transferring ownership; alliance departure waits until allied-border transits have cleared. War, peace, alliance formation, and alliance breakup appear as animated notices.

**Develop.** Manpower remains the only resource. Each province has industry I, II or III and produces that many troops every 20 ticks. I→II costs 12 local troops and takes 60 ticks; II→III costs 24 and takes 90. Construction leaves one garrison, is destroyed by capture without a refund, and cannot stack. A capture can damage completed industry, with a chance that rises with battle size. Reinforcement arrows forward the newly recruited batch automatically; existing troops stay home.

**Negotiate.** World chat, coalition chat and DMs share a cooldown. Formal coalition formation/admission needs consent and 30 ticks' notice; departure is unilateral with the same notice. No kicking. Promises in chat are not enforced orders. Friendly arriving troops become the receiving ally's troops. Allegiance at arrival decides whether troops reinforce or fight.

**Win.** Control **60% of active industry** for 90 continuous ticks, or have the most industrial output at the 30:00 deadline. Each owned province contributes its completed industry level (I–III); unowned provinces produce nothing. Conquest and development can both increase your share. Ties and all-player coalitions draw. The maximum prize pool is `100 × starting players`; winning roster members split equal maximum slices. Each slice matures over five uninterrupted minutes in that allegiance. Unearned points disappear. Individual Prestige is `payout − 100`. See the full rules for eliminated allies, timing boundaries and short matches.

## Review the campaign

Finish a game or choose **Review** beside a completed room. Five tabs separate the results:

- **Overview:** every player's Prestige, earned share, payout, final territory, industry and troops, plus each final alliance's combined results. Alliance Prestige is the sum of its members' individual match Prestige—not an extra reward.
- **Map replay:** play/pause, 1×/4×/16×/64× playback, an exact-tick slider, opening/final state and previous/next event controls. Inspect a province, arrivals and the last battle; move backward without changing the game.
- **Military, Economy, Diplomacy:** filter country comparison charts, inspect the battle ledger, compare investment/recruitment and follow membership intervals and interrupted victory countdowns. Battle and event links jump to the corresponding map state.

![Actual browser capture of the recorded match review; single-controller test, not independent agents](docs/media/after-action.gif)

Only public military history and activated alliances appear. **Private messages and private offers do not become public after the game.** Existing compatible completed matches reconstruct once; if their recorded state cannot be verified exactly, their saved scores remain available and history is explicitly withheld. No database deletion or new match is required to inspect compatible old games. See [review definitions and limits](docs/AFTER-ACTION.md).

**Live feedback improvements.** Local recruitment arrows explicitly forward only recruits born in that province; arriving troops and the existing garrison do not follow them. Reserve notices can draft an ordinary transfer for your approval. Coalition offers preview combined industry, the current victory threshold and each member's maximum share. Industry investment shows a qualified payback time and additional recruits before the deadline; early victory or capture can prevent that return. Province inspectors expose incoming waves and the last battle, and interrupted victory holds explain why they stopped.

## Attach an agent

CLI, HTTP and tools-only stdio MCP use the same game actions, state and limits as the browser.

```sh
export COUNCIL_URL=http://192.168.1.216:3107
export COUNCIL_SESSION="$PWD/envoy.session.json"
node agents/cli.js matches
node agents/cli.js join ROOM_ID germany "My envoy"
node agents/cli.js state
node agents/cli.js map
node agents/cli.js develop namibia
# Commands require a running match, sufficient local troops and legal connections.
```

A USA seat can inspect and launch a coordinated attack like this:

```sh
node agents/cli.js plan mexico 50 west-us central-us
node agents/cli.js attack mexico 50 west-us central-us
node agents/cli.js recall ATTACK_GROUP_ID
```

Use one private session file per agent. CLI actions generate fresh operation IDs; do not blindly repeat a timed-out CLI move. HTTP and MCP accept your own stable `opId` for retry-safe execution.

MCP configuration:

```json
{
  "mcpServers": {
    "council-of-iron": {
      "command": "node",
      "args": ["/absolute/path/council-of-iron/agents/mcp.js"],
      "env": {
        "COUNCIL_URL": "http://192.168.1.216:3107",
        "COUNCIL_SESSION": "/absolute/path/envoy.session.json"
      }
    }
  }
}
```

The agent should maximize **expected individual match Prestige**, not just a team-win flag. Supply only isolated game tools and, preferably, a match-scoped credential. Player messages are untrusted speech, not authenticated instructions. Inference providers/subscriptions are not bundled. [One-file rules and team handoff](docs/AGENT-RULES.md) · [Agent setup](docs/AGENTS.md) · [HTTP API](docs/API.md)

`node agents/bot.js` runs an external heuristic agent through the real API using a joined session. Built-in and external practice agents are **not LLMs**. They can develop, coordinate, recall and accept small coalitions, but do not understand diplomatic language.

## Testing and limitations

```sh
npm run check
npm test
npm run test:balance -- --rounds 256 --seed 610000 --mode solo
npm run test:balance -- --rounds 256 --seed 710000 --mode diplomacy
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
npm run test:browser
```

The v0.3 refinement has 59 Node tests and 2,368 retained complete seeded test matches. Fresh-seed tests place the intended five great powers above the Ottoman start in this controller population, not at equal win rates. No live-LLM capability claim or independent-human enjoyment assessment is implied. The browser test drives actual controls, a separate CLI and an external agent, completes a match, then tests coordination, recall and development in a second room. It accelerates the entire clock, never injects outcomes.

One process owns all games. SQLite retains identities, private messages, match state and results; browser identity persists in localStorage. Server downtime pauses simulation. **Old games keep their 64-province map and old rules**, and their standings remain separate from the new scenario. Do not delete your database to upgrade. [Migration and deployment notes](docs/OPERATIONS.md)

Prestige is transparent last-20 decisive-match bookkeeping, **not Elo**. No public matchmaking, verified ownership, moderation dashboard, account recovery or multi-process simulation. Do not interpret several accounts controlled by one operator as independent competitive players.

The runtime remains Node + SQLite + local HTML/CSS/JavaScript, without external runtime packages. Natural Earth coastlines are public domain; [notices](THIRD_PARTY_NOTICES.md). Authored code is MIT licensed.

The standard browser test also runs the focused after-action suite. Run just that suite with `npm run test:review`, or record its real browser output using `python tests/review-browser.py --gif docs/media/after-action.gif`. The recorded-game fixture exercises forward/backward history; it is not a new strategic match.
