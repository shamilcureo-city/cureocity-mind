# Sprint DS8 — container image for the standalone live-copilot gateway.
#
# Vercel serverless can't hold a WebSocket, so this runs as its own
# in-region (asia-south1) service. The image installs the workspace, builds
# the gateway's TypeScript deps (contracts → llm, clinical) to their dist,
# and runs the server via tsx. Health: GET /healthz on $LIVE_GATEWAY_PORT.
#
# Build from the REPO ROOT (the workspace lockfile lives there):
#   docker build -f services/live-gateway/Dockerfile -t cureocity-live-gateway .
#
# A leaner image via `pnpm deploy --filter @cureocity/live-gateway` is a
# follow-up; this prioritises a correct, reproducible build for the pilot.

FROM node:22-slim AS base
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# --- deps + build -----------------------------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The gateway runs from TS source (tsx) but its workspace deps resolve to
# their built dist via package `main`, so build those three first.
RUN pnpm --filter @cureocity/contracts --filter @cureocity/clinical --filter @cureocity/llm build

# --- runtime ----------------------------------------------------------------
FROM build AS runtime
ENV NODE_ENV=production
ENV LIVE_GATEWAY_PORT=8787
EXPOSE 8787

# Liveness/readiness — the LB + orchestrator probe this.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LIVE_GATEWAY_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@cureocity/live-gateway", "start"]
