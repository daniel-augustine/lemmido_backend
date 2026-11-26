#!/usr/bin/env bash
# Deploy Lemmido from this machine to the VPS: copy both repos with rsync, then run
# deploy.sh --no-pull on the server (build images, migrate, restart).
#   deploy/deploy-from-local.sh            # copy code and deploy
#   deploy/deploy-from-local.sh --sync     # also re-sync rates/tours/staycations
#   deploy/deploy-from-local.sh --dry-run  # list what would be copied, change nothing
#   deploy/deploy-from-local.sh --yes      # skip the confirmation prompt
#
# Connection details: deploy/vps.env (VPS_HOST, VPS_USER, VPS_DIR, optional VPS_SSH_KEY).
# Secrets: the server's deploy/production.env is used and never overwritten. Only when the
# server has none is the local deploy/.env uploaded as production.env (after asking).
# First deploy on an empty database: seed once afterwards, see README.md step 8.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$DEPLOY_DIR")"
FRONTEND_DIR="$(dirname "$BACKEND_DIR")/lemmido_frontend"
LOCAL_PROD_ENV="$DEPLOY_DIR/.env"

DRY_RUN=0
ASSUME_YES=0
SYNC_ARG=""
for arg in "$@"; do
  case "$arg" in
    --sync) SYNC_ARG="--sync" ;;
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

[ -f "$DEPLOY_DIR/vps.env" ] || die "missing $DEPLOY_DIR/vps.env"
# shellcheck source=/dev/null
. "$DEPLOY_DIR/vps.env"
[ -n "${VPS_HOST:-}" ] || die "VPS_HOST is empty in $DEPLOY_DIR/vps.env"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/opt/lemmido}"
[ -d "$FRONTEND_DIR" ] || die "missing $FRONTEND_DIR (lemmido_frontend must sit next to lemmido_backend)"

TARGET="$VPS_USER@$VPS_HOST"
REMOTE_DEPLOY="$VPS_DIR/lemmido_backend/deploy"

# One shared SSH connection for the whole run, so a password is asked at most once.
SOCK_DIR="$(mktemp -d /tmp/lemmido-ssh.XXXXXX)"
SSH_OPTS="-o ControlMaster=auto -o ControlPath=$SOCK_DIR/sock -o ControlPersist=10m -o ServerAliveInterval=30"
if [ -n "${VPS_SSH_KEY:-}" ]; then
  VPS_SSH_KEY="${VPS_SSH_KEY/#\~/$HOME}"
  [ -f "$VPS_SSH_KEY" ] || die "VPS_SSH_KEY not found: $VPS_SSH_KEY"
  SSH_OPTS="$SSH_OPTS -i $VPS_SSH_KEY -o IdentitiesOnly=yes"
fi
cleanup() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS -O exit "$TARGET" >/dev/null 2>&1 || true
  rm -rf "$SOCK_DIR"
}
trap cleanup EXIT
# shellcheck disable=SC2086
# -n: never read local stdin, so a confirmation answer is not swallowed
remote() { ssh -n $SSH_OPTS "$TARGET" "$@"; }

echo "==> connect to $TARGET"
remote true || die "cannot SSH to $TARGET"

echo "==> check server tools"
remote 'command -v docker >/dev/null' || die "Docker is not installed on the server (README.md step 2)"
remote 'docker compose version >/dev/null' || die "docker compose v2 is missing on the server"
remote 'command -v rsync >/dev/null' || die "rsync is missing on the server: ssh $TARGET 'apt-get install -y rsync'"

echo "==> current contents of $VPS_DIR on the server"
remote "ls -la '$VPS_DIR' 2>/dev/null || echo '(does not exist yet)'"

HAS_PROD_ENV=0
remote "test -f '$REMOTE_DEPLOY/production.env'" && HAS_PROD_ENV=1
if [ "$HAS_PROD_ENV" = 1 ]; then
  echo "==> using the server's existing production.env (left untouched)"
elif [ -f "$LOCAL_PROD_ENV" ]; then
  echo "==> the server has no production.env; the local deploy/.env would be uploaded as one"
else
  die "the server has no $REMOTE_DEPLOY/production.env and there is no local deploy/.env to upload"
fi

if [ "$DRY_RUN" = 0 ]; then
  if [ "$ASSUME_YES" = 0 ]; then
    printf 'Deploy to %s:%s? [y/N] ' "$TARGET" "$VPS_DIR"
    read -r answer || answer=""
    case "$answer" in y|Y|yes) ;; *) echo "aborted"; exit 1 ;; esac
  fi
  remote "mkdir -p '$VPS_DIR'"
fi

# Excluded paths are neither copied nor deleted on the server, so its production.env,
# node_modules and .git survive --delete. .env.example is the one env file that is copied.
RSYNC_FLAGS="-az --delete --itemize-changes"
[ "$DRY_RUN" = 1 ] && RSYNC_FLAGS="$RSYNC_FLAGS --dry-run"
sync_repo() {
  echo "==> copy $(basename "$1")"
  # shellcheck disable=SC2086
  rsync $RSYNC_FLAGS -e "ssh $SSH_OPTS" \
    --include='.env.example' \
    --exclude='.env' --exclude='.env.*' \
    --exclude='/deploy/production.env' --exclude='/deploy/vps.env' \
    --exclude='node_modules' --exclude='.next' --exclude='.git' \
    --exclude='.turbo' --exclude='coverage' --exclude='.DS_Store' \
    "$1/" "$TARGET:$VPS_DIR/$(basename "$1")/"
}
sync_repo "$BACKEND_DIR"
sync_repo "$FRONTEND_DIR"

if [ "$DRY_RUN" = 1 ]; then
  echo "Dry run: nothing was changed on the server."
  exit 0
fi

if [ "$HAS_PROD_ENV" = 0 ]; then
  echo "==> upload deploy/.env as production.env"
  # shellcheck disable=SC2086
  scp -q $SSH_OPTS "$LOCAL_PROD_ENV" "$TARGET:$REMOTE_DEPLOY/production.env"
  remote "chmod 600 '$REMOTE_DEPLOY/production.env'"
fi

echo "==> deploy on the server"
# shellcheck disable=SC2086
ssh $SSH_OPTS -t "$TARGET" "cd '$REMOTE_DEPLOY' && ./deploy.sh --no-pull $SYNC_ARG"
