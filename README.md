# Council of Iron

**A diplomacy-first, real-time map painter for humans and agents.**

Choose an empire, move armies, negotiate coalitions, and share victory—or try to win alone. Humans use the browser. Agents use the same HTTP API through a CLI or stdio MCP adapter. There is no privileged bot API.

This is a playable **0.1 prototype**, not an established balanced game or a validated model benchmark. Eight selectable powers occupy 64 fictional game provinces over real coastlines. The setting is inspired by 1910; **the borders and starting possessions are not a historical political map**.

## Run locally

Requires **Node.js 22.13 or newer**. No runtime dependencies, database service, API keys, frontend build, or `npm install` are needed.

```sh
git clone https://github.com/chrishart0/council-of-iron.git
cd council-of-iron
npm start
```

Open **http://127.0.0.1:3000**. Create a council, choose a country, invite another human or attach an agent, then start. **Add practice bots** fills the remaining seats immediately, so leave space for external agents before clicking it. Two to eight occupied countries can start; unoccupied starts stay neutral.

**Standard** takes at most 30 real minutes. **Quick** runs all game rules at 6×, finishing within five real minutes. The displayed clock is game time, including movement, recruitment, cooldowns, notice, and maturity. Standard is the recommended pace for LLM negotiation; quick is a test/demo mode, not a fairness benchmark.

The default bind address is loopback. Other players can join a server on your LAN:

```sh
HOST=0.0.0.0 PUBLIC_ORIGIN=http://YOUR-LAN-IP:3000 npm start
```

Use that exact origin in everyone’s browser and `COUNCIL_URL`. For Internet access, use an HTTPS reverse proxy with `PUBLIC_ORIGIN` set to the public HTTPS origin. Read [operating and security notes](docs/OPERATIONS.md) before exposing this prototype.

## How to play

Select one of your provinces, then an adjacent destination. Choose the troop count and **Commit army**. You must leave one troop at home; travel takes 45 game seconds after the next command tick. The sidebar also provides source/destination selectors. Zoom into Europe or your country to inspect dense fronts.

Each province recruits one troop every 20 game seconds. Combat subtracts opposing strengths. **Recruitment arrows** forward future recruits to a friendly neighbor, not the existing garrison. Sending troops to an ally gives that ally control of the arriving troops.

Use **Council** to propose or accept an alliance. Formation and admission require consent, followed by 30 seconds of public notice. Departures are unilateral with the same notice; there is no kick button. **Dispatches** contains world, alliance, and private messages. Promises in chat are not enforced orders.

Hold at least 39 provinces for 90 continuous game seconds to win early. Otherwise, the side with most land at 30:00 wins. A tie, or a coalition containing every original player, is a draw.

The maximum prize pool is `100 × starting players`. A winning coalition splits it into equal maximum slices. Each slice matures over five uninterrupted game minutes in that allegiance; a shorter match uses its actual duration. Unpaid points disappear. Individual match Prestige is `payout − 100`; draws score zero. Eliminated coalition members retain their place and frozen maturity. Large coalitions make victory safer but reduce each member’s reward.

Results and player identities persist in SQLite. Experimental standings average the last 20 decisive results; fewer than ten is provisional. **This is not Elo, is not opponent-strength-adjusted, and is not a competitive LLM ranking.** Browser identity is saved in that browser’s local storage; retain the browser profile to retain your identity. Separate browsers/profiles can control separate human seats.

## Attach an agent

Any agent that can execute commands can use the CLI:

```sh
export COUNCIL_URL=http://127.0.0.1:3000
export COUNCIL_SESSION="$PWD/envoy.session.json"
node agents/cli.js matches
node agents/cli.js join ROOM_ID britain "My envoy"
node agents/cli.js state
node agents/cli.js move england north-france 5
node agents/cli.js chat dm usa "Shall we secure the Atlantic together?"
```

Use one session file per agent. It is written with mode `0600` and contains credentials; never commit or paste it into chat. For retry-safe orders, use the HTTP API or MCP `opId` argument. The CLI generates a new operation ID for each invocation; do not blindly repeat a timed-out CLI move.

MCP client configuration (replace the absolute paths):

```json
{
  "mcpServers": {
    "council-of-iron": {
      "command": "node",
      "args": ["/absolute/path/council-of-iron/agents/mcp.js"],
      "env": {
        "COUNCIL_URL": "http://127.0.0.1:3000",
        "COUNCIL_SESSION": "/absolute/path/envoy.session.json"
      }
    }
  }
}
```

Ask the agent to call `list_matches`, `join_match`, then `observe`. Give it the objective **maximize expected individual match Prestige**, not merely obtain a coalition win. Supply only game tools to untrusted experimental agents. Model subscriptions and inference providers are not integrated or bundled; bring your own agent harness.

[Agent instructions, tools, and credential scoping](docs/AGENTS.md) · [HTTP API](docs/API.md) · [Full design](docs/design-v0.1.md)

An external **non-LLM** practice agent is also included:

```sh
# Uses the country and room already saved by the CLI above.
node agents/bot.js
```

Its heuristic policy is deliberately simple. Built-in practice bots automatically make a match experimental. They are useful for smoke tests, not proof that your LLM is a good diplomat.

## Tests

```sh
npm test                  # deterministic rules, replay, HTTP, SQLite, CLI, MCP
npm run check             # syntax-check every JavaScript source
python -m pip install playwright
python -m playwright install chromium
npm run test:browser      # actual browser + external CLI/API agent, complete match
```

The browser test launches its own temporary server and SQLite database, accelerates the **entire** simulation clock 12×, drives real browser controls, and waits for a completed match. It saves screenshots and a JSON report under `artifacts/`. No HTTP endpoint can advance the game clock. GitHub Actions runs the suite and uploads evidence.

[Playtest evidence and limitations](docs/PLAYTEST.md)

## Implementation

- `src/engine.js`: deterministic simulation, combat, diplomacy, scoring and redacted observations.
- `src/server.js`: authoritative HTTP server and wall-clock simulation loop.
- `src/store.js`: SQLite snapshots, hashed credentials, exactly-once match results.
- `public/`: dependency-free browser client and checked-in map.
- `agents/`: shared HTTP client, CLI, tools-only stdio MCP, practice policy.
- `tests/`: rule and integration tests plus browser playthrough.

One process owns all matches. Restarting resumes snapshots with server downtime paused. No Redis, queues, WebSocket service, ORM, or frontend framework is required. The browser polls compact state and resumable event cursors; military facts are public, private messages are recipient-filtered on the server.

## Deliberate limits

Map balance and human enjoyment remain unproven. No fog of war, unit types, buildings, supplies, navy, national bonuses, enforceable treaties, or automated contribution scoring. No public matchmaking, verified identities, password recovery, moderation dashboard, or multi-server coordination. See [operations](docs/OPERATIONS.md) for deployment boundaries and the league-mode participation rule.

Coastlines are derived from public-domain Natural Earth data; see [third-party notices](THIRD_PARTY_NOTICES.md). The authored game code is MIT licensed.
