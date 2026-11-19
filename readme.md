## Local database

Everyone uses the same local Postgres: container `lemmido-db`, volume `lemmido-pgdata`,
user/db `lemmido`, password `lemmido_dev`.

    cp .env.example .env
    cp packages/db/.env.example packages/db/.env
    docker compose up -d        # start Postgres in the background
    docker compose ps           # check it's running / healthy
    pnpm install
    pnpm db:migrate             # create the tables
    pnpm db:seed                # example services and users
    pnpm db:sync-rates          # driver and companion rates from packages/db/config/service-rates.json
    pnpm db:sync-tours          # tour packages from packages/db/config/tour-packages.json
    pnpm db:sync-staycations    # staycations from packages/db/config/staycations.json

    docker compose logs -f      # tail logs
    docker compose down         # stop it (keeps data)
    docker compose down -v      # stop and delete data

    docker exec -it lemmido-db psql -U lemmido -d lemmido

    postgres://lemmido:lemmido_dev@localhost:5432/lemmido

If you had the old `lemmido-postgres` container, remove it and its data once:

    docker rm -f lemmido-postgres && docker volume rm lemmido_backend_pgdata

## Driver and companion rates

The per km and per hour rates are edited in `packages/db/config/service-rates.json`, never in the
database. After changing it, run `pnpm db:sync-rates` (add `--dry-run` first to check the file and
list what would be added, changed or deleted).

| Rate | Charged for |
|---|---|
| `per_km` | every km driven in our vehicle, base to base |
| `drive_hour` | every hour driving the customer's vehicle, base to base |
| `waiting_hour` | the driver waiting at the destination (round trips only) |
| `service_hour` | the companion's time with the customer |

- `id` is the `services.service_id` and `service` its `service_type`; both must match a service
  that already exists (`pnpm db:seed`).
- Rates are in whole rupees per km or per hour; they're stored in paise in `service_rates`.
- A rate removed from the file is deleted. A service missing a rate it needs is priced by an admin.
- Extra time when a job runs over is charged at the waiting or service hour rate.

## Tour packages and staycations

Both are edited in JSON files, never in the database. After changing a file, run its command
(add `--dry-run` first to check the file and list what would be added, updated or hidden):

| Config file | Command | Price field |
|---|---|---|
| `packages/db/config/tour-packages.json` | `pnpm db:sync-tours` | `pricePerPersonInr` (a `per_person` rate) |
| `packages/db/config/staycations.json` | `pnpm db:sync-staycations` | `pricePerNightInr` (a `per_night` rate) |

- `id` is the entry's `services.service_id`: `tp_` (tours) or `st_` (staycations) plus up to 7
  characters. Don't rename it once bookings exist; a renamed id is a new entry and the old one is hidden.
- Prices are in whole rupees; they're stored in paise in `service_rates`.
- An entry removed from the file is hidden (`active = false`), not deleted, because bookings may
  point at it. Putting it back in the file shows it again.
- The order in the file is the order on the page.
- The web app reads them from `GET /tour-packages` and `GET /staycations`.

## Services

    pnpm dev            # both services below, each line prefixed with its app
    pnpm dev:realtime   # apps/realtime: WebSocket server on :8080
    pnpm dev:api        # apps/api: HTTP API (Hono) on :8081, used by the web and mobile apps

The API reads `.env` (DATABASE_URL, API_PORT, WEB_ORIGIN).

    curl "http://localhost:8081/bookings/full-dates?from=2026-11-16&to=2026-11-30"
