# Goodwin DeepSeek and local Jeff

This follow-up replaces the unavailable paid Jev endpoint with **Jeff-Qwen3.5-0.8B v1.1**. Jeff is an independent open model with a compatible typed decision API, not TypeSafe Jev. [Official source](https://github.com/firelex/jeff) and [checkpoint](https://huggingface.co/mstrasser/Jeff-Qwen3.5-0.8B). The author's game demonstrations use legal options with described consequences in Doom, Frogger and Pac-Man; those demonstrations do not establish Council playing strength.

## Frozen experiment

See [goodwin-jeff-protocol.json](goodwin-jeff-protocol.json). Eight country/seed blocks compare the current Goodwin DeepSeek PI runner (`decision-turn-v9`) against the same DeepSeek model controlling diplomacy and a persistent military strategy, with local Jeff selecting forecasted military actions. Ordinary authenticated loopback rooms, seven unchanged practice bots, current map and rules from `0a9600a`, normal speed. No live service or deploy worktree is touched. Raw observations, model text, credentials and workspaces stay in ignored directories.

The hybrid reviews strategy every 180 game seconds and wakes sooner for unread diplomacy, new offers, changed relations or substantial industry loss. Checks for military options occur every five game seconds; a sole wait option makes no inference call, and unchanged menus are suppressed for up to 30 game seconds. There is no fallback controller counted as Jeff. Only the LLM declares wars. The menu includes forecasted attacks, reinforcement, development, rally and waiting; it lacks offensive long-distance sources and army turn-around.

This measures a complete system change, including planner scheduling, memory and military interface. It cannot isolate the causal effect of the small model. Eight starts are exploratory and bots do not reproduce human diplomacy. All attempts and incomplete records must be retained, with no completion-selected replacements.

## Local runtime

Pinned serving source: `f06788292874c21a5b5c41549ac220dd9e15da7f`.
Pinned checkpoint: `0f212b3e72acb4dde3f7da61e925d6ab7f819990`.
CPU: AMD Ryzen 9 9900X, two PyTorch threads, BF16 weights and reference attention kernels. No GPU allocation. One local service shared by the eight hybrid cases; busy requests retry with jitter until a 120-second deadline. Record successful-request server time separately from queue-inclusive wall time. This concurrency is a load scenario, not a single-game latency estimate.

Serving dependencies are confined to an ignored research virtual environment. They are **not** game or PI runtime dependencies. A minimal reproduction:

```sh
git clone https://github.com/firelex/jeff.git data/jeff/source
git -C data/jeff/source checkout f06788292874c21a5b5c41549ac220dd9e15da7f
uv venv --python 3.13 data/jeff/venv
uv pip install --python data/jeff/venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch==2.14.0 torchvision==0.29.0 pillow==12.3.0
uv pip install --python data/jeff/venv/bin/python transformers==5.17.0 fastapi==0.141.1 uvicorn==0.52.4 safetensors==0.8.0 huggingface-hub==1.31.0
HF_HUB_DISABLE_IMPLICIT_TOKEN=1 data/jeff/venv/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download("mstrasser/Jeff-Qwen3.5-0.8B", revision="0f212b3e72acb4dde3f7da61e925d6ab7f819990", local_dir="data/jeff/checkpoint", allow_patterns=["*.json", "*.safetensors", "*.jinja", "LICENSE", "NOTICE"])'
PYTHONPATH=data/jeff/source/src JEFF_CHECKPOINT=data/jeff/checkpoint JEFF_DEVICE=cpu JEFF_CPU_THREADS=2 JEFF_CPU_BF16=1 HF_HUB_OFFLINE=1 data/jeff/venv/bin/python agents/pi/serve-jeff.py
```

Supply the existing Goodwin profile through a private env file, then launch the durable isolated study:

```sh
node --env-file=data/goodwin-jeff/private.env agents/pi/goodwin-jeff-study.js --phase main --durable-env-file data/goodwin-jeff/private.env --out data/goodwin-jeff/main
```

The launcher refuses an uncommitted main controller/protocol and checks both endpoints before opening rooms. `agents/pi/position-bench.js` is an optional matched-menu diagnostic, not a game-strength score.

## Engineering pilot, excluded from strength evidence

Initial stock FP32 CPU inference with verbose JSON options took 4.4–10.3 seconds over six opening-menu trials (7–16 choices, 1,714–2,897 input tokens). Jeff chose wait in all six. Shorter plain-language consequences and two-thread BF16 inference took 2.9–6.1 seconds over the same six opening situations/orderings (1,197–1,794 tokens); all six still chose wait under the generic default strategy. These are pilot measurements with different runtimes and prompt representations, not a controlled dtype comparison or proof of useful play.

The integration pilot uses a distinct seed and the game's whole-clock 6× quick preset. Under DeepSeek's concrete persistent strategy, Jeff issued attacks, reinforcements, developments and a rally, and the hybrid completed a coalition win at tick 1003 with 13 personal industry. The baseline also completed a coalition win, with nine personal industry at tick 1626. Pilot LLM totals were 478,181 tokens for the baseline and 251,414 for the hybrid; this one accelerated match does not estimate normal-speed savings. A pre-main inspection corrected the hybrid diplomatic operation-ID handling to match the existing baseline: new IDs per model tool call, reused only for the same network retry. Full normal-speed results will be reported separately.

## Matched opening-menu diagnostic

Eight countries × two independently shuffled option orders, alternating model-first order, produced 16 complete trials per model with no errors. Both models received exactly the same current authenticated state and default generic strategy. Median CPU Jeff latency was 3.079 s versus 1.982 s for the complete bounded DeepSeek PI selection turn (including its post-tool acknowledgement). Jeff chose wait in 16/16 and DeepSeek chose attack in 16/16. Choices have no optimality labels; agreement is not a quality score. The result does **not** support claiming CPU Jeff is faster than this DeepSeek endpoint. Its successful integration pilot used a concrete LLM strategy rather than this generic strategy.

## Cost interpretation

Local Jeff has no per-token API fee; input tokens still consume local CPU time. Goodwin's hosting bill is unknown. PI's zero-valued model-cost fields are SDK placeholders, not actual free inference. Compare recorded uncached input, cached input and output separately, then apply the same assumed LLM price to both arms. Total hybrid cost is that LLM spend plus amortized local compute/hosting. A token reduction is not automatically a cash saving on an already fixed-price or owned server.
