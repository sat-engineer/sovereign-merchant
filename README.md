# Sovereign Merchant

> A plug-and-play reconciliation bridge between BTCPayServer and QuickBooks — built for sovereignty, not SaaS.

Sovereign Merchant helps self-hosted Bitcoin merchants automate bookkeeping without surrendering custody or paying third-party subscription fees. By pairing the BTCQBO plugin inside BTCPayServer with a friendly app experience, merchants can install Sovereign Merchant on Start9 or Umbrel, connect QuickBooks Online, and let the system reconcile Bitcoin payments automatically.

If you want the full product specification, check out `product-and-tech-spec.md`. The highlights below capture the pieces you need to start building and running the project locally.

---

## Why This Project Exists

- **Parity with fiat processors:** Traditional payment gateways push transactions straight to QuickBooks. Bitcoin-native merchants deserve the same automation.
- **Self-hosted sovereignty:** Everything runs on the merchant’s node (Start9 or Umbrel). No custodial intermediaries, no SaaS dependency.
- **Operational clarity:** Merchants (and their bookkeepers) get visibility into BTCPay payment status, QuickBooks sync history, and reconciliation logs in one place.

---

## What Sovereign Merchant Does

- Discovers or accepts the URL/API key for an on-node BTCPayServer instance.
- Guides the merchant through QuickBooks OAuth2 and keeps tokens fresh.
- Receives BTCPay webhooks, processes each payment through a dedicated worker, and forwards reconciliations to QuickBooks using the BTCQBO plugin.
- Supports three reconciliation modes:
  - **Deposit** (default): Treat BTCPay payments like cash deposits or sales receipts.
  - **Invoicing:** Match BTCPay payments against existing QuickBooks invoices.
  - **QBO-first:** Generate “Pay in Bitcoin” links from QuickBooks invoices, create BTCPay invoices on demand, and reconcile the results back to QuickBooks.
- Persists configuration, tokens, logs, and reconciliation outcomes in SQLite so data survives container restarts.

---

## 10,000-Foot Architecture

```
┌────────────────┐       ┌─────────────────────────────┐       ┌────────────────────┐
│ React Frontend │<----->│ API Server                  │<----->│ QuickBooks Online  │
└────────────────┘   SPA │  (Fastify)                  │       └────────────────────┘
        ▲                │  - Config + auth            │
        │                │  - Serves frontend          │
        │                │  - Handles OAuth callbacks  │
        │                │  - Receives BTCPay webhooks │
        │                └────────┬───────────────┬────┘
        │                         │ shared WAL DB │
        │                ┌────────▼───────────────┴┐
        │                │ SQLite (/data/config.db)│
        │                │ - Secrets (encrypted)   │
        │                │ - Logs & metrics        │
        │                │ - Queue for worker      │
        │                └────────┬────────────────┘
        │                         │
        │                ┌────────▼────────────────┐       ┌────────────────┐
        └────────────────│ Sync Worker Service     │<----->│ BTCPayServer   │
                         │ - Processes queue       │  API  │ (BTCQBO plugin)│
                         │ - Calls BTCQBO endpoints│       └────────────────┘
                         │ - Handles retries       │
                         └─────────────────────────┘
```

Both the API server and the worker run in the same container image, sharing a `/data` volume for SQLite. The worker performs all heavy reconciliation logic so webhook responses stay fast and idempotent.

---

## Repository Layout

```
sovereign-merchant/
├── core/                  # Node.js backend (API + worker)
│   └── src/
│       ├── api/           # REST endpoints
│       ├── jobs/          # Schedulers and reconciliation logic
│       ├── services/      # BTCPay + QuickBooks clients
│       ├── models/        # SQLite schema + migrations
│       ├── routes/        # Public routes (e.g., /pay for QBO-first)
│       └── utils/         # Logging, crypto helpers, rate limiting
├── web/                   # React + Vite frontend
│   └── src/
│       ├── components/    # Reusable UI components
│       ├── pages/         # Views (setup steps, dashboard)
│       └── api/           # Shared TypeScript types generated from backend
├── apps/
│   ├── start9/            # Start9 packaging (manifest, instructions, icon)
│   └── umbrel/            # Umbrel packaging (app manifest, docker-compose, assets)
├── Dockerfile             # Multi-stage build for single container image
├── product-and-tech-spec.md
├── feedback.md
└── LICENSE
```

