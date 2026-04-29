---
title: Docker hosting for the browser variant — design
date: 2026-04-28
status: draft
---

# Docker hosting for the browser variant

Ship a first-class Docker setup for self-hosting scriptr's browser variant. Same Next.js app and privacy posture as the existing web/desktop builds — only add the container shell, a compose file, an image registry pipeline, and the docs that make "easy to use" actually easy.

## Goals

- One-command bring-up on a trusted machine: `docker compose up -d` after editing `.env`.
- Published, multi-arch image at `ghcr.io/daelso/scriptr` so users don't have to build locally.
- Works equally well for the home-server-on-the-LAN user and the self-hoster who fronts it with their own reverse proxy.
- Preserve scriptr's privacy posture: no telemetry added, no new egress destinations, the only outbound host remains `api.x.ai`.
- Data persists across container restarts via a host bind mount that the user can `tar` for backup.

## Non-goals

- Multi-user authentication. Scriptr is single-user; auth is the operator's responsibility (reverse proxy, VPN, etc.).
- Multi-replica scaling. File-based storage with no locking; one container per data directory.
- Built-in TLS termination inside the image. The image is HTTP-only on `:3000`; HTTPS is the operator's reverse proxy.
- Kubernetes manifests / Helm chart.
- Image signing (cosign / sigstore). Workflow leaves `id-token: write` permission in place so it can be added later, but no signing is wired up in v1.
- A bundled Caddy/Traefik service. Reverse proxies are documented as snippets in the README, not shipped as compose profiles — shipping implies we test them.
- Windows-host builds. The image targets `linux/amd64` and `linux/arm64`; Windows users run via Docker Desktop's Linux VM.

## Distribution model

Two parallel paths, both supported:

1. **Pull the published image** (default). `docker-compose.yml` references `ghcr.io/daelso/scriptr:latest`. CI builds and pushes on tag and on `main`.
2. **Build from source.** `docker-compose.yml` ships with a commented `build: .` line; uncommenting it (and commenting `image:`) makes `docker compose up --build` work from a clone. Useful for users who want to verify the image bytes against the source.

Tags published:

- `:latest` — most recent `vX.Y.Z` tag.
- `:vX.Y.Z`, `:vX.Y`, `:vX` — semver from git tags.
- `:edge` — most recent push to `main`.
- `:sha-<short>` — every push, for pinning.

## Image architecture

### Base image

Both build and runtime stages use `node:22-slim` (Debian-based, glibc). Node 22 is current active LTS through April 2027; Node 20 enters maintenance the same month this work ships, so we start on the longer-supported line.

- `sharp@0.34` and its `@img/sharp-*` prebuilts work on the well-trodden glibc path; no `libvips-dev` or `python3` toolchain needed. The Windows-only `outputFileTracingIncludes` glob in `next.config.ts` is a no-op on Linux — `sharp` ships libvips for `linux/amd64` and `linux/arm64-glibc` via the separate `@img/sharp-libvips-*` packages, which Next's NFT pass walks normally.
- A real shell is available for `docker exec -it scriptr bash` debugging, which the operator will eventually need.
- Final image lands around ~180 MB. Alpine (~90 MB) and distroless (~120 MB) were rejected: the size win doesn't pay for the support risk on `sharp` (Alpine) or the loss of debug ergonomics (distroless), and our threat model — single-user, single allowlisted egress — doesn't benefit much from a smaller attack surface in the runtime.

### Stage layout

Three stages in one Dockerfile:

**Stage 1 — `deps`**
- `WORKDIR /app`, copy `package.json` + `package-lock.json`, run `npm ci` (full install — devDeps are needed for `next build`).
- Cached on lockfile only; rebuilds only when dependencies change.

**Stage 2 — `builder`**
- Copy `node_modules` from `deps`, copy source.
- `ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1`.
- `npm run build` → produces `.next/standalone/`, `.next/static/`, and `public/`.

**Stage 3 — `runner`** (the only stage in the final image)
- `FROM node:22-slim`
- `WORKDIR /app`
- `ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 SCRIPTR_DATA_DIR=/data`
- `RUN mkdir -p /data && chown -R node:node /data /app`
- Copy `.next/standalone/` → `/app`, `.next/static/` → `/app/.next/static`, `public/` → `/app/public`. Set ownership to `node:node` on the way in.
- `USER node` (UID 1000)
- `EXPOSE 3000`
- `CMD ["node", "server.js"]`

