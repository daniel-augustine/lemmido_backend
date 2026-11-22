# One image for the API and the realtime service (pnpm workspace); docker-compose picks
# which one a container runs. tsx runs the TypeScript directly, as in development.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/realtime/package.json apps/realtime/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "api", "start"]
