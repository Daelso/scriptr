# Docker browser-hosting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-class Docker setup for self-hosting scriptr's browser variant — Dockerfile, compose file, multi-arch GHCR publish workflow, a `/api/health` endpoint, and README docs that make `docker compose up -d` actually easy.

**Architecture:** Three-stage Dockerfile on `node:22-slim` producing a Next.js standalone image. Compose binds host port to `127.0.0.1:3000` by default (no auth), bind-mounts `./data` → `/data`, reads `XAI_API_KEY` from `.env`. GitHub Actions builds multi-arch (`linux/amd64`, `linux/arm64`), pushes to GHCR with SLSA provenance and SPDX SBOM, with all actions pinned to commit SHAs and Dependabot keeping them current. New `/api/health` route is the only application-code change.

**Tech Stack:** Docker + Buildx, docker-compose, Next.js 16 standalone output, `node:22-slim`, GitHub Actions (`docker/build-push-action@v6`), GHCR.

**Spec:** [docs/superpowers/specs/2026-04-28-docker-browser-hosting-design.md](../specs/2026-04-28-docker-browser-hosting-design.md)

**Branch:** All work continues on `feat/docker-hosting` (already cut from `main`, currently has only the spec commits).

**Working directory note:** All commands assume cwd is the scriptr repo root (`/home/chase/projects/scriptr` for the original author; whatever the worktree path is for execution). Subagents dispatched from a worktree must receive the absolute worktree path per [AGENTS.md](../../../AGENTS.md).

---

## File Structure

New files:

| Path | Responsibility |
|---|---|
| `app/api/health/route.ts` | Trivial liveness endpoint returning `{ ok: true }`. Imports nothing from `lib/storage/*`, `lib/grok*`, or `lib/recap`. |
| `Dockerfile` | Multi-stage build (`deps` → `builder` → `runner`) producing a `node:22-slim` image of the Next.js standalone server. |
| `.dockerignore` | Keeps build context lean, excludes secrets and `data/`. |
| `docker-compose.yml` | Single-service compose pointing at the published image, with bind-mounted `./data` and `127.0.0.1:3000` default binding. |
| `.env.example` | Documents the env vars users need to fill in (only `XAI_API_KEY` is required). |
| `.github/workflows/docker.yml` | Multi-arch publish to GHCR on `main` push, tag push, and manual dispatch. SHA-pinned actions. |
| `.github/dependabot.yml` | New file. Keeps the SHA-pinned actions current via PRs. |

Modified files:

| Path | What changes |
|---|---|
| `tests/privacy/no-external-egress.test.ts` | Add a new `// ── GET /api/health ──` block that imports the route and exercises it. Update the docstring's "EXEMPTED ROUTES" / "ROUTES EXERCISED" comment block to mention the new route. |
| `README.md` | New "Docker (browser hosting)" section before the existing Privacy section. |

---

## Chunk 1: Implementation

### Task 1: Health route + egress test (TDD)

**Why first:** The compose healthcheck depends on this endpoint, and it's the only application-code change. Doing it under TDD up front means the rest of the work (Dockerfile, compose) can rely on it without ambiguity.