### Standalone output layout inside the image

`next.config.ts` pins `outputFileTracingRoot` to the project directory specifically so the standalone output lands flat at `.next/standalone/server.js` (not nested under a parent-lockfile path). Inside the `builder` stage, source is copied to `/app` with no parent lockfile present, so the output reliably lands at `/app/.next/standalone/server.js`. The `runner` stage's copy commands and `CMD ["node", "server.js"]` rely on this flatness.

### Why `HOSTNAME=0.0.0.0` is correct here

`HOSTNAME=0.0.0.0` binds the Next.js standalone server to all interfaces *inside the container's network namespace*. The container's interfaces are isolated; what reaches the host depends entirely on the `ports:` mapping in compose. Defaulting that mapping to `127.0.0.1:3000:3000` is what keeps the app off the LAN — not the in-container bind address.

Footgun acknowledgement: setting `HOSTNAME=0.0.0.0` shadows the conventional shell `HOSTNAME` variable that some base images populate with the container ID. Harmless for Next.js (it's the documented standalone bind variable) but can confuse a future operator running shell commands inside the container.

### Bind-mount UID handling

The container runs as `node` (UID 1000). If the host user owns `./data` as some other UID, writes will fail with `EACCES`. Two documented workarounds, no custom entrypoint:

1. `sudo chown -R 1000:1000 ./data` once.
2. Add `user: "${UID}:${GID}"` (or fixed numerics) to the compose service.

We deliberately do not ship an entrypoint that `chown`s `/data` at startup, because that pattern silently corrupts ownership when an operator bind-mounts something they didn't mean to.

## File inventory

New files added in this work:

- **`Dockerfile`** — three-stage build described above.
- **`.dockerignore`** — excludes `.next/`, `node_modules/`, `data/`, `.worktrees/`, `dist/`, `out/`, `coverage/`, `tests/`, `playwright-report/`, `.git/`, `electron/`, `.env`, `.env.local`, `.env.*.local`, `.codex/`, OS junk (`.DS_Store`, etc.). Note the `.env` patterns are explicit so `.env.example` is *not* excluded — it's part of the source tree even though we never `COPY` it into the image (users fetch it via `curl` per the README). Goal: keep the build context lean and ensure no host `data/` or real secrets are ever baked into a layer.
- **`docker-compose.yml`** — single `scriptr` service.
- **`.env.example`** — `XAI_API_KEY=` (the **only required** field; everything else is commented optional), `SCRIPTR_DEFAULT_MODEL=grok-4-latest` (commented). The file's leading comment says exactly that ("only `XAI_API_KEY` is required") so users don't waste time poking at the rest. `SCRIPTR_DATA_DIR` is intentionally not user-tunable in this setup; it's pinned to `/data` inside the container, and the host path is configured via the compose volume.
- **`app/api/health/route.ts`** — `GET /api/health` returning `{ ok: true }` with no auth, no data access. Needed for the compose healthcheck and as a probe target for reverse proxies. The egress test exercises every non-generate route; this route gets added to that loop so we observe it makes no outbound calls.
- **`.github/workflows/docker.yml`** — multi-arch GHCR publish.
- **`.github/dependabot.yml`** (new, or extended if it exists) — `github-actions` ecosystem entry so the SHA-pinned actions in the docker workflow get update PRs.
- **`README.md` additions** — new "Docker (browser hosting)" section before the Privacy section.

## docker-compose.yml

```yaml
services:
  scriptr:
    image: ghcr.io/daelso/scriptr:latest
    # build: .            # uncomment (and comment image:) to build from source
    container_name: scriptr
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"   # 0.0.0.0:3000:3000 for LAN; reverse proxy + auth for internet
    env_file:
      - .env
    volumes:
      - ./data:/data
    healthcheck:
      test:
        - "CMD"
        - "node"
        - "-e"
        - "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

Deliberate choices:

- **Healthcheck via `node -e fetch(...)`.** `node:22-slim` ships neither `curl` nor `wget`; Node 22's global `fetch` already has what we need. The `fetch` target is the **container's** loopback (`127.0.0.1` inside the network namespace), not the host's, so the healthcheck works the same whether the host port mapping is `127.0.0.1:3000:3000` or `0.0.0.0:3000:3000`.
- **`restart: unless-stopped`** rather than `always` — respects an explicit `docker compose down`.
- **`container_name: scriptr`** for predictable `docker logs` / `docker exec` ergonomics. Forfeits replica scaling, which we don't want anyway (file-based storage).
- **No `networks:`** block — single service, default bridge is enough.

## CI workflow (`.github/workflows/docker.yml`)

Triggers:

- `push` to `main` → `:edge` and `:sha-<short>`.
- `push` of tags matching `v*` → `:latest`, `:vX.Y.Z`, `:vX.Y`, `:vX`, `:sha-<short>`.
- `workflow_dispatch` for manual rebuilds.

Permissions: `contents: read`, `packages: write`, `id-token: write` (the last is unused in v1 but cheap to leave for future cosign signing).

Steps (each action pinned to a full commit SHA, not a major-version tag — supply-chain hardening that fits the privacy posture; Dependabot keeps them current):

1. `actions/checkout` (pin SHA matching the latest v4 release at implementation time)
2. `docker/setup-qemu-action` (pin SHA matching latest v3) — required for arm64 emulation on amd64 runners.
3. `docker/setup-buildx-action` (pin SHA matching latest v3)
4. `docker/login-action` (pin SHA matching latest v3) against `ghcr.io` with `${{ github.actor }}` + `${{ secrets.GITHUB_TOKEN }}`.
5. `docker/metadata-action` (pin SHA matching latest v5) to compute tags and OCI labels:
   - `type=ref,event=branch` (with main → `edge`)
   - `type=semver,pattern={{version}}`, `{{major}}.{{minor}}`, `{{major}}`
   - `type=sha,prefix=sha-`
6. `docker/build-push-action` (pin SHA matching latest v6):
   - `platforms: linux/amd64,linux/arm64`
   - `push: true`
   - `tags: ${{ steps.meta.outputs.tags }}`
   - `labels: ${{ steps.meta.outputs.labels }}` plus explicit:
     - `org.opencontainers.image.title=Scriptr`
     - `org.opencontainers.image.description=Local-first AI writing app`
     - `org.opencontainers.image.licenses=MIT`
   - `cache-from: type=gha`, `cache-to: type=gha,mode=max`
   - `provenance: true` and `sbom: true` — generates SLSA provenance attestations and an SPDX SBOM and pushes them to GHCR alongside the image. Free, no extra steps, and rounds out the supply-chain story to match the SHA-pinned actions.

Each pinned action carries an inline comment with the human-readable version (e.g. `# v4.2.2`) so a reviewer can read intent without resolving SHAs. A `.github/dependabot.yml` entry for `package-ecosystem: github-actions` is added so SHA bumps arrive as PRs rather than rotting silently.

No tests run inside this workflow. Lint, typecheck, unit, and e2e already run on the existing CI for every PR and tag; re-running them inside the Docker build doubles wall time without new signal. The build either succeeds or fails as its own check.

## Healthcheck endpoint (`app/api/health/route.ts`)

Minimal handler:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
```

Rationale:

- The handler imports nothing from `lib/storage/*`, `lib/grok*`, or `lib/recap`, so it can't accidentally pull in disk or network code paths. Keeping the import surface trivial is the actual safety, not the `dynamic` directive.
- `force-dynamic` is the conservative choice for a liveness probe — we want a fresh response per request, not a build-time-cached static asset.
- Returns 200 as long as the Next.js server is up; we explicitly do not check downstream xAI reachability, because a missing/invalid API key is an operator concern, not a "container is unhealthy" concern.

The egress test (`tests/privacy/no-external-egress.test.ts`) gets a new entry exercising this route — same shape as existing route cases (e.g., `/api/settings`), no allowlist exemption needed.

## README additions

A new "Docker (browser hosting)" section, placed before the Privacy section so the no-auth warning lands above the fold relative to the privacy story.

Outline:

1. **One-paragraph framing.** Same app as desktop/web, containerized for headless hosting; not a multi-user SaaS deployment.
2. **Quick start.**
   ```bash
   curl -O https://raw.githubusercontent.com/Daelso/scriptr/main/docker-compose.yml
   curl -o .env https://raw.githubusercontent.com/Daelso/scriptr/main/.env.example  # fill in XAI_API_KEY
   docker compose up -d
   ```
   Open `http://127.0.0.1:3000`. Permissions footnote: `sudo chown -R 1000:1000 ./data` once if you see write errors, or add `user: "${UID}:${GID}"` to the service.
3. **No-auth warning** — callout block, not a footnote. Spells out exactly what an unauthed exposed instance lets a stranger do (read every story, generate new ones, drain xAI credits).
4. **LAN access** — change `127.0.0.1:3000:3000` to `0.0.0.0:3000:3000`; reminder that LAN means "every device on your wifi, including guests."
5. **Internet exposure with Caddy** — copy-pasteable `Caddyfile` snippet covering HTTPS (Let's Encrypt) + HTTP basic auth. Explicitly framed as a starting point.
6. **Build from source** — uncomment `build:`, comment `image:`, `docker compose up --build`.
7. **Updating** — `docker compose pull && docker compose up -d`. Note `:latest` follows tags, `:edge` follows main.
8. **Backups** — stop container or snapshot, then `tar` `./data/`. Reuse existing desktop-app backup wording.
9. **Troubleshooting** — three entries: bind-mount permission errors, port-already-in-use, restart loop (point at `docker logs scriptr`; most likely cause is missing `XAI_API_KEY`).

Out of scope for the README:

- Reverse-proxy configs for Traefik, nginx, HAProxy.
- A "production checklist."
- Kubernetes / Helm.

## Privacy posture

Nothing in this work changes the egress profile of the running app. Specifically:

- No new third-party hosts. CSP `connect-src` stays `'self' https://api.x.ai`.
- No telemetry packages added. The `scriptr/no-telemetry` ESLint rule continues to apply.
- `NEXT_TELEMETRY_DISABLED=1` is set at both build time and runtime so Next.js doesn't phone home during `next build` in the image, nor at runtime.
- The new `/api/health` route makes no outbound calls and does not read user data; it gets an explicit case in the egress test.
- The published image's GHCR pull URL is the only new network destination introduced, and it's an opt-in operator action, not an in-app egress.

## Testing

- Existing unit/e2e suites are unchanged.
- `tests/privacy/no-external-egress.test.ts` gains a case for `/api/health` to enforce it remains pure.
- The Docker build is exercised by the CI workflow itself — a failing `npm ci` or `next build` fails the workflow.
- Manual smoke before tagging a release:
  1. `docker compose up -d` on a clean checkout with a real `.env`.
  2. Visit `http://127.0.0.1:3000`, create a story, generate one chapter, confirm `data/stories/...` appears on the host.
  3. `docker compose down`, `docker compose up -d` again, confirm the story is still there.
  4. `curl http://127.0.0.1:3000/api/health` returns `{"ok":true}`.

## Open questions

None at design time. License confirmed as MIT.

## Risks and mitigations

- **Operator misconfiguration exposes an unauthed app.** Mitigation: 127.0.0.1 default binding, prominent README warning, Caddy starter snippet for the path forward.
- **Bind-mount UID mismatch frustrates first-time users.** Mitigation: documented under Quick Start, two simple workarounds, no fragile chown-at-startup entrypoint.
- **GHCR image gets stale relative to source.** Mitigation: `:edge` tag tracks `main`; release process tags new versions which auto-publish.
- **`sharp` prebuilt arm64 binary regresses in a future bump.** Mitigation: same CI build catches it for both architectures before publish; we already have a precedent (the Windows libvips DLL fix in v0.5.1) for handling sharp's packaging surprises.
- **Reverse-proxy `X-Forwarded-*` quirks.** Operators putting Caddy/nginx in front may discover that absolute URLs (e.g., in EPUB exports or author-note QR codes) don't round-trip the proxy's canonical host/scheme. Mitigation: out of scope for v1 since the in-app surfaces that emit absolute URLs are narrow; flag in the README troubleshooting section so operators know where to look first.
