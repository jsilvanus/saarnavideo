FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
# --ignore-scripts: the postinstall `prisma generate` needs the schema, which is not copied yet.
RUN npm install --ignore-scripts

FROM base AS build
# Prisma schema the client is generated from: prisma/schema.prisma (SQLite, the default) or
# prisma/schema.postgresql.prisma (docker-compose.server.yml).
ARG PRISMA_SCHEMA=prisma/schema.prisma
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema "$PRISMA_SCHEMA" && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