**Files:**
- Create: `app/api/health/route.ts`
- Create: `tests/api/health.test.ts`
- Modify: `tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Write the failing unit test for the health route**

Create `tests/api/health.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns { ok: true } with status 200", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("does not import any storage or generation helpers", async () => {
    // The whole point of the import-surface invariant: this route's module
    // graph must stay trivial so it can never accidentally trip a code path
    // that touches disk or network. We verify by reading the source — a
    // tighter check than a runtime mock — and asserting no forbidden imports.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../app/api/health/route.ts", import.meta.url),
      "utf8",
    );
    const forbidden = [
      "@/lib/storage",
      "@/lib/grok",
      "@/lib/recap",
      "@/lib/config",
      "@/lib/prompts",
    ];
    for (const f of forbidden) {
      expect(src).not.toContain(f);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/api/health.test.ts`
Expected: FAIL with `Cannot find module '@/app/api/health/route'` (or equivalent).

- [ ] **Step 3: Implement the route**

Create `app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/api/health.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Add the route to the egress test**

Open `tests/privacy/no-external-egress.test.ts`. Two edits:

**a.** In the docstring, find the `─── ROUTES EXERCISED ───` block and add `GET /api/health` near the top of the list (before `GET /api/settings`), so the docstring stays an accurate index.

**b.** In the test body, find the `// ── GET /api/settings ──` block. Just *before* it, add:

```ts
    // ── GET /api/health ─────────────────────────────────────────────────────
    {
      const { GET } = await import("@/app/api/health/route");
      const res = GET();
      expect(res.status).toBe(200);
    }
```

(Note: `GET` here is synchronous — no `await`. It returns a Response directly.)

- [ ] **Step 6: Run the egress test and confirm it still passes**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: All tests pass, including `exercising every non-generate route records zero fetches`.

- [ ] **Step 7: Run lint, typecheck, and full test suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/health/route.ts tests/api/health.test.ts tests/privacy/no-external-egress.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add /api/health liveness endpoint for Docker healthcheck

Trivial { ok: true } handler that imports nothing from storage, grok,
or config — the actual privacy guarantee is the import surface, not the
dynamic directive. Added to the egress test loop to confirm it makes no
outbound calls.

EOF
)"
```

---

### Task 2: Dockerfile + .dockerignore

**Why second:** Once the health route exists, the runtime image has something to healthcheck against. The Dockerfile is independently buildable — verify it builds before wiring compose.

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

Create `.dockerignore` at the repo root:

```
# Build artifacts and caches
.next
node_modules
dist
out
coverage
playwright-report

# Local data — must never land in an image layer
data
.worktrees

# Environments — .env.example deliberately NOT excluded so it stays in
# the source tree (users curl it per the README); real secrets stay out.
.env
.env.local
.env.*.local

# Editor / agent metadata
.codex
.claude
.vscode
.idea

# Source we don't need at runtime
tests
e2e
docs
.git
.github
electron

# OS junk
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Create the Dockerfile**

Create `Dockerfile` at the repo root:

```dockerfile
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
```

- [ ] **Step 3: Build the image locally and verify it produces a runnable server**

Run:

```bash
docker build -t scriptr:plan-test .
```

Expected: build succeeds. The final image is ~150–200 MB (`docker images scriptr:plan-test` to confirm).

Smoke-test the image:

```bash
docker run --rm -d --name scriptr-smoke -p 127.0.0.1:13000:3000 -e XAI_API_KEY=dummy scriptr:plan-test
sleep 4
curl -sf http://127.0.0.1:13000/api/health
docker rm -f scriptr-smoke
```

Expected: `curl` prints `{"ok":true}` and exits 0.

If the smoke test fails, common causes:
- `server.js` not at `/app/server.js` → check `outputFileTracingRoot` in `next.config.ts` is still pinned to `projectRoot`.
- `EACCES` writing somewhere → check the `chown -R node:node /data /app` line ran *before* the `USER node` switch.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "$(cat <<'EOF'
feat(docker): multi-stage Dockerfile and dockerignore for browser hosting

Three-stage build (deps → builder → runner) on node:22-slim producing
a ~180 MB image of the Next.js standalone server. Runs as the node
user (UID 1000) with /data pre-created for bind mounts and PORT/HOSTNAME
configured for Next standalone. .dockerignore enumerates .env patterns
explicitly so .env.example stays in the source tree.

EOF
)"
```

---

### Task 3: docker-compose.yml + .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

Create `.env.example` at the repo root:

```bash
# Scriptr — Docker environment configuration.
#
# Copy this file to .env and fill in XAI_API_KEY. That is the ONLY
# required field; everything else is optional.

# Required: your xAI (Grok) API key. Without this, generation routes
# will return 500. Get one at https://console.x.ai/.
XAI_API_KEY=

