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

    docker compose logs -f      # tail logs
    docker compose down         # stop it (keeps data)
    docker compose down -v      # stop and delete data

    docker exec -it lemmido-db psql -U lemmido -d lemmido

    postgres://lemmido:lemmido_dev@localhost:5432/lemmido

If you had the old `lemmido-postgres` container, remove it and its data once:

    docker rm -f lemmido-postgres && docker volume rm lemmido_backend_pgdata
