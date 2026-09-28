# Pi solo player harness

This optional package gives one Pi agent a Council seat through the public HTTP API. It connects to the existing Council MCP server and exposes its separate tools to Pi, including `board`, `news`, `situation`, `observe`, `strategic_options`, `preview`, `move`, `coordinated_attack`, `develop`, alliance, war, peace, chat, and leaderboard commands. Vision-capable profiles also get `view_map`, which returns the exact board data plus a colored PNG. It also has three workspace tools (`read_file`, `write_file`, `run`). `board` gives a compact map of ownership, troops, direct connections, and currently payable development choices; `news` gives delivered messages without repeating the map; `situation` gives a wider state and message view; `strategic_options` gives optional forecasts. Every command goes through the same MCP definition and standard Council HTTP validation; the Pi harness filters out room setup tools for this already joined seat. Workspace files persist separately per model alias under ignored `agents/pi/workspace/`. The run tool uses Bubblewrap with only that workspace writable, no host home or match database mounted, and no network. Accepted orders pass through the same server validation and rate limits as other players.

The harness starts a private loopback server with a separate SQLite file, registers the chosen Pi player, fills seven seats with built-in non-LLM practice bots, locks its opening, and plays until the saved result exists or the run limit is reached. Each match turn includes the current authenticated compact board in the prompt and asks for a short batch of orders; the separate Council tools remain available for current details and actions. Once the authenticated observation says the seat was eliminated, both episodic runners stop spending model turns and poll for the authoritative final score. It does not join or modify the LAN round. Run artifacts and game credentials live in ignored `data/pi/` with owner-only permissions. The Qwen service must be running before a Qwen test.

For a short interface check, `--task fixed` starts that isolated room with its clock paused and asks the model to issue the same three legal orders. It uses the ordinary Council HTTP validation and does not add a public time-control endpoint. The task measures order accuracy, failed calls, reported tokens, and time to the third accepted order. It does not measure strategic playing strength.

```bash
npm ci --prefix agents/pi
npm --prefix agents/pi run play -- --model qwen --country britain --preset quick --max-minutes 12
npm --prefix agents/pi run play -- --model luna --country britain --preset standard --max-minutes 35
npm --prefix agents/pi run play -- --model sample --country britain --preset quick --max-minutes 8
node agents/pi/codex-play.js --preset quick --max-minutes 12
node agents/pi/codex-play.js --access cli --preset quick --max-minutes 12
node agents/pi/codex-play.js --model luna --preset standard --max-minutes 35
node agents/pi/codex-play.js --model luna --access mcp --turn-mode episodic --preset standard --max-minutes 35 --max-turn-seconds 240 --decision-interval-ticks 30
node agents/pi/play.js --model qwen --task fixed --preset standard --max-minutes 6 --max-turn-seconds 300
node agents/pi/codex-play.js --model qwen --access cli --task fixed --preset standard --max-minutes 6
node agents/pi/codex-play.js --model luna --access mcp --task fixed --preset standard --max-minutes 6
```

For a normal-speed matched comparison, use one model service at a time and give both clients the same country and combat seed:

```bash
node agents/pi/play.js --model qwen --country germany --preset standard --max-minutes 35 --max-turn-seconds 120 --session-mode persistent --decision-interval-ticks 30 --combat-seed trial02
node agents/pi/codex-play.js --model qwen --access cli --turn-mode episodic --country germany --preset standard --max-minutes 35 --max-turn-seconds 120 --decision-interval-ticks 30 --combat-seed trial02
```

The model alias is resolved from the ignored root `.env` (or process environment). `PI_DEFAULT_MODEL` selects the default alias. For each alias, set `PI_MODEL_<ALIAS>_PROVIDER` (`openai-completions` or `openai-codex`), `ID`, `PLAYER_NAME` (at most 40 characters), and `CONTEXT_WINDOW`. Local OpenAI-compatible profiles also need `BASE_URL` and `TRANSPORT=chat_completions`. Optional fields are `NAME`, `LEADER_NAME`, `MAX_TOKENS`, `THINKING_LEVEL`, `REASONING`, `INPUT_IMAGES`, `THINKING_FORMAT`, `CHAT_TEMPLATE_KWARGS` (JSON when `THINKING_FORMAT=chat-template`), and `API_KEY`. Set `INPUT_IMAGES=true` only for a local endpoint that accepts image input. `view_map` needs ImageMagick's `convert` on the MCP host; the text `board` remains available. See [the example config](.env.example); copy its values into the root `.env` and use any lowercase alias. No model names, endpoints, or API keys need to be added to the client source. The root `.env` is ignored by git and must not be committed. OAuth profiles read the existing Codex login in memory; no token is copied into this repo.

`--preset standard` uses the normal 30-minute clock; `quick` scales all game timings together. `--max-turns` defaults to 80. The final console line names the ignored JSON result file. A nonzero exit code means the match did not reach an authoritative finish or Pi failed.

`--max-turn-seconds` defaults to 120. It aborts an overlong model response, keeps accepted game actions, and lets the next response start with a fresh observation. Pi records provider token usage and per-turn wall time when available; Codex records token usage from `turn.completed` events. Resumed Codex turns report cumulative session usage, so the aggregate exporter uses the last completed snapshot rather than adding the snapshots. A missing token value in a result means the provider/runner did not report it, not zero tokens.