# Optional: override the default model id passed to the xAI API.
# SCRIPTR_DEFAULT_MODEL=grok-4-latest
```

- [ ] **Step 2: Create `docker-compose.yml`**

Create `docker-compose.yml` at the repo root:

```yaml
# Scriptr — single-user, local-first browser hosting.
#
# THERE IS NO AUTHENTICATION. The default ports binding (127.0.0.1:3000)
# limits exposure to the host machine. Change to 0.0.0.0:3000:3000 only
# if you trust everything on your LAN, and put a reverse proxy with auth
# in front before exposing to the internet. See README → Docker section.

services:
  scriptr:
    image: ghcr.io/daelso/scriptr:latest
    # build: .            # uncomment (and comment image:) to build from source
    container_name: scriptr
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
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

- [ ] **Step 3: Verify compose works end-to-end**

The `image:` line points at GHCR; until the workflow runs we can't pull from there. Test the build path instead:

```bash
# Comment out image: and uncomment build: temporarily for this test.
# Or: use the override syntax below without editing the file.
docker compose -f docker-compose.yml -f - up -d --build <<'EOF'
services:
  scriptr:
    image: scriptr:compose-test
    build: .
EOF

cp .env.example .env
echo "XAI_API_KEY=dummy" >> .env

sleep 6
curl -sf http://127.0.0.1:3000/api/health
docker compose down
rm .env
```

Expected: `curl` prints `{"ok":true}`. `docker compose ps` shows the container as `healthy` after the start_period.

If the bind mount triggers permission errors on a host where the current user is not UID 1000, the README documents the workaround (`sudo chown -R 1000:1000 ./data` once, or add `user: "${UID}:${GID}"` to the service). For this verification step on a fresh checkout where `./data` doesn't exist, Docker creates it as root — that's fine for the smoke; production users follow the README.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "$(cat <<'EOF'
feat(docker): compose file and .env.example for one-command bring-up

Single-service compose with 127.0.0.1:3000 default binding (no auth in
the app — operator's responsibility), bind-mounted ./data, healthcheck
against /api/health using node -e fetch (slim image has no curl/wget),
and restart: unless-stopped. .env.example documents XAI_API_KEY as the
only required field.

EOF
)"
```

---

### Task 4: GitHub Actions workflow + Dependabot

**Files:**
- Create: `.github/workflows/docker.yml`
- Create: `.github/dependabot.yml`

**Pinning approach:** Each action gets a full commit SHA from the latest stable release at the time of implementation. Inline `# vX.Y.Z` comment carries human-readable intent. Resolve SHAs via `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` or by visiting the tag on GitHub.

- [ ] **Step 1: Resolve current SHAs for each action**

Run (replacing tags with the latest at implementation time):

```bash
for spec in \
  "actions/checkout v4" \
  "docker/setup-qemu-action v3" \
  "docker/setup-buildx-action v3" \
  "docker/login-action v3" \
  "docker/metadata-action v5" \
  "docker/build-push-action v6"
do
  set -- $spec
  echo "$1@$(gh api repos/$1/git/ref/tags/$2 --jq .object.sha) # $2"
done
```

Record the output — those exact `<owner>/<action>@<sha>` strings go into the workflow file below in place of the `<SHA>` placeholders.

- [ ] **Step 2: Create the workflow file**

Create `.github/workflows/docker.yml`:

```yaml
name: Build and publish Docker image

on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch: {}

permissions:
  contents: read
  packages: write
  id-token: write   # reserved for future cosign signing; no-op today

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@<SHA>   # v4.X.Y

      - name: Set up QEMU (for arm64 emulation on amd64 runner)
        uses: docker/setup-qemu-action@<SHA>   # v3.X.Y

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@<SHA>   # v3.X.Y

      - name: Log in to GHCR
        uses: docker/login-action@<SHA>   # v3.X.Y
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute tags and labels
        id: meta
        uses: docker/metadata-action@<SHA>   # v5.X.Y
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch,enable={{is_default_branch}}
            type=raw,value=edge,enable={{is_default_branch}}
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=sha,prefix=sha-
          labels: |
            org.opencontainers.image.title=Scriptr
            org.opencontainers.image.description=Local-first AI writing app
            org.opencontainers.image.licenses=MIT

      - name: Build and push
        uses: docker/build-push-action@<SHA>   # v6.X.Y
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true
          sbom: true
```

