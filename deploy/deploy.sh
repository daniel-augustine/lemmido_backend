#!/usr/bin/env bash
# Deploy (or redeploy) Lemmido on the VPS. Run from anywhere:
#   /opt/lemmido/lemmido_backend/deploy/deploy.sh            # pull, build, migrate, restart
#   /opt/lemmido/lemmido_backend/deploy/deploy.sh --no-pull  # deploy what's checked out
#   /opt/lemmido/lemmido_backend/deploy/deploy.sh --sync     # also re-sync rates/tours/staycations
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$DEPLOY_DIR")"
FRONTEND_DIR="$(dirname "$BACKEND_DIR")/lemmido_frontend"
BRANCH="${BRANCH:-main}"

PULL=1
SYNC=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --sync) SYNC=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

[ -f "$DEPLOY_DIR/production.env" ] || {
  echo "Missing $DEPLOY_DIR/production.env (copy production.env.example and fill it in)" >&2
  exit 1
}
[ -d "$FRONTEND_DIR" ] || { echo "Missing $FRONTEND_DIR (clone lemmido_frontend next to the backend)" >&2; exit 1; }

compose() {
  docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$DEPLOY_DIR/production.env" "$@"
}

if [ "$PULL" = 1 ]; then
  for dir in "$BACKEND_DIR" "$FRONTEND_DIR"; do
    echo "==> git pull $(basename "$dir") ($BRANCH)"
    git -C "$dir" fetch origin
    git -C "$dir" checkout "$BRANCH"
    git -C "$dir" pull --ff-only origin "$BRANCH"
  done
fi

echo "==> build images"
compose build

echo "==> start postgres"
compose up -d --wait postgres

echo "==> run migrations"
compose run --rm --no-deps api pnpm db:migrate

if [ "$SYNC" = 1 ]; then
  echo "==> sync rates, tours, staycations"
  compose run --rm --no-deps api pnpm db:sync-rates
  compose run --rm --no-deps api pnpm db:sync-tours
  compose run --rm --no-deps api pnpm db:sync-staycations
fi

echo "==> start everything"
compose up -d --remove-orphans

echo "==> clean up old images"
docker image prune -f >/dev/null

compose ps
echo "Done. Logs: docker compose -f $DEPLOY_DIR/docker-compose.prod.yml --env-file $DEPLOY_DIR/production.env logs -f"
