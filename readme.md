docker commands

docker compose up -d        # start Postgres in the background
docker compose ps           # check it's running / healthy
docker compose logs -f      # tail logs
docker compose down         # stop it (keeps data)
docker compose down -v      # stop and delete data

docker exec -it lemmido-postgres psql -U lemmido -d lemmido

postgresql://lemmido:lemmido@localhost:5432/lemmido


cd D:\planitbeyond-backend\lemmido_backend
docker compose up -d