---

## Umbrel Packaging (Hello World Stub)

The Umbrel scaffolding in `apps/umbrel/` is intentionally minimal so we can reserve the app ID and
validate dependency wiring before dropping in the real Node/TypeScript services. The placeholder
Docker Compose file starts an `nginx` container that simply serves `apps/umbrel/html/index.html`
with a `hello world` page, while `umbrel-app.yml` declares BTCPayServer as a dependency to mirror
the eventual production requirements. Swap the container image and mount points once the real app
is ready.

### Syncing to an Umbrel Node

Publish the docker image

```
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag satengineer/sovereign-merchant:v0.0.1 \
  --push \
  .
```

Run this to get the sha of the docker image

```
docker buildx imagetools inspect satengineer/sovereign-merchant:v0.0.1 --format '{{json .Manifest.Digest}}' | tr -d '"'
```

Paste the corresponding sha into your local umbrel-apps fork: umbrel-apps/sovereign-merchant/docker-compose.yml in the web/image section

```
web:
    image: satengineer/sovereign-merchant:v0.0.1@sha256:3220b3ff0b52539f5c62615d55199b321cac58d4414ac3aaa76a6a25473e15cb
```

Commit and push.

On your umbrel, cd into the following directory

```
cd /home/umbrel/umbrel/app-stores/getumbrel-umbrel-apps-github-53f74447
```

set the remote to the custom fork

```
git remote set-url origin https://github.com/sat-engineer/umbrel-apps.git
```

then

```
git pull
```

Once running, run

```
sudo docker logs sovereign-merchant_web_1
```

to grab logs.

Use `scripts/package-umbrel-app.sh` to mirror the `apps/umbrel/` directory onto an Umbrel
app-store path via `rsync` (matches the Umbrel docs workflow). The script defaults to
`umbrel@192.168.1.168` for now:

```bash
./scripts/package-umbrel-app.sh
# Defaults to umbrel@192.168.1.168 and the standard app-store path
```

Pass explicit host/path args or set `UMBREL_HOST`/`UMBREL_REMOTE_PATH` if your setup differs. Include
`--dry-run` to preview changes. After syncing, install/refresh the app from the Umbrel UI, or use the command line:

```bash
# Install the app
umbreld client apps.install.mutate --appId sovereign-merchant

# Restart the app (after making changes)
umbreld client apps.restart.mutate --appId sovereign-merchant

# Uninstall the app
umbreld client apps.uninstall.mutate --appId sovereign-merchant
```

For umbrel-dev, use:

```bash
npm run dev client -- apps.install.mutate -- --appId sovereign-merchant
```

#### macOS LAN Troubleshooting

