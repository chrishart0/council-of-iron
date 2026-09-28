# Pi solo player harness

This optional package gives one Pi agent a Council seat through the public HTTP API. It connects to the existing Council MCP server and exposes its separate tools to Pi, including `situation`, `observe`, `strategic_options`, `preview`, `move`, `coordinated_attack`, `develop`, alliance, war, peace, chat, and leaderboard commands. It also has three workspace tools (`read_file`, `write_file`, `run`). `situation` is a compact recipient-filtered view of the same observation, and `strategic_options` summarizes currently connected targets and payable developments. Every command goes through the same MCP definition and standard Council HTTP validation; the Pi harness filters out room setup tools for this already joined seat. Workspace files persist separately per model alias under ignored `agents/pi/workspace/`. The run tool uses Bubblewrap with only that workspace writable, no host home or match database mounted, and no network. Accepted orders pass through the same server validation and rate limits as other players.

The harness starts a private loopback server with a separate SQLite file, registers the chosen Pi player, fills seven seats with built-in non-LLM practice bots, locks its opening, and plays until the saved result exists or the run limit is reached. It does not join or modify the LAN round. Run artifacts and game credentials live in ignored `data/pi/` with owner-only permissions. The Qwen service must be running before a Qwen test.

```bash
npm ci --prefix agents/pi
npm --prefix agents/pi run play -- --model qwen --country britain --preset quick --max-minutes 12
npm --prefix agents/pi run play -- --model luna --country britain --preset standard --max-minutes 35
npm --prefix agents/pi run play -- --model sample --country britain --preset quick --max-minutes 8
node agents/pi/codex-play.js --preset quick --max-minutes 12
node agents/pi/codex-play.js --access cli --preset quick --max-minutes 12
node agents/pi/codex-play.js --model luna --preset standard --max-minutes 35
```

The model alias is resolved from the ignored root `.env` (or process environment). `PI_DEFAULT_MODEL` selects the default alias. For each alias, set `PI_MODEL_<ALIAS>_PROVIDER` (`openai-completions` or `openai-codex`), `ID`, `PLAYER_NAME` (at most 40 characters), and `CONTEXT_WINDOW`. Local OpenAI-compatible profiles also need `BASE_URL` and `TRANSPORT=chat_completions`. Optional fields are `NAME`, `LEADER_NAME`, `MAX_TOKENS`, `THINKING_LEVEL`, `REASONING`, `THINKING_FORMAT`, `CHAT_TEMPLATE_KWARGS` (JSON when `THINKING_FORMAT=chat-template`), and `API_KEY`. See [the example config](.env.example); copy its values into the root `.env` and use any lowercase alias. No model names, endpoints, or API keys need to be added to the client source. The root `.env` is ignored by git and must not be committed. OAuth profiles read the existing Codex login in memory; no token is copied into this repo.

`--preset standard` uses the normal 30-minute clock; `quick` scales all game timings together. `--max-turns` defaults to 80. The final console line names the ignored JSON result file. A nonzero exit code means the match did not reach an authoritative finish or Pi failed.

`--max-turn-seconds` defaults to 120. It aborts an overlong model response, keeps accepted game actions, and lets the next response start with a fresh observation. Pi records provider token usage and per-turn wall time when available; Codex records token usage from `turn.completed` events. A missing token value in a result means the provider/runner did not report it, not zero tokens.

## Benchmark ledger

After a completed run, publish only its aggregate metrics to the tracked JSON ledger. The importer refuses unfinished games and never copies endpoint details, credentials, model messages, or raw tool payloads:

```bash
node agents/pi/bench.js qwen data/pi/<completed-run>.json
node agents/pi/bench.js luna data/pi/<completed-run>.json
cd agents/pi && python -m http.server 8000
```

Open `http://127.0.0.1:8000/bench.html` to filter [the benchmark page](bench.html) by model, clock and measure. The page reads [benchmarks.json](benchmarks.json); regenerate it after new completed matches. Compare the same model and clock. The current Codex Qwen games used the CLI fallback because the direct MCP path did not expose Council tools; that different interface is labeled in the ledger. Rooms have independent game IDs and combat seeds, so repeated runs are needed before drawing performance conclusions.

The Pi record names the selected model, endpoint, context and every accepted or failed tool call. It does not record API keys.

The current Qwen artifact is `unsloth/Qwen3.8-27B-GGUF` file `Qwen3.8-27B-UD-Q4_K_M.gguf`. Start `serve-unsloth-q4.sh` with `QWEN_GGUF_PATH` and `LLAMA_SERVER_BIN` set to its GGUF and a recent llama.cpp server. It configures the native 262,144-token context, q8 key/q5 value cache, one slot, and full GPU layers. Adjust `QWEN_GPU_LAYERS` if other GPU services change. The model is self-hosted separately; this package does not download weights or change the GPU service. Council's main package remains free of runtime dependencies. The seat's `model` label is self-declared, and a single bot test checks integration and behavior only. It cannot establish strategic balance or human enjoyment. A quick-room result is especially sensitive to model decision latency; use standard speed when comparing to the recorded Codex Luna matches.

The Codex comparison runner uses the same local Qwen endpoint through Codex CLI. It starts with the standard Council MCP; `--access cli` is an explicitly different fallback that uses the game's public CLI when the local model cannot call MCP tools in Codex. Both paths use the same server validation, but their tool interfaces differ and their results must be labeled separately. `--model luna` selects Codex Luna x-high and copies the current Codex login into its ignored, private test home. Its own ignored SQLite room and session file keep the test separate from Pi and LAN games. The game database is hidden from Codex by Bubblewrap. Qwen uses the Responses wire API for a custom provider; the llama.cpp service exposes `/v1/responses`.
