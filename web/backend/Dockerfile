# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-alpine3.23 AS base

FROM base AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY db ./db
RUN npm run build

FROM base AS production-deps
WORKDIR /app
COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /app/package.json ./package.json
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/db ./db
USER node
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