If `ping 192.168.1.168` (or your Umbrel's IP) returns `No route to host` even though both devices are
on `192.168.1.x`, macOS may have cached a bogus host route (common after using VPN/tunnel adapters).
Flush the host/ARP entries and add an explicit route:

```bash
sudo route delete umbrel 2>/dev/null
sudo route -n delete 192.168.1.168 2>/dev/null
sudo arp -d 192.168.1.168
dscacheutil -flushcache
sudo route -n add -host 192.168.1.168 192.168.1.1
```

Replace the IPs above if your Umbrel or gateway differ. After the static route is added, `ping` and
`ssh umbrel@192.168.1.168` should succeed, and the sync script will work again.

#### Restoring the App Store (When rsync Goes Wrong)

If you accidentally clobber your Umbrel app store during development, restore it like this:

```bash
# SSH into your Umbrel
ssh umbrel@192.168.1.168

# Navigate to app-stores and restore
cd ~/umbrel/app-stores
rm -rf getumbrel-umbrel-apps-github-53f74447  # Careful—this wipes your custom app too
git clone https://github.com/getumbrel/umbrel-apps.git getumbrel-umbrel-apps-github-53f74447

# Exit SSH and try your sync again
exit
```

---

## Tech Stack

- **Backend:** Node.js (TypeScript), Fastify, pnpm.
- **Worker:** Node.js (shared codebase) with cron-style scheduler and retry queue.
- **Frontend:** React + Vite + TypeScript.
- **Database:** SQLite (WAL mode) with encrypted columns for secrets.
- **Deployment Targets:** Docker, packaged for Start9 and Umbrel app stores.
- **Integrations:** BTCPayServer Greenfield API (+ BTCQBO plugin), QuickBooks Online OAuth2.

---

## Prerequisites

Before you start, install:

- Node.js LTS (18+ recommended) and pnpm (or npm/yarn if you adapt the scripts).
- Docker (for building the production image locally).
- SQLite CLI tools (useful for debugging `/data/config.db`).
- Access to a BTCPayServer instance with BTCQBO plugin installed (for end-to-end tests).
- An Intuit Developer account with QuickBooks Online sandbox (for OAuth testing).

---

## Local Development Setup

Clone the repo and install dependencies using pnpm workspaces:

```bash
git clone https://github.com/sat-engineer/sovereign-merchant.git
cd sovereign-merchant

# Install backend deps
pnpm install --filter core...

# Install frontend deps
pnpm install --filter web...
```

### Backend (API + Worker)

```bash
cd core
cp .env.example .env   # Create one if it doesn't exist yet

pnpm dev
# Starts the API server on http://localhost:3000
```

`core/.env` values you’ll typically need locally:

```
QBO_CLIENT_ID=your-intuit-client-id
QBO_CLIENT_SECRET=your-intuit-client-secret
QBO_REDIRECT_URI=http://localhost:3000/api/config/qbo/callback
BTCPAY_BASE_URL=http://localhost:8080
ENCRYPTION_KEY=optional-32-byte-hex (for local dev only)
```

> In production the encryption key is generated automatically and stored in platform secrets or `/data/encryption.key`. For local development you can supply one via env var to avoid file handling.

### Frontend (React + Vite)

```bash
cd web
pnpm dev
# Default port: http://localhost:5173
```

The SPA talks to the backend via `/api`. When running locally, configure Vite’s proxy (see `web/vite.config.ts`) or set `VITE_API_URL=http://localhost:3000`.

---

## Building the Docker Image

To produce the same image Start9/Umbrel consume:

```bash
docker build -t sovereign-merchant:latest .
```

The multi-stage Dockerfile compiles the frontend, bundles the backend, and sets up the run image with both API and worker processes.

---

## Testing & Quality (Work in Progress)

- Unit/integration test harness will live inside `core/` and `web/` respectively (Jest/Vitest TBD).
- End-to-end scenarios will mock BTCPay/QuickBooks APIs; see `feedback.md` for open testing tasks.
- Until the automated suite is finalized, use the manual QA checklist in `product-and-tech-spec.md`.

---

## Helpful Documents

- `product-and-tech-spec.md` — detailed design, API contracts, and security posture.
- `feedback.md` — running list of review findings, TODOs, and follow-up questions.
- `apps/start9/` + `apps/umbrel/` — packaging metadata for each platform.

---

## Contributing

1. Fork and clone the repo.
2. Work against the spec; keep changes documented in `feedback.md` if open questions arise.
3. Run backend and frontend locally (see above) and, when available, execute automated tests.
4. Submit a PR, referencing any spec sections you implemented or deviated from.

### Pre-commit Hooks

This project uses automated code formatting with [Prettier](https://prettier.io/) and includes a pre-commit git hook to ensure consistent code style:

- **Automatic formatting**: All TypeScript, JavaScript, JSON, and Markdown files are automatically formatted according to our Prettier configuration
- **Pre-commit validation**: The git hook runs `npm run format:check` before each commit to verify formatting
- **Auto-fix on failure**: If formatting issues are found, the hook automatically runs `npm run format` to fix them and prevents the commit
- **Manual formatting**: You can also run `npm run format` manually to format code at any time

The pre-commit hook ensures all committed code meets our formatting standards, preventing CI failures and maintaining consistent code style across the team.

### Development Scripts

```bash
# Format all code
npm run format

# Check formatting without making changes
npm run format:check

# Run tests (core and web)
npm run test

# Run backend development server
npm run dev --filter core

# Run frontend development server
npm run dev --filter web
```

We welcome issues or PRs that clarify documentation, add tests, or improve the developer workflow.

---

## License

Copyright © 2025 Sovereign Merchant contributors.  
Released under the MIT License. See `LICENSE` for details.
