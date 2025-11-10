# Builds multi-arch Docker image, pushes to Docker Hub, updates manifest, and syncs to Umbrel
#!/usr/bin/env bash

set -euo pipefail

# Configuration
DOCKER_IMAGE="satengineer/sovereign-merchant"
DOCKER_TAG="v0.0.1"

# Print command usage and environment overrides for quick reference.
usage() {
  cat <<'USAGE'
Usage: package-umbrel-app.sh [--dry-run] [--skip-docker] <umbrel-host> <remote-app-path>

Builds multi-arch Docker image, pushes to Docker Hub, updates manifest, and syncs to Umbrel.

Options:
  --dry-run     Show what would be done without actually doing it
  --skip-docker Skip Docker build/push (just sync existing manifest)

Example:
  ./scripts/package-umbrel-app.sh umbrel@umbrel.local \
    /home/umbrel/umbrel/app-stores/getumbrel-umbrel-apps-github-53f74447/sovereign-merchant

Environment overrides:
  UMBREL_HOST           Override host/user (default: umbrel@192.168.1.168)
  UMBREL_REMOTE_PATH    Override remote path
  DOCKER_IMAGE          Override Docker image name (default: satengineer/sovereign-merchant)
USAGE
}

# Parse flags
DRY_RUN=false
SKIP_DOCKER=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --help)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-docker)
      SKIP_DOCKER=true
      shift
      ;;
    *)
      break
      ;;
  esac
done

# Resolve host/path positional args with environment fallbacks
DEFAULT_UMBREL_HOST="umbrel@192.168.1.168"
DEFAULT_REMOTE_PATH="/home/umbrel/umbrel/app-stores/getumbrel-umbrel-apps-github-53f74447/sovereign-merchant"

UMBREL_HOST="${1:-${UMBREL_HOST:-${DEFAULT_UMBREL_HOST}}}"
UMBREL_REMOTE_PATH="${2:-${UMBREL_REMOTE_PATH:-${DEFAULT_REMOTE_PATH}}}"
DOCKER_IMAGE="${DOCKER_IMAGE:-satengineer/sovereign-merchant}"

if [[ -z "${UMBREL_HOST}" || -z "${UMBREL_REMOTE_PATH}" ]]; then
  usage >&2
  exit 1
fi

# Determine repo-relative paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/umbrel"
DOCKERFILE="${REPO_ROOT}/Dockerfile"

# Verify dependencies and files exist
if [[ ! -d "${APP_DIR}" ]]; then
  echo "❌ Umbrel app directory not found at ${APP_DIR}" >&2
  exit 1
fi

if [[ ! -f "${DOCKERFILE}" ]]; then
  echo "❌ Dockerfile not found at ${DOCKERFILE}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker is required but not installed." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "❌ rsync is required but not installed." >&2
  exit 1
fi

# Function to run commands (with dry-run support)
run_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "🔍 Would run: $@"
  else
    echo "🚀 Running: $@"
    "$@"
  fi
}

echo "🏗️  Building Sovereign Merchant for Umbrel deployment..."
echo "📦 Docker Image: ${DOCKER_IMAGE}:${DOCKER_TAG}"
echo "🎯 Umbrel Host: ${UMBREL_HOST}"
echo "📁 Remote Path: ${UMBREL_REMOTE_PATH}"

# Build and push Docker image (unless skipped)
if [[ "$SKIP_DOCKER" != "true" ]]; then
  echo "🐳 Building multi-arch Docker image..."

  # Check Docker authentication
  if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon not running or not accessible"
    echo "💡 Make sure Docker Desktop is running"
    exit 1
  fi

  # Check Docker Hub authentication
  if ! docker buildx imagetools inspect "${DOCKER_IMAGE}" >/dev/null 2>&1; then
    echo "⚠️  Docker Hub authentication may be required"
    echo "💡 Run: docker login"
  fi

  # Enable buildx if not already enabled
  if ! docker buildx ls 2>/dev/null | grep -q "multi-arch-builder"; then
    echo "🔧 Creating buildx builder..."
    run_cmd docker buildx create --use --name multi-arch-builder
  else
    echo "🔧 Using existing buildx builder..."
    run_cmd docker buildx use multi-arch-builder
  fi

  # Build and push multi-arch image
  echo "🏗️  Building and pushing multi-arch image (this may take several minutes)..."
  run_cmd docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag "${DOCKER_IMAGE}:${DOCKER_TAG}" \
    --push \
    .

  # Get the SHA256 digest
  if [[ "$DRY_RUN" != "true" ]]; then
    echo "🔍 Getting SHA256 digest..."
    SHA256_DIGEST=$(docker buildx imagetools inspect "${DOCKER_IMAGE}:${DOCKER_TAG}" --format '{{json .Manifest.Digest}}' | tr -d '"')
    if [[ -z "$SHA256_DIGEST" ]]; then
      # Fallback method
      SHA256_DIGEST=$(docker inspect "${DOCKER_IMAGE}:${DOCKER_TAG}" --format='{{index .RepoDigests 0}}' 2>/dev/null | cut -d'@' -f2 || echo "")
    fi

    if [[ -z "$SHA256_DIGEST" ]]; then
      echo "❌ Failed to get SHA256 digest"
      exit 1
    fi

    echo "✅ SHA256: ${SHA256_DIGEST}"

    # Update docker-compose.yml with new digest
    DOCKER_COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
    sed -i.bak "s|${DOCKER_IMAGE}:${DOCKER_TAG}@sha256:[a-f0-9]*|${DOCKER_IMAGE}:${DOCKER_TAG}@${SHA256_DIGEST}|g" "${DOCKER_COMPOSE_FILE}"
    rm -f "${DOCKER_COMPOSE_FILE}.bak"
    echo "✅ Updated ${DOCKER_COMPOSE_FILE} with new SHA256"
  else
    echo "🔍 Would get SHA256 digest and update docker-compose.yml"
  fi
else
  echo "⏭️  Skipping Docker build/push"
fi

# Create target directory on Umbrel
if [[ "$DRY_RUN" != "true" ]]; then
  echo "📁 Creating remote directory..."
  run_cmd ssh "${UMBREL_HOST}" "mkdir -p '${UMBREL_REMOTE_PATH}'"
else
  echo "🔍 Would create remote directory: ssh ${UMBREL_HOST} mkdir -p '${UMBREL_REMOTE_PATH}'"
fi

# Sync app files to Umbrel
echo "📤 Syncing app files to Umbrel..."
RSYNC_OPTS=(-av --delete --exclude=".gitkeep")

if [[ "$DRY_RUN" == "true" ]]; then
  RSYNC_OPTS+=(--dry-run)
fi

run_cmd rsync "${RSYNC_OPTS[@]}" "${APP_DIR}/" "${UMBREL_HOST}:${UMBREL_REMOTE_PATH}/"

# Success message
cat <<EOF

✅ Sovereign Merchant packaged and deployed to Umbrel!

📍 Location: ${UMBREL_HOST}:${UMBREL_REMOTE_PATH}

🚀 Install/restart the app:
   # From Umbrel UI: Apps → Install "Sovereign Merchant"
   # Or via CLI: umbreld client apps.restart.mutate --appId sovereign-merchant

🔍 Monitor logs:
   docker logs -f sovereign-merchant_web_1

EOF
