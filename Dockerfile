# syntax=docker/dockerfile:1.7

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
# Cached on lockfile only. Includes devDeps because next build needs them.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: builder ───────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── Stage 3: runner ────────────────────────────────────────────────────────
# Only this stage lands in the final image.
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SCRIPTR_DATA_DIR=/data

# /data is the bind-mount target. Pre-create it owned by the node user
# so writes work when the host UID matches; document UID mismatch handling
# in the README rather than chowning at startup.
RUN mkdir -p /data && chown -R node:node /data /app

# Standalone output lands flat at /app/.next/standalone/server.js because
# next.config.ts pins outputFileTracingRoot to the project directory.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
