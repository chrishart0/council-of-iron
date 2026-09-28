#!/usr/bin/env bash
# Local Qwen3.8-27B Unsloth UD-Q4_K_M service for Pi and Codex comparisons.
set -euo pipefail
: "${QWEN_GGUF_PATH:?Set QWEN_GGUF_PATH to the downloaded Unsloth UD-Q4_K_M GGUF file.}"
llama_server_bin=${LLAMA_SERVER_BIN:-llama-server}
exec "$llama_server_bin" \
  -m "$QWEN_GGUF_PATH" \
  -a qwen3.8-27b-unsloth-q4 \
  --host 127.0.0.1 --port "${QWEN_PORT:-18082}" \
  -c 262144 -ctk q8_0 -ctv q5_1 \
  -ngl "${QWEN_GPU_LAYERS:-all}" -fa on -np 1 -b 512 -ub 512 -fit off --no-webui
