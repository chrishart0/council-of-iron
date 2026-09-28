# Multi-agent playtest harness

Runs several LLM command-line agents (Codex CLI, Grok CLI, Hermes Agent) as seats of one Council of Iron room, next to human players, through the ordinary Council MCP server. Dev tooling only: it spends model tokens on the operator's own CLI logins, and the game keeps zero runtime dependencies.

## Design

**Episodic turns with fresh context.** A seat never runs one long session. Each turn is a new, short CLI invocation, started

- every `--interval` game seconds (default 30, measured from the previous turn's start),
- at once when the seat's server inbox has something new (an unread DM or alliance message, or an alliance or peace offer awaiting its answer that no prompt has shown yet) or a war is declared on it, at most once per `--min-gap` real seconds (default 10). The harness polls with `GET /api/games/ID?inbox=1`, which marks nothing read,
- never while a turn of the same seat is still running. A turn is capped at `--turn-timeout` (default 120 s); then its process group is killed and the seat waits for the next trigger. A failed turn (non-zero exit, or only client-side errors) backs off 5, 10, 20 … 120 s.

The turn prompt is the fixed rules and goal, then a `MEMORY` note carried from the previous turn, then an `INBOX` block, then the seat's current `decision_view` (without its own `inbox` section, which the block replaces). The block comes from the game's seat inbox: at turn start the harness reads it with `POST /inbox` (what the `inbox` tool does), so the delivered messages are marked read and are not delivered again; they are quoted as JSON strings and marked untrusted, followed by every offer still awaiting an answer (`DECIDE: …`, with the exact accept call). World chat, war declarations and newly active alliances since the last turn are added from the seat's events. When an order result carries an `attention` line (something arrived during the turn), the agent is told to call `inbox`. The agent is told to answer allies and offers first, give one to four orders with the council tools, and end with one line `MEMORY: …` (≤ 600 characters, including promises made to allies). The harness stores that note and carries it to the next turn; without one, the previous note is kept. Prompts are saved per turn (`turns/N.prompt.txt`).

**One logging MCP proxy for every client.** Each client is configured with `agents/playtest/mcp-proxy.js`, a stdio proxy in front of `agents/mcp.js`. It appends every tool call (tool, arguments, accepted or rejected with the error, `acceptedTick`) to the seat's `mcp.jsonl`, so rejections and orders are measured identically for all clients and visible while play goes on. It hides only the room-setup tools (`list_matches`, `create_match`, `join_match`, `start_match`, `add_practice_bots`); everything else, including `inbox`, the `attention` line on order results (also logged) and error details, passes through unchanged, and the first `news`/`decision_view` call without `after` continues from the harness's cursor instead of replaying the whole match. Chat text is not logged there (only its length); the game's own validation, limits and recipient filtering are untouched.

**Per-client configuration** (no user-level config is edited; each seat has a private working directory):

| Client | Turn command | Isolation |
|---|---|---|
| `codex` | `codex exec --json --ephemeral --ignore-user-config --sandbox read-only -C WORK -m MODEL -c model_reasoning_effort=… -c mcp_servers.council={command,args,env,default_tools_approval_mode="approve",tool_timeout_sec=60} PROMPT < /dev/null` | `approve` is required: `auto` only covers read-only tools and blocked every order in the last playtest. stdin is `/dev/null` (otherwise `exec` waits on "Reading additional input from stdin"). Shell, unified exec, browser, computer use, image generation, apps and web search are disabled. |
| `grok` | `grok --trust -p PROMPT --cwd WORK -m MODEL --reasoning-effort EFFORT --always-approve --disable-web-search --no-subagents --tools search_tool,use_tool --output-format streaming-json` | The council server is in `WORK/.grok/config.toml` (project scope needs `--trust`); every user-level server (e.g. a stray `council-game`) is overridden as disabled there. `--tools` leaves only the MCP gateway tools (no shell or files). `GROK_MEMORY=0` and `GROK_{CLAUDE,CURSOR}_{AGENTS,HOOKS,MCPS,RULES,SKILLS}_ENABLED=false` stop Grok importing Claude/Cursor MCP servers, skills and rules, for the agent process only. Grok has no `none` effort; `low` is the minimum. |
| `hermes` | `hermes -p councilpt<SLOT> -z PROMPT -m MODEL --provider openai-codex --reasoning EFFORT --yolo --ignore-rules -t council --usage-file …` | A dedicated profile per seat, created once with `hermes profile create NAME --clone --no-alias` (never `--clone-all`: it copied all state and filled the disk). The login (`~/.hermes/auth.json`) is copied owner-only when the profile lacks a newer copy. The council server is added with `echo Y \| hermes -p NAME mcp add council --command … --env … --args …`, every other enabled server is disabled, and `-t council` limits the turn to the council toolset. `--provider` is `--hermes-provider` (default `openai-codex`). |
| `fake` | `node agents/playtest/fake-agent.js PROMPT` | Test-only stand-in (no model): checks the tool list, reads the board through the proxy, answers DMs, makes one legal march, calls `inbox`. |

Pi seats are not part of this harness. A single Pi model can join the same live room on its own with `node agents/pi/play.js --url URL --match ROOM --country ID` (see [agents/pi](../pi/README.md)); it uses the same MCP tools, `decision_view` and seat inbox, but its own turn loop and records. Use this harness for multi-client playtests next to humans and `agents/pi` for model benchmarks.

All commands are argv arrays (no shell, no word splitting); the prompt is a single argument. `COUNCIL_*` variables are removed from the agent's environment; only the MCP server gets the seat's session path.

**Stopping.** The run stops when the match is `finished`, the room returns 404, polling fails for about two minutes, `--max-minutes` passes, every seat is eliminated (or reached `--max-turns`), or on SIGINT/SIGTERM/SIGHUP; running turns are killed with their process groups (SIGTERM, then SIGKILL), and the report is written.

## Usage

```bash
node agents/playtest/run.js --match ROOM --url https://HOST:PORT --ca CA.pem \
  --seat SLOT:COUNTRY:CLIENT:MODEL:EFFORT[:NAME] [--seat …] \
  [--join] [--wait-start] [--dry-run] [--systemd] \
  [--interval 30] [--turn-timeout 120] [--min-gap 10] [--poll-ms 2000] [--max-minutes N] [--max-turns N] \
  [--hermes-provider openai-codex] [--data DIR]
node agents/playtest/run.js status --match ROOM [--watch]
node agents/playtest/run.js report --match ROOM
```

- `--join` registers each seat and joins it as a **public** agent (model label `client/model/effort`); an existing session for the room is reused, so re-running is safe. Join while the room is in the lobby.
- `--wait-start` waits in the lobby until the host starts; without it a lobby room ends the run.
- `--dry-run` prints the join, setup and turn commands and the fixed turn rules, and changes nothing.
- `--ca` trusts the server's CA for the harness and the MCP servers (`NODE_EXTRA_CA_CERTS`).
- The harness can be stopped and restarted: sessions, cursors, memory notes and logs are resumed from the data directory.

`status` prints one row per seat (running turn, turns, accepted/rejected orders, messages, pending inbox, last turn, last error); `--watch` refreshes every 5 s. `report` (also printed and saved as `report.json` at the end) gives per seat: turns by trigger, time-outs, failures, median turn time, orders accepted and rejected by reason, client-side tool errors, first order tick, messages sent, messages from allies, replies and the median/maximum reply latency in game seconds (from an ally's first unanswered message to the seat's next message), the longest gap between accepted orders, memory updates and reported tokens.

### Foreground or systemd

Foreground: run the command in a terminal; Ctrl-C stops every seat and writes the report.

As a user systemd transient unit (survives the terminal; the whole control group is killed on stop): add `--systemd`. It re-launches the same command through `systemd-run --user --unit=council-playtest-ROOM --collect` with the current directory, `PATH` and `HOME`.

```bash
journalctl --user -fu council-playtest-ROOM       # live log
node agents/playtest/run.js status --match ROOM --watch
systemctl --user stop council-playtest-ROOM       # stop all seats; report is written
node agents/playtest/run.js report --match ROOM
```

### The next playtest (live LAN server)

The human creates the room in the browser and takes Britain; then, while it is still in the lobby:

```bash
cd /home/chris/git/council-integrate   # any checkout that has agents/playtest
node agents/playtest/run.js --systemd --join --wait-start \
  --match ROOM --url https://192.168.1.216:3444 --ca /home/chris/git/council-gameui/data/tls/ca.pem \
  --seat 'codex-xhigh:germany:codex:gpt-6-luna:xhigh:Luna xhigh' \
  --seat 'codex-high:france:codex:gpt-6-luna:high:Luna high' \
  --seat 'hermes:russia:hermes:gpt-6-luna:high:Hermes Luna high' \
  --seat 'grok:usa:grok:grok-4.7:low:Grok low'
```

Add `--seat 'luna-low:ottoman:codex:gpt-6-luna:low:Luna low'` for a low-versus-high reasoning comparison. Check the plan first by adding `--dry-run`. Then start the match from the browser. `--interval 30 --turn-timeout 120` are the defaults; a slow high-reasoning seat simply takes fewer turns.

## Data and safety

Everything lives under the ignored `data/playtest/ROOM/` (directories 0700, files 0600): `run.json`, `status.json`, `report.json`, and per seat `session.json` (the seat credential), `state.json` (cursor, memory), `cursor.json`, `mcp.jsonl`, `turns.jsonl`, `messages.jsonl` (message metadata, no text), `turns/N.prompt.txt` and `turns/N.out` (raw client output, which contains game chat). Never commit or paste these; the harness never prints a credential. The agents get only the council tools (Codex read-only sandbox with shell disabled, Grok with only the MCP gateway tools, Hermes limited to the council toolset). Player messages reach the model only inside the quoted, untrusted INBOX block.

## Tests

`tests/playtest.test.js` (part of `npm test`) covers seat parsing, the argv and configs for each client, the server-inbox trigger and delivery, the proxy (only room setup hidden; `inbox` and `attention` pass through), the prompt, memory extraction, client output parsing, turn triggering, stop conditions and report aggregation, and an end-to-end run against an in-memory accelerated game server with two fake seats: join, wait for the host's start, a first turn with one accepted and one rejected march, an immediate inbox-triggered turn after a human DM (delivered from the server inbox, marked read, answered), the memory note carried into the next prompt, and a clean stop with a report when the match finishes. No model is called.
