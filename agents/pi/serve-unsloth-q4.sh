#!/usr/bin/env bash
# Optional local Qwen3.8-27B Unsloth GGUF service for Pi and Codex comparisons.
set -euo pipefail
: "${QWEN_GGUF_PATH:?Set QWEN_GGUF_PATH to the downloaded Unsloth GGUF file.}"
llama_server_bin=${LLAMA_SERVER_BIN:-llama-server}
qwen_ctx_size=${QWEN_CTX_SIZE:-204800}
if [[ ! $qwen_ctx_size =~ ^[0-9]+$ ]] || (( qwen_ctx_size < 200000 || qwen_ctx_size > 262144 )); then
  echo 'QWEN_CTX_SIZE must be 200000–262144 tokens.' >&2
  exit 2
fi
exec "$llama_server_bin" \
  -m "$QWEN_GGUF_PATH" \
  -a "${QWEN_MODEL_ID:-qwen3.8-27b-unsloth-q4-xl}" \
  --host 127.0.0.1 --port "${QWEN_PORT:-18082}" \
  -c "$qwen_ctx_size" -ctk q8_0 -ctv q5_1 \
  -ngl "${QWEN_GPU_LAYERS:-all}" -fa on -np 1 -b 512 -ub 512 -fit off --no-webui
