# Syncs the Umbrel app scaffold into an Umbrel app store directory via rsync so
# the app can be installed from the Umbrel UI or umbrel-dev CLI. Intentionally
# mirrors the workflow described in the Umbrel App Framework docs.
#!/usr/bin/env bash

set -euo pipefail

# Print command usage and environment overrides for quick reference.
usage() {
  cat <<'USAGE'
Usage: package-umbrel-app.sh [--dry-run] <umbrel-host> <remote-app-path>

Example:
  ./scripts/package-umbrel-app.sh umbrel@umbrel.local \
    /home/umbrel/umbrel/app-stores/getumbrel-umbrel-apps-github-53f74447/sovereign-merchant

Environment overrides:
  UMBREL_HOST           Override host/user (default: umbrel@umbrel.local)
  UMBREL_REMOTE_PATH    Override remote path (default: /home/umbrel/umbrel/app-stores/getumbrel-umbrel-apps-github-53f74447/sovereign-merchant)
USAGE
}

# Parse optional --help/--dry-run switches before positional args.
declare -a DRY_RUN_FLAG=()
if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_FLAG+=(--dry-run)
  shift
fi

# Resolve host/path positional args with environment fallbacks for convenience.
# Default destinations can be overridden via env vars or CLI args.
# TODO: auto-detect host/IP from Umbrel discovery; hardcoded for now.
DEFAULT_UMBREL_HOST="umbrel@192.168.1.168"
DEFAULT_REMOTE_PATH="/home/umbrel/umbrel/app-stores/getumbrel-umbrel-apps-github-53f74447/sovereign-merchant"

UMBREL_HOST="${1:-${UMBREL_HOST:-${DEFAULT_UMBREL_HOST}}}"
UMBREL_REMOTE_PATH="${2:-${UMBREL_REMOTE_PATH:-${DEFAULT_REMOTE_PATH}}}"

if [[ -z "${UMBREL_HOST}" || -z "${UMBREL_REMOTE_PATH}" ]]; then
  usage >&2
  exit 1
fi

# Verify dependencies early so failures are fast and clear.
if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required but not installed." >&2
  exit 1
fi

# Connecting by SSH prompts for credentials unless you have keys configured.
# Determine repo-relative paths so the script works from any directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/umbrel"

# Ensure the Umbrel packaging directory exists before proceeding.
if [[ ! -d "${APP_DIR}" ]]; then
  echo "Umbrel app directory not found at ${APP_DIR}" >&2
  exit 1
fi

# Create target directory in advance to avoid rsync errors on first sync.
ssh "${UMBREL_HOST}" "mkdir -p '${UMBREL_REMOTE_PATH}'"

# Sync app files to the Umbrel app store directory, mirroring current repo state.
# --delete keeps the remote directory in sync with git HEAD (removes stale files).
RSYNC_OPTS=(-av --delete --exclude=".gitkeep")
RSYNC_CMD=(rsync "${RSYNC_OPTS[@]}")
if [[ ${#DRY_RUN_FLAG[@]} -gt 0 ]]; then
  RSYNC_CMD+=("${DRY_RUN_FLAG[@]}")
fi
RSYNC_CMD+=("${APP_DIR}/" "${UMBREL_HOST}:${UMBREL_REMOTE_PATH}/")
"${RSYNC_CMD[@]}"

# Provide the exact command needed to reinstall once the files are in place.
cat <<EOF
Synced Umbrel app to ${UMBREL_HOST}:${UMBREL_REMOTE_PATH}

Install (or reinstall) the app from the Umbrel UI. On umbrel-dev you can run:
  npm run dev client -- apps.install.mutate -- --appId sovereign-merchant
EOF
