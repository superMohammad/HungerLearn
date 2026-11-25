#!/usr/bin/env bash
# Set up Hunger Learn on a laptop without a GPU.
# LLM calls go to Ollama on the team GPU host over Tailscale; Postgres, docproc and web run locally.
# Lesson videos (hlmedia) render only on the GPU host.
#
# Usage: GPU_HOST=<tailscale name or IP> DEMO_PASSWORD=<min 8 chars> scripts/setup-teammate.sh
set -euo pipefail

: "${GPU_HOST:?Set GPU_HOST to the Tailscale name or IP of the GPU host}"
: "${DEMO_PASSWORD:?Set DEMO_PASSWORD (min 8 chars) for the seeded demo accounts}"
if [ "${#DEMO_PASSWORD}" -lt 8 ]; then
  echo "DEMO_PASSWORD must be at least 8 characters" >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCPROC="$REPO/-/docproc"
WEB="$REPO/web"
OLLAMA="http://$GPU_HOST:11434"

for cmd in docker uv node pnpm curl jq git; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 1; }
done

for f in "$DOCPROC/.env" "$WEB/.env.local"; do
  if [ -e "$f" ]; then
    echo "$f already exists. Move it away first; this script does not overwrite config." >&2
    exit 1
  fi
done

echo "== Checking Ollama on the GPU host ($OLLAMA)"
if ! curl -fsS --max-time 10 "$OLLAMA/api/tags" >/dev/null; then
  echo "Ollama is not reachable at $OLLAMA. Is Tailscale up on both machines and the GPU host on?" >&2
  exit 1
fi

echo "== Starting Postgres + pgvector"
docker compose -f "$REPO/docker-compose.yml" up -d
for _ in $(seq 1 30); do
  docker exec hungerlearn-db pg_isready -U hungerlearn >/dev/null 2>&1 && break
  sleep 1
done
docker exec hungerlearn-db pg_isready -U hungerlearn >/dev/null || { echo "Postgres did not become ready" >&2; exit 1; }

echo "== docproc (CPU torch only)"
uv venv "$DOCPROC/.venv-linux"
VIRTUAL_ENV="$DOCPROC/.venv-linux" uv pip install \
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
  -e "$DOCPROC[dev,pg,gemma]"
cat > "$DOCPROC/.env" <<EOF
DOCPROC_BACKEND=postgres
DOCPROC_PG_DSN=postgresql://hungerlearn:hungerlearn@127.0.0.1:5442/hungerlearn
DOCPROC_LLM=openai_compat
DOCPROC_LLM_BASE_URL=$OLLAMA/v1
DOCPROC_LLM_MODEL=gemma4:latest
DOCPROC_LLM_API_KEY=ollama
DOCPROC_LLM_TIMEOUT_S=300
DOCPROC_LLM_REASONING_EFFORT=high
DOCPROC_EMBEDDINGS=embeddinggemma
DOCPROC_EMBEDDING_MODEL=google/embeddinggemma-2
DOCPROC_EMBEDDING_DIM=768
DOCPROC_EMBEDDING_DEVICE=cpu
DOCPROC_OCR=null
EOF

echo "== web"
mkdir -p "$WEB/.uploads" "$REPO/media/out"
cat > "$WEB/.env.local" <<EOF
DATABASE_URL=postgresql://hungerlearn:hungerlearn@127.0.0.1:5442/hungerlearn
READONLY_DATABASE_URL=postgresql://hl_readonly:hl_readonly@127.0.0.1:5442/hungerlearn
LLM_BASE_URL=$OLLAMA/v1
LLM_MODEL=gemma4:latest
LLM_API_KEY=ollama
LLM_REASONING_EFFORT=high
DOCPROC_DIR=$DOCPROC
DOCPROC_BIN=$DOCPROC/.venv-linux/bin/docproc
# hlmedia needs CUDA: renders fail on this laptop. Verify videos on http://$GPU_HOST:3000
MEDIA_DIR=$REPO/media
MEDIA_BIN=$REPO/media/.venv/bin/hlmedia
MEDIA_OUT_DIR=$REPO/media/out
UPLOAD_DIR=$WEB/.uploads
TRAINING_PROMPT_PATH=$REPO/hunger-learn-training-generator-prompt.md
OLLAMA_URL=$OLLAMA
DEMO_PASSWORD=$DEMO_PASSWORD
EOF
(cd "$WEB" && pnpm install && pnpm db:migrate && pnpm db:seed)

echo "== Team workflow: git hooks (pre-commit runs scripts/check-fast, pre-push blocks main)"
git -C "$REPO" config --local core.hooksPath .githooks
"$REPO/scripts/check"

cat <<EOF

Done. Next:
  1. Accept the EmbeddingGemma licence on Hugging Face, then: $DOCPROC/.venv-linux/bin/hf auth login
  2. cd web && pnpm dev     -> http://localhost:3000
  3. Read the Workflow section of AGENTS.md. Before every PR: scripts/check
  4. Codex users: open the repo in Codex once and trust the project hooks (.codex/hooks.json).
EOF