Replace each `<SHA>` placeholder with the SHA from Step 1's output. The trailing `# vX.Y.Z` comment must reflect the actual version that SHA refers to.

- [ ] **Step 3: Create the Dependabot config**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: ci
    labels:
      - dependencies
      - github-actions
```

- [ ] **Step 4: Validate workflow syntax locally**

If `actionlint` is available:

```bash
actionlint .github/workflows/docker.yml
```

Expected: no errors.

If `actionlint` isn't installed, push to a feature branch and let GitHub validate (the workflow will fail to *run* on push to a non-default branch since the trigger is `branches: [main]`, but parse errors would surface immediately on the Actions tab).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker.yml .github/dependabot.yml
git commit -m "$(cat <<'EOF'
ci: multi-arch Docker publish workflow with SHA-pinned actions

Builds linux/amd64 + linux/arm64, pushes to GHCR on main and tag pushes,
attaches SLSA provenance and SPDX SBOM. All actions pinned to commit
SHAs with inline version comments; Dependabot github-actions ecosystem
keeps pins current via weekly PRs.

EOF
)"
```

---

### Task 5: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the insertion point**

Open `README.md`. Find the existing Privacy section (it's the load-bearing pillar — should be near the top after the intro/quick start). Insert the new "Docker (browser hosting)" section *before* it. If a "Quick start" or "Setup" section exists, the Docker section goes between Quick Start and Privacy.

- [ ] **Step 2: Add the Docker section**

Insert this content at the determined position (adjust heading level to match surrounding sections):

````markdown
## Docker (browser hosting)

Run scriptr's browser variant in a container — same Next.js app and
privacy posture as the desktop build, just headless. Suited for
home-server / NAS / VPS use; **not** a multi-user SaaS deployment.

### Quick start

```bash
curl -O https://raw.githubusercontent.com/Daelso/scriptr/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Daelso/scriptr/main/.env.example
# edit .env and set XAI_API_KEY
docker compose up -d
```

Then open <http://127.0.0.1:3000>.

If you see permission errors writing to `./data/`, either:

```bash
sudo chown -R 1000:1000 ./data
```

…or add `user: "${UID}:${GID}"` to the `scriptr:` service in
`docker-compose.yml` so the container writes as your host user.

### ⚠️ There is no authentication

Scriptr binds to `127.0.0.1` by default — only the host machine can
reach it. **If you change the port mapping to expose it to your LAN
or the internet, anyone who can reach port 3000 can read every story
in `data/`, generate new content, and burn through your xAI credits.**
Always put scriptr behind a reverse proxy with auth before exposing it.

### LAN access

Edit the `ports:` line in `docker-compose.yml`:

```yaml
ports:
  - "0.0.0.0:3000:3000"
```

Reminder: "LAN" includes every device on your wifi, including guests.

### Internet exposure with Caddy

Minimal `Caddyfile` that fronts scriptr with HTTPS (Let's Encrypt) and
HTTP basic auth:

```caddyfile
scriptr.example.com {
  basic_auth {
    you JDJhJDEwJEVCNmd...   # use `caddy hash-password` to generate
  }
  reverse_proxy 127.0.0.1:3000
}
```

This is a starting point, not the only option — Traefik, nginx, and
authelia/authentik all work the same way.

### Building from source

If you'd rather build the image locally than pull from GHCR:

```yaml
services:
  scriptr:
    # image: ghcr.io/daelso/scriptr:latest
    build: .
    # …rest of the service…
```

Then `docker compose up --build`.

### Updating

```bash
docker compose pull && docker compose up -d
```

`:latest` follows tagged releases. To track main HEAD, change
`docker-compose.yml` to use `ghcr.io/daelso/scriptr:edge`.

### Backups

Stop the container (or take a filesystem snapshot) and `tar` the
`data/` directory. That's the entire backup.

### Troubleshooting

- **Permission denied writing to `data/`** — see the chown / user note
  in Quick start. The container runs as UID 1000.
- **Port 3000 already in use** — change the host side of the port
  mapping (e.g., `"127.0.0.1:3001:3000"`).
- **Container restarts in a loop** — check `docker logs scriptr`. The
  most common cause is a missing or invalid `XAI_API_KEY` in `.env`.
- **Absolute URLs (EPUB exports, author-note QR codes) point at the
  wrong host behind a reverse proxy** — make sure your proxy is
  forwarding `X-Forwarded-Host` and `X-Forwarded-Proto` correctly. If
  it persists, file an issue.
````

- [ ] **Step 3: Lint check**

Run: `npm run lint`
Expected: pass (markdown isn't linted by ESLint; this just confirms the README addition didn't break anything else).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: add Docker (browser hosting) section to README

Quick start, prominent no-auth warning, LAN/internet exposure guidance,
Caddy snippet for HTTPS + basic auth, build-from-source path, update
and backup commands, and a troubleshooting list. Sits before the
Privacy section so the auth warning isn't buried.

EOF
)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Re-run lint, typecheck, and the full test suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green. The egress test in particular must still pass — it now exercises `/api/health`.

- [ ] **Step 2: Final smoke test of the full bring-up flow**

From a clean working tree on `feat/docker-hosting`:

```bash
cp .env.example .env
echo "XAI_API_KEY=dummy" >> .env
docker compose up -d --build
sleep 8
curl -sf http://127.0.0.1:3000/api/health
docker compose ps
docker compose down
rm .env
```

Expected:
- `curl` prints `{"ok":true}`.
- `docker compose ps` shows the service as `healthy` (not just `running`).
- `docker compose down` exits clean.

- [ ] **Step 3: Verify branch state**

Run: `git log --oneline --reverse main..HEAD`
Expected: you should see (in order, oldest first):

```
docs(specs): docker browser-hosting design
docs(specs): fold spec-reviewer fixes into docker hosting design
docs(specs): bump base image to node:22-slim and pin actions to SHAs
docs(specs): apply pass-2 review advisories to docker hosting design
feat(api): add /api/health liveness endpoint for Docker healthcheck
feat(docker): multi-stage Dockerfile and dockerignore for browser hosting
feat(docker): compose file and .env.example for one-command bring-up
ci: multi-arch Docker publish workflow with SHA-pinned actions
docs: add Docker (browser hosting) section to README
```

The four `docs(specs):` commits are already on the branch from brainstorming; the five new commits land via this plan.

- [ ] **Step 4: Open the PR**

Use the standard PR template. Body should summarize the four feature commits, link the spec, and call out:

- The image is published to GHCR via the new workflow once this lands on `main` and a tag is pushed.
- Operators are responsible for auth (no auth in scriptr itself).
- `/api/health` is a new public route added to the egress test loop.

---

## Notes for the executor

- **TDD applies cleanly only to Task 1.** Tasks 2–5 produce build artifacts (Dockerfile, compose, workflow, docs) where "verify by running it" is the right test, not a unit test. Don't try to invent fake tests for those.
- **Don't refactor adjacent code.** The `outputFileTracingRoot` setup, the `outputFileTracingIncludes` Windows DLL glob, the `next.config.ts` CSP — none of those need changes. Resist the temptation.
- **Never bake `data/` into the image.** The `.dockerignore` excludes it; double-check `docker build` output for any line mentioning `data/` going into the build context.
- **GHCR image name.** `ghcr.io/daelso/scriptr` is hardcoded in `docker-compose.yml` per the spec. If the repository is forked or transferred, that path needs updating in the compose file and README.
- **Don't add health-route exemption to the egress test.** The route is *exercised*, not exempted. The spec is explicit on this.
- **The `.codex/` and `.claude/` excludes in `.dockerignore`** are belt-and-suspenders — `data/` is the only host directory we know contains user content, but agent-tool metadata directories (created by various harnesses) shouldn't end up in image layers either.
- **If `next build` does something surprising inside the Dockerfile** — webpack chunks landing in unexpected places, the standalone output not at the documented path, etc. — consult `node_modules/next/dist/docs/` per [AGENTS.md](../../../AGENTS.md). This is Next.js 16 (canary feature surface as of writing); your training data may not match.
