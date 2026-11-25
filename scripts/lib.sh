# Shared check steps for scripts/check, scripts/check-fast and the agent hooks. Source it; do not run it.
# Every step prints what it runs and fails loudly with the command that broke.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO/web"
DOCPROC="$REPO/-/docproc"
MEDIA="$REPO/media"
PACKAGES=(web docproc media)

step() {
  echo "== $*"
}

require_file() {
  # $1 = path that must exist, $2 = how to create it
  if [ ! -e "$1" ]; then
    echo "Missing $1. $2" >&2
    return 1
  fi
}

# Base revision for "what changed on this branch": merge-base with origin/main, or HEAD on main itself.
base_rev() {
  if git -C "$REPO" rev-parse --verify --quiet origin/main >/dev/null; then
    git -C "$REPO" merge-base HEAD origin/main
  else
    git -C "$REPO" rev-parse HEAD
  fi
}

# Files changed against base_rev, including uncommitted and untracked files.
changed_files() {
  local base
  base="$(base_rev)"
  {
    git -C "$REPO" diff --name-only "$base"
    git -C "$REPO" ls-files --others --exclude-standard
  } | sort -u
}

# Packages touched by changed_files, one per line.
changed_packages() {
  changed_files | awk '
    /^web\// { print "web" }
    /^-\/docproc\// { print "docproc" }
    /^media\// { print "media" }
  ' | sort -u
}

check_web_fast() {
  require_file "$WEB/node_modules" "Run: cd web && pnpm install" || return 1
  step "web: lint"; (cd "$WEB" && pnpm -s lint) || return 1
  step "web: typecheck"; (cd "$WEB" && pnpm -s typecheck) || return 1
  step "web: unit tests"; (cd "$WEB" && pnpm -s test) || return 1
}

check_web_build() {
  step "web: build"; (cd "$WEB" && pnpm -s build) || return 1
}

check_docproc() {
  local bin="$DOCPROC/.venv-linux/bin"
  require_file "$bin/ruff" "Run: cd ./-/docproc && VIRTUAL_ENV=.venv-linux uv pip install -e '.[dev,pg,gemma]'" || return 1
  step "docproc: ruff"; (cd "$DOCPROC" && "$bin/ruff" check src tests scripts) || return 1
  step "docproc: pytest (offline fixtures)"; (cd "$DOCPROC" && "$bin/pytest" -q) || return 1
}

# media pins CUDA torch, so its environment exists only on the GPU host (see AGENTS.md).
check_media() {
  local bin="$MEDIA/.venv/bin"
  if [ ! -e "$bin/pytest" ]; then
    echo "NOTE media: not checked on this machine (no media/.venv; media runs only on the GPU host)." >&2
    return 0
  fi
  require_file "$bin/ruff" "Run: cd media && VIRTUAL_ENV=.venv uv pip install -e '.[dev]'" || return 1
  step "media: ruff"; (cd "$MEDIA" && "$bin/ruff" check src tests) || return 1
  step "media: pytest"; (cd "$MEDIA" && "$bin/pytest" -q) || return 1
}

check_guard() {
  step "guard-diff against $(base_rev)"; "$REPO/scripts/guard-diff" "$(base_rev)" || return 1
}

check_package_fast() {
  case "$1" in
    web) check_web_fast ;;
    docproc) check_docproc ;;
    media) check_media ;;
    *) echo "Unknown package: $1 (expected one of: ${PACKAGES[*]})" >&2; return 1 ;;
  esac
}
