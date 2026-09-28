# Pi solo player harness

This optional package gives one Pi agent a Council seat through the public HTTP API. It connects to the existing Council MCP server and exposes its separate tools to Pi, including `observe`, `strategic_options`, `preview`, `move`, `coordinated_attack`, `develop`, alliance, war, peace, chat, and leaderboard commands. It also has three workspace tools (`read_file`, `write_file`, `run`). `strategic_options` summarizes currently connected targets and payable developments from the same observation used by the game MCP. Every command goes through the same MCP definition and standard Council HTTP validation; the Pi harness filters out room setup tools for this already joined seat. Workspace files persist separately for Qwen and Luna under ignored `agents/pi/workspace/`. The run tool uses Bubblewrap with only that workspace writable, no host home or match database mounted, and no network. Accepted orders pass through the same server validation and rate limits as other players.

The harness starts a private loopback server with a separate SQLite file, registers the chosen Pi player, fills seven seats with built-in non-LLM practice bots, locks its opening, and plays until the saved result exists or the run limit is reached. It does not join or modify the LAN round. Run artifacts and game credentials live in ignored `data/pi/` with owner-only permissions. The Qwen service must be running before a Qwen test.

```bash
npm ci --prefix agents/pi
QWEN_BASE_URL=http://127.0.0.1:18082/v1 npm --prefix agents/pi run play -- --country britain --preset quick --max-minutes 12
npm --prefix agents/pi run play -- --model luna --country britain --preset standard --max-minutes 35
node agents/pi/codex-play.js --preset quick --max-minutes 12
```

Set `QWEN_MODEL` if the service advertises a different ID. The default is `qwen3.8-27b-unsloth-q4`. `--model luna` selects `gpt-6-luna` at x-high through Pi's Codex provider and reads the existing Codex OAuth session in memory; no token is copied into this repo. `--preset standard` uses the normal 30-minute clock; `quick` scales all game timings together. `--max-turns` defaults to 80. The final console line names the ignored JSON result file. A nonzero exit code means the match did not reach an authoritative finish or Pi failed.

The current Qwen artifact is `unsloth/Qwen3.8-27B-GGUF` file `Qwen3.8-27B-UD-Q4_K_M.gguf`. Start `serve-unsloth-q4.sh` with `QWEN_GGUF_PATH` and `LLAMA_SERVER_BIN` set to its GGUF and a recent llama.cpp server. It configures the native 262,144-token context, q8 key/q5 value cache, one slot, and full GPU layers. Adjust `QWEN_GPU_LAYERS` if other GPU services change. The model is self-hosted separately; this package does not download weights or change the GPU service. Council's main package remains free of runtime dependencies. The seat's `model` label is self-declared, and a single bot test checks integration and behavior only. It cannot establish strategic balance or human enjoyment. A quick-room result is especially sensitive to model decision latency; use standard speed when comparing to the recorded Codex Luna matches.

The Codex comparison runner uses the same local Qwen endpoint through Codex CLI and the standard Council MCP. Its own ignored SQLite room and session file keep the test separate from Pi and LAN games. Codex uses the Responses wire API for a custom provider; the llama.cpp service exposes `/v1/responses`.
