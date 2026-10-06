FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma's engines need OpenSSL (not in the slim image) and detect it when `prisma generate` runs.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
# --ignore-scripts: the postinstall `prisma generate` needs the schema, which is copied in the build stage.
RUN npm install --ignore-scripts

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The image is for PostgreSQL (docker-compose.yml): generate that client, not the SQLite one the postinstall step made.
RUN npx prisma generate --schema prisma/schema.postgresql.prisma && npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
