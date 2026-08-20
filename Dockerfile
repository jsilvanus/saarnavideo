FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