The Codex runner defaults to its historical `--turn-mode continuous`, one long response for a whole match. `--turn-mode episodic` gives Codex the same current board prompt, asks it to make a short batch of orders and finish each response, then resumes its saved session after a game-time interval. This lets the runner collect `turn.completed` usage across a long match and puts Codex on a comparable decision cadence to Pi. It uses a private ignored Codex home and the same isolated game API. If a response times out or fails, the aggregate ledger leaves its token and mean-turn fields unknown instead of reporting a partial total. This mode is experimental until a completed match validates resume behavior.

`--decision-interval-ticks` defaults to 30 game ticks. After a Pi response, the harness waits until at least that much game time has passed since the response began before asking for another decision; a no-order response also waits at least five real seconds. This changes only the test client's polling cadence, not the game clock or command limits. It avoids repeated near-identical prompts while preserving normal game speed.

`--session-mode fresh` (the default) creates a new Pi model context each turn while keeping its private workspace. `--session-mode persistent` retains the entire conversation for comparison. Both modes see the same current Council observation and use identical game validation. The benchmark ledger records the chosen mode.

The harness uses Pi's extension API to replace bulky old tool responses and old turn-board prompts in each model request; the latest board, model decisions, actual session transcript and game state remain intact. This lets persistent sessions retain strategy while limiting repeated observation tokens. The extension is built into this repo and loaded through Pi's resource loader; arbitrary third-party extensions are not auto-loaded into a player process that also hosts the isolated test server. Match runs using this context behavior are labeled `board-turn-v4` in the ledger.

For paired trials, pass the same `--combat-seed trial01` to Pi and Codex runners. Each runner has its own database; the seed fixes the room ID used by deterministic combat rolls. The map and bot policy are already fixed. Opponent decisions still diverge when the players make different moves, so this controls a source of variation without making the games identical.

## Benchmark ledger

After a completed run, publish only its aggregate metrics to the tracked JSON ledger. It reports failed tool calls and rejected game orders separately, since a shell or read-tool failure differs from a rejected order. The importer refuses unfinished games and never copies endpoint details, credentials, model messages, or raw tool payloads:

```bash
node agents/pi/bench.js qwen data/pi/<completed-run>.json
node agents/pi/bench.js luna data/pi/<completed-run>.json
node agents/pi/bench.js external data/pi/<completed-run>.json
node agents/pi/task-bench.js qwen data/pi/<completed-task>.json
node agents/pi/task-bench.js luna data/pi/<completed-task>.json
cd agents/pi && python -m http.server 8000
```

Open `http://127.0.0.1:8000/bench.html` to filter [the benchmark page](bench.html) by model, clock and measure. The page reads [benchmarks.json](benchmarks.json); regenerate it after new completed matches. Compare the same model and clock. The same-seed table keeps every Pi run and pairs it with the nearest-in-time Codex run for that model, country, clock and seed. New run records include an interface version so prompt/tool changes remain visible over time; older rows have no version. Codex Qwen shell access may use the game CLI or direct HTTP; the ledger labels the path it actually used. Rooms have independent game IDs and combat seeds, so repeated runs are needed before drawing performance conclusions.

The page also reads [task-benchmarks.json](task-benchmarks.json) for the paused task. Qwen launched through Codex with Council MCP configured used shell commands instead; that observed path is labeled `shell fallback`. The supported Qwen Codex comparison uses the CLI explicitly. Luna uses Council MCP in both clients.

Quick rooms are integration and latency trials: at 6× speed, a 120-second model turn uses twelve game minutes and a 60-game-second diplomatic offer lasts ten wall-clock seconds. A common `--combat-seed` controls combat rolls only when game state and tick match; the models' different decisions immediately create different positions. Final Prestige is the authoritative game outcome but a passive seat can earn a deadline prize. For a playing-strength claim, use repeated normal-speed rooms, rotate the country, and report first-action latency, accepted/rejected orders, final industry and Prestige separately. Provider token totals and Codex's CLI fallback are not identical instruments; treat token comparisons as directional until both clients use the same tool transport and accounting basis.

The Pi record names the selected model, endpoint, context and every accepted or failed tool call. It does not record API keys.

The current Qwen artifact is `unsloth/Qwen3.8-27B-GGUF` file `Qwen3.8-27B-UD-Q4_K_M.gguf`. Start `serve-unsloth-q4.sh` with `QWEN_GGUF_PATH` and `LLAMA_SERVER_BIN` set to its GGUF and a recent llama.cpp server. It configures the native 262,144-token context, q8 key/q5 value cache, one slot, and full GPU layers. Adjust `QWEN_GPU_LAYERS` if other GPU services change. The model is self-hosted separately; this package does not download weights or change the GPU service. Council's main package remains free of runtime dependencies. The seat's `model` label is self-declared, and a single bot test checks integration and behavior only. It cannot establish strategic balance or human enjoyment. A quick-room result is especially sensitive to model decision latency; use standard speed when comparing to the recorded Codex Luna matches.

The Codex comparison runner uses the same local Qwen endpoint through Codex CLI. It starts with the standard Council MCP; `--access cli` is an explicitly different fallback that offers the game's public CLI when the local model cannot call MCP tools in Codex. The model can also issue direct game HTTP requests from that shell; the aggregate ledger labels this observed path `shell HTTP` or `CLI + direct HTTP` instead of claiming CLI use. The CLI now has the same compact `board` read, and its `map` output omits SVG paths. Both paths use the same server validation, but their tool interfaces differ and their results must be labeled separately. `--model luna` selects Codex Luna x-high and copies the current Codex login into its ignored, private test home. Its own ignored SQLite room and session file keep the test separate from Pi and LAN games. The game database is hidden from Codex by Bubblewrap. Qwen uses the Responses wire API for a custom provider; the llama.cpp service exposes `/v1/responses`.
