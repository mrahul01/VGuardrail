#!/usr/bin/env bash
# provision-policy-rules.sh — provision the policy engine's optional models and
# detector-policy configuration.
#
# What this sets up:
#   1. policy-engine/models/         — a small instruct GGUF for the llama.cpp
#      server used by the engine's AI-classification refinement (category 15).
#      The engine is fully functional WITHOUT this model: all 15 categories run
#      on the offline rule-based detectors; the LLM may only raise the risk
#      tier of ambiguous prompts (see pe-engine/src/llm.rs).
#   2. policy-engine/config/detectors.yaml — org-tunable detector policy
#      (keywords, project codenames, thresholds), created from the example.
#
# Usage:
#   ./provision-policy-rules.sh            # download model + write config
#   ./provision-policy-rules.sh --no-model # config only (skip the download)
#
# Then:
#   docker compose -f docker-compose.local.yml --profile llm up llm
#   VG_LLM_ENDPOINT=127.0.0.1:8090 \
#   VG_DETECTOR_CONFIG="$PWD/policy-engine/config/detectors.yaml" pe-engined
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="$ROOT/policy-engine/models"
CONFIG_DIR="$ROOT/policy-engine/config"

# IBM Granite Guardian 3.0 2B (Apache-2.0): purpose-built risk/safety
# classifier — not a repurposed chat model — covering PII, credentials, prompt
# injection, medical data and more. ~1.6 GB at Q4_K_M; CPU latency ~1-4 s, so
# pair it with VG_LLM_TIMEOUT_MS=2500 (the engine's prompt cache amortises
# repeats, and the engine stays fully functional without the model).
MODEL_FILE="granite-guardian-3.0-2b.Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/mradermacher/granite-guardian-3.0-2b-GGUF/resolve/main/granite-guardian-3.0-2b.Q4_K_M.gguf"

SKIP_MODEL=0
for arg in "$@"; do
  case "$arg" in
    --no-model) SKIP_MODEL=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$MODELS_DIR"

# 1. Detector-policy config (never overwrite an existing org config).
if [[ -f "$CONFIG_DIR/detectors.yaml" ]]; then
  echo "✓ $CONFIG_DIR/detectors.yaml already exists — leaving it untouched"
else
  cp "$CONFIG_DIR/detectors.example.yaml" "$CONFIG_DIR/detectors.yaml"
  echo "✓ wrote $CONFIG_DIR/detectors.yaml (edit keywords/project_codenames for your org)"
fi

# 2. Classification model.
if [[ "$SKIP_MODEL" -eq 1 ]]; then
  echo "→ skipping model download (--no-model)"
elif [[ -s "$MODELS_DIR/$MODEL_FILE" ]]; then
  echo "✓ $MODELS_DIR/$MODEL_FILE already present"
else
  echo "→ downloading $MODEL_FILE (~1.6 GB) …"
  curl -fL --progress-bar -o "$MODELS_DIR/$MODEL_FILE.part" "$MODEL_URL"
  mv "$MODELS_DIR/$MODEL_FILE.part" "$MODELS_DIR/$MODEL_FILE"
  echo "✓ saved $MODELS_DIR/$MODEL_FILE"
fi

cat <<EOF

Done. Next steps:
  docker compose -f docker-compose.local.yml --profile llm up -d llm
  export VG_LLM_ENDPOINT=127.0.0.1:8090            # optional LLM refinement
  export VG_LLM_TIMEOUT_MS=2500                    # Granite Guardian 2B on CPU
  export VG_DETECTOR_CONFIG=$CONFIG_DIR/detectors.yaml
  # restart pe-engined (launchctl kickstart -k system/com.vguardrail.policy-engine)
EOF
