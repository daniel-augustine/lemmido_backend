# Deploying Lemmido to the Hostinger VPS

One Docker Compose stack runs everything: `postgres`, `api` (:8081), `realtime` (:8080, WebSocket),
`web` (Next.js, :3000) and `caddy` (HTTPS on 80/443). Only Caddy is reachable from outside.

| Domain | Goes to |
|---|---|
| `WEB_DOMAIN` (and `www.`) | web |
| `API_DOMAIN` | api |
| `RT_DOMAIN` | realtime (wss) |

## One-time server setup

1. **DNS** (Hostinger hPanel → Domains → DNS): add A records for `@`, `www`, `api`, `rt` pointing
   at the VPS IP.
2. **SSH in and install Docker** (skip if the VPS used Hostinger's "Ubuntu with Docker" template):

       ssh root@<VPS_IP>
       curl -fsSL https://get.docker.com | sh
       docker compose version        # needs v2.17+

3. **Firewall**: allow only SSH and web.

       ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

4. **Clone both repos side by side** (private repos: add a deploy key or use a GitHub token):

       mkdir -p /opt/lemmido && cd /opt/lemmido
       git clone https://github.com/planitbeyond/lemmido_backend.git
       git clone https://github.com/planitbeyond/lemmido_frontend.git

5. **Secrets**:

       cd /opt/lemmido/lemmido_backend/deploy
       cp production.env.example production.env
       openssl rand -hex 32          # run 3x: POSTGRES_PASSWORD, JWT_SECRET, BETTER_AUTH_SECRET
       nano production.env

   Use hex values for `POSTGRES_PASSWORD` (it goes inside a URL, so no `@ : / #`).

6. **Cognito**: add `https://<WEB_DOMAIN>/api/auth/callback/cognito` to the app client's allowed
   callback URLs and `https://<WEB_DOMAIN>` to sign-out URLs.
7. **Google Cloud**: allow `https://<WEB_DOMAIN>/*` on the Maps JS key's HTTP referrers.

8. **First deploy**, then load the seed data once:

       ./deploy.sh --sync
       docker compose -f docker-compose.prod.yml --env-file production.env run --rm api pnpm db:seed

## Redeploying

    /opt/lemmido/lemmido_backend/deploy/deploy.sh            # pull main, build, migrate, restart
    /opt/lemmido/lemmido_backend/deploy/deploy.sh --sync     # also after editing packages/db/config/*.json
    BRANCH=some-branch ./deploy.sh                           # deploy another branch
    ./deploy.sh --no-pull                                    # deploy what's checked out

`NEXT_PUBLIC_*` values are baked into the web image at build time, so changing them (or a domain)
needs a redeploy, not just a restart.

## Day to day

    cd /opt/lemmido/lemmido_backend/deploy
    alias dc='docker compose -f docker-compose.prod.yml --env-file production.env'
    dc ps
    dc logs -f api                  # or web, realtime, caddy, postgres
    dc restart web
    dc exec postgres psql -U lemmido -d lemmido

    # backup / restore
    dc exec -T postgres pg_dump -U lemmido lemmido | gzip > ~/lemmido-$(date +%F).sql.gz
    gunzip -c backup.sql.gz | dc exec -T postgres psql -U lemmido -d lemmido

Health checks: `https://<API_DOMAIN>/health`, `https://<RT_DOMAIN>/health`.
