## Sovereign Merchant

### Product & Technical Specification (v0.3)

---

## 1. Product Overview

**Goal:**  Empower merchants using BTCPayServer on Start9 or Umbrel to automatically reconcile Bitcoin payments with QuickBooks Online through Sovereign Merchant’s native Node/TypeScript connector. The experience should require no command-line usage and feel as simple as a native App Store install while mirroring the battle-tested BTCQBO behavior without depending on the plugin at runtime.

**Tagline:**

> A plug-and-play reconciliation bridge between BTCPay and QuickBooks — built for sovereignty, not SaaS.

**Core Value:**
Merchants running self-hosted Bitcoin payment servers should have the same bookkeeping automation as fiat payment processors. Sovereign Merchant delivers that with full control, zero third-party custody, and no monthly fees beyond Bitcoin network costs.

**Legacy Reference:**  
BTCQBO remains the behavioral reference for how reconciliation should behave, but Sovereign Merchant re-implements that logic entirely inside our Node/TypeScript stack. No BTCPay plugin is called at runtime; all QuickBooks writes happen through our own provider layer.

---

## 2. Product Goals

### 2.1 Primary Goals

1. **Simple install** – one-click app install via Start9 or Umbrel, no terminal commands.
2. **Auto-discovery of BTCPayServer** – detect BTCPay on same node; fallback to manual input.
3. **QuickBooks integration** – full OAuth2 connection and auto-token refresh.
4. **Auto-reconciliation** – sync invoices/payments from BTCPay to QuickBooks using the native AccountingProvider (QuickBooksOnlineProvider) that mirrors BTCQBO semantics.
5. **Clear status UI** – always show connection health and recent syncs.
6. **BYO Intuit app onboarding** – guide merchants through creating/using their own Intuit developer app (Client ID/Secret) with idiot-proof docs and screenshots baked into the UI.

### 2.2 Non-goals (v1)

* No Lightning support (on-chain only for simplicity).
* No multi-company QuickBooks linking.
* No terminal or advanced configuration (expert settings can come later).

### 2.3 Roadmap

* **v1 – BTCPay-first Reconciliation (MVP):** Listen for BTCPay settlements and mark them as paid in QuickBooks. Scope is intentionally narrow so we can obsess over reliability, verbose logs, and smooth Umbrel UX.
* **v2 – JIT “Pay in Bitcoin” Links (QBO-first Bridge):** Generate signed links that create BTCPay invoices on click to let QuickBooks invoices be paid in bitcoin. JIT behavior arrives in v2 only; nothing beyond reconciliation ships in v1.

---

## 3. Product Experience

### 3.1 Install Flow

1. User installs from the platform app store.
2. App starts with a welcome screen. Backend auto-generates API key on first startup.
3. Frontend fetches initial API key from `/api/config/api-key/initial` (one-time). The endpoint only responds while app state = `INIT`, is reachable solely through the platform’s authenticated proxy (Umbrel dashboard/Start9 admin), and expires after the first retrieval or ~10 minutes. If the key is lost, operators can run the documented local CLI reset to rotate a fresh key.
4. Detect or request BTCPay URL + API key.
5. Click **"Connect QuickBooks"** → OAuth2 popup → confirmation.
6. Choose reconciliation mode:
   * **Deposit** (default) - BTCPay-first: payments auto-create deposits in QBO.
   * **Invoicing** - BTCPay-first: payments match existing QBO invoices.
7. Confirmation screen shows sync summary and logs. Anything beyond BTCPay-first reconciliation is deferred to v2 (see Section 2.3).

### 3.2 Example UI Copy

* **Header:** *Sovereign Merchant*
* **Subtitle:** Auto-reconcile BTCPay payments to QuickBooks.
* **Setup steps:**

  1. Detect BTCPay → Confirm or enter manually.
  2. Connect QuickBooks → Launch OAuth flow.
  3. Choose Mode → Deposit (default) / Invoicing.
* **Footer:** (none; reconciliation happens natively inside Sovereign Merchant).

---

## 4. Technical Architecture

### 4.1 Core Stack

**Language / Runtime:** Node.js (TypeScript)

**Rationale:**

* Easier to integrate with QuickBooks’ OAuth2 API and BTCPayServer’s REST API.
* Simple to debug and extend for BTCNYC community contributors.
* Umbrel ecosystem is already JS-heavy.
* Node’s async nature fits perfectly for periodic syncs and small HTTP services.

**Frontend:** React + Vite (served as static files from Node server)
**Database:** SQLite (persistent local config + logs)
**Container:** Docker (single image, built multi-stage)

### 4.2 Service Components

**Architecture:** API Server and Sync Worker run as separate processes/services, sharing the same SQLite database via `/data` volume.

1. **API Server (Fastify)**

   * **Purpose:** Handles all HTTP requests (API endpoints, frontend, webhooks).
   * **Responsibilities:**
     - Serves REST API endpoints (`/api/config`, `/api/status`, `/api/sync/now`)
     - Hosts compiled frontend under `/` (static files)
     - Handles QuickBooks OAuth2 and token management
     - Receives BTCPay webhooks at `/webhooks/btcpay` and enqueues them for worker processing
     - Provides health checks (`/healthz`)
   * **Port:** Exposes single HTTP port (e.g., 3000)
   * **Resilience:** If worker crashes, API continues serving requests (just can't process sync jobs)

2. **Sync Worker Service**

   * **Purpose:** Processes reconciliation jobs independently from API server.
   * **Responsibilities:**
     - Consumes webhook events from queue (written by API server)
     - Processes payment reconciliation logic (fetches BTCPay data, calls the AccountingProvider implementation)
     - Handles fallback periodic sync for missed webhooks (optional, configurable)
     - Logs reconciliation status, errors, and metrics to shared database
   * **Communication:** 
     - Reads from shared SQLite database (webhook event queue table)
     - Writes reconciliation results to shared database
     - No direct HTTP endpoint (internal service)
   * **Resilience:** If API server crashes, worker continues processing queue (webhooks may be missed if API is down)

3. **Storage Layer**

   * SQLite database under `/data/config.db`.
   * Stores BTCPay URL + key (encrypted), BTCPay webhook secret + webhook ID (encrypted/plaintext respectively), QBO tokens (encrypted), reconciliation mode, API key (hashed), logs, and processed webhook event IDs (for idempotency).
   * Encryption key stored separately (see Section 6.1) in platform secrets or `/data/encryption.key`.
   * Data directory exposed as a Docker volume for persistence.
   * **Concurrency:** SQLite handles concurrent reads/writes via WAL mode (Write-Ahead Logging). API server writes events, worker reads and processes them.

4. **Health Endpoint**

   * `/healthz` endpoint for Start9/Umbrel health checks.

5. **UI Layer**

   * React SPA (Vite) with minimal design → 3 setup steps + status dashboard.
   * Talks to `/api` endpoints from the backend.

### 4.3 Accounting Provider Abstraction

* Introduce an `AccountingProvider` interface (`reconcileDeposit`, `reconcileInvoicePayment`, `health`, etc.) so BTCPay events flow through a single contract regardless of downstream accounting platform.
* `QuickBooksOnlineProvider` is the only shipped implementation in v1. It re-creates the BTCQBO behavior in pure Node/TypeScript using Intuit’s REST APIs and refreshed OAuth tokens.
* Future providers (`XeroProvider`, `OdooProvider`) can plug in by implementing the same interface and sharing the reconciliation job pipeline.
* Worker passes normalized payment payloads (amounts, currency, invoice metadata) into the provider and receives structured success/error responses for logging and retries.

---

## 5. Repository Structure

```plaintext
sovereign-merchant/
├── core/                  # Node backend (Fastify API, sync worker)
│   ├── src/
│   │   ├── api/           # API routes (config, sync, status, logs)
│   │   ├── jobs/          # Scheduler + sync logic (webhook pipeline, retries)
│   │   ├── services/      # BTCPay + AccountingProvider clients
│   │   ├── models/        # SQLite schema + migrations (config, tokens, logs, processed events)
│   │   ├── routes/        # Platform/public routes (status, health)
│   │   └── utils/         # Logger, encryption helpers, signing helpers
│   ├── package.json
│   └── tsconfig.json
│
├── web/                   # Frontend (React/Vite)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── api/           # Shared TS types with backend
│   ├── vite.config.js
│   └── package.json
│
├── apps/
│   ├── start9/            # Start9 packaging
│   │   ├── manifest.yaml
│   │   ├── instructions.md
│   │   └── icon.png
│   └── umbrel/            # Umbrel packaging
│       ├── umbrel-app.yml
│       ├── docker-compose.yml
│       └── icon.png
│
├── Dockerfile             # Multi-stage build (build → run)
├── README.md
└── LICENSE
```

### 5.1 Why This Layout

* **`core/` and `web/` separation:**  keeps backend and UI independent but shareable via a build step.
* **`apps/` folder:** distinct packaging per platform; only metadata differs.
* **Single Dockerfile:** unified image build → Start9 `.s9pk` and Umbrel `docker-compose` both point here.
* **SQLite storage:** avoids dependency bloat, portable across both ecosystems.
* **Shared TS types:** consistent data model between frontend and backend.

---

## 6. Security & Resilience

* **API authentication:** All API endpoints (except `/healthz`, `/api/config/qbo/callback`, and one-time `/api/config/api-key/initial`) require API key authentication. API key is auto-generated on first install (cryptographically random, 32-byte hex string), stored hashed (SHA-256) in database, and must be provided in `Authorization: Bearer <key>` header or `?apiKey=<key>` query parameter. Frontend stores API key in localStorage after successful authentication. Keys can be rotated via settings UI. Failed authentication attempts are rate-limited (10 attempts per IP per minute).
* **Sensitive data encryption:** BTCPay API keys and QuickBooks OAuth tokens (access + refresh) are encrypted at rest using AES-256-GCM. See Section 6.1 for encryption key management details.
* **API key bootstrap hardening:** `/api/config/api-key/initial` is exposed only while app state = `INIT`, rejects direct container requests (must include Umbrel/Start9 proxy auth headers), and invalidates after the first retrieval or ~10 minutes. Losing the key requires running the documented local CLI reset (`sovereign-merchant reset-api-key`) which rotates the key, re-enables `INIT`, and logs the event.
* **HTTPS enforced:** fallback to HTTP only if self-hosted/localnet.
* **OAuth CSRF protection:** All OAuth flows use `state` parameter validation. Server generates cryptographically random state tokens, stores them with short expiry (10 minutes), and validates on callback to prevent cross-site request forgery attacks.
* **Logs rotated:** capped log size to prevent disk growth.
* **Config export/import:** JSON backup file for migration or node restore. Exports include encrypted data (BTCPay keys, QBO tokens) but NOT the encryption key itself. The encryption key must be backed up separately (see Section 6.1). Imports require the encryption key to be present on the target system to decrypt the data.
* **Auto health checks:** fail-fast `/healthz` endpoint to trigger restarts.

### 6.1 Encryption Key Management

**Purpose:** Secure storage of encryption key used to encrypt sensitive data (BTCPay API keys, QBO tokens) in the database.

**Key Generation:**
1. On first app startup, generate a cryptographically random 32-byte (256-bit) master encryption key using a secure random number generator (e.g., Node.js `crypto.randomBytes`).
2. The key is generated once per installation and must persist across container restarts.

**Key Storage Strategy (Priority Order):**

1. **Platform Secrets Management (Preferred)**
   * **Start9:** Store the encryption key in Start9's secrets service (accessible via `$SERVICES_SECRET_FILE` or Start9 secrets API).
   * **Umbrel:** Store the encryption key in Umbrel's app data secrets directory (`/umbrel/app-data/sovereign-merchant/secrets/` or equivalent).
   * If platform secrets are available, read the key at startup and keep it in memory only (never log or expose).

2. **Fallback: Encrypted Key File**
   * If platform secrets are unavailable, store the key in `/data/encryption.key` with file permissions `0600` (owner read/write only).
   * For additional security, the key file itself can be encrypted using a platform-provided secret or user passphrase (future enhancement).
   * The file must be backed up with the database for data recovery.

3. **Environment Variable (Development Only)**
   * Allow `ENCRYPTION_KEY` environment variable for local development/testing.
   * Production deployments should never use this method.

**Key Persistence:**
* The encryption key must survive container restarts and updates.
* If the key is lost, all encrypted data becomes unrecoverable (by design, for security).
* **Backup and Migration:** 
  * The encryption key must be backed up separately from the database.
  * For `/data/encryption.key` fallback: Include the key file in backups of the `/data` directory.
  * For platform secrets: Use platform backup mechanisms (Start9/Umbrel backup includes secrets).
  * When migrating to a new node: Both the database AND the encryption key must be copied to maintain data accessibility.
  * Config export/import (Section 6) does NOT include the encryption key; it must be handled separately.

**Key Rotation:**
* Key rotation is not supported in v1 (requires re-encryption of all data).
* Future versions may support key rotation with data re-encryption.

**Security Properties:**
* Key never stored in plaintext in the database.
* Key never exposed via API endpoints.
* Key only exists in memory during runtime (loaded from secure storage at startup).
* Key file permissions restrict access to the container process only.
* If key file is missing on startup, app should fail fast with clear error message (prevents accidental data loss).

**Data Encrypted:**
* BTCPay Server API keys (stored in `config` table)
* BTCPay webhook HMAC secret (stored in `config` table)
* QuickBooks OAuth access tokens (stored in `qbo_tokens` table)
* QuickBooks OAuth refresh tokens (stored in `qbo_tokens` table)

**Data NOT Encrypted (stored in plaintext):**
* BTCPay Server URL (not sensitive)
* Reconciliation mode settings (not sensitive)
* Sync state metadata (not sensitive)
* Logs (may contain non-sensitive operational data)

---

## 7. Data Flow

### 7.1 BTCPay-First Flow (v1 Scope)

**Use case:** Merchants create invoices directly in BTCPay and want payments auto-synced to QuickBooks.

1. **BTCPay invoice/payment event** (on-chain, confirmed) triggers a webhook to Sovereign Merchant.
2. **Sovereign Merchant webhook handler** receives the event in real-time (`InvoiceSettled` and incremental `InvoicePaymentSettled` updates) and processes it immediately.
3. For each new payment event, the worker normalizes the invoice/payments and builds an `AccountingProvider` payload (mirroring BTCQBO semantics) containing mode, amounts, and metadata.
4. **QuickBooksOnlineProvider** uses the stored OAuth credentials to create/update the appropriate objects in QBO (Deposit vs Invoicing) directly through Intuit’s REST APIs.
5. **Sovereign Merchant** records the outcome (success/failure, QBO object id if available) in SQLite and exposes it to the UI.
6. UI shows a chronological list: BTCPay invoice → native QuickBooks provider call → QBO success.

### 7.2 Reconciliation Modes (Native Provider)

* **Deposit Mode (default, BTCPay-first):** designed for merchants who treat BTCPay as a payment terminal. Every successful BTCPay payment is posted to QBO as a deposit/sale into a chosen account.
* **Invoicing Mode (BTCPay-first):** designed for merchants who already issue invoices from QBO and want BTCPay payments to be matched against existing QBO invoices (requires manual linking/metadata).

Roadmap-only features live exclusively in Section 2.3 to keep v1 scope laser-focused on reconciliation reliability.

---

## 8. API Schema & Routes (Backend → Frontend)

Base URL: `/api`

**Authentication:** All `/api/*` endpoints except `/api/config/qbo/callback` and `/api/config/api-key/initial` require API key authentication. The API key must be provided in the `Authorization` header as `Bearer <api-key>` or as a query parameter `?apiKey=<api-key>`. The API key is auto-generated on first install and stored hashed in the database. It can be rotated via the settings UI. The frontend stores the API key in localStorage after first successful authentication.

**Authentication Errors:** Invalid or missing API keys result in `401 Unauthorized` response with `{ "error": "Invalid or missing API key" }`. Failed authentication attempts are rate-limited (max 10 attempts per IP per minute) to prevent brute force attacks.

**Public Endpoints:**
- `GET /healthz` - platform health checks (no auth required)
- `GET /api/config/api-key/initial` - initial API key retrieval (one-time only, no auth required)
- `GET /api/config/qbo/callback` - OAuth callback (protected by state validation, no API key required)
- `POST /webhooks/btcpay` - BTCPay webhook handler (protected by BTCPay HMAC signature, no API key required; see endpoint #11)

1. `GET /api/status`

   * **Purpose:** homepage/dashboard status.
   * **Returns:**

     ```json
     {
       "btcpay": { "reachable": true, "url": "https://btcpay.local" },
       "quickbooks": { "connected": true, "realmId": "1234567890", "expiresAt": "2025-11-01T00:00:00Z" },
       "reconciliation": { "mode": "deposit", "lastSyncAt": "2025-10-31T18:00:00Z", "lastStatus": "ok" },
       "logs": [ { "ts": "2025-10-31T18:00:00Z", "level": "info", "msg": "Synced 3 invoices" } ]
     }
     ```

2. `POST /api/config/btcpay`

   * **Body:** `{ "url": "https://btcpay.local", "apiKey": "...", "webhookSecret": "..." }`
   * **Action:** 
     - Validates connectivity
     - Stores API key and webhook secret (encrypted)
     - Registers webhook endpoint in BTCPayServer (if webhook doesn't exist, creates it)
     - Webhook URL: `https://sovereign-merchant.local/webhooks/btcpay` (uses configured base URL)
   * **Returns:** `{ "url": "...", "webhookRegistered": true, "webhookId": "..." }`
   * **Errors:** unreachable, 401 from BTCPay, webhook registration failed.

3. `GET /api/config/btcpay/auto-discover`

   * **Action:** platform-specific discovery (Start9 service listing, Umbrel docker network lookup).
   * **Returns:** `{ "url": "https://btcpay.local", "discovered": true }`

4. `GET /api/config/qbo/url`

   * **Action:** generates a cryptographically random `state` parameter (e.g., 32-byte random hex), stores it server-side (in-memory cache or SQLite with 10-minute expiry), and returns the Intuit OAuth2 authorization URL with `state` appended as a query parameter.
   * **Returns:** `{ "authUrl": "https://appcenter.intuit.com/connect/oauth2?client_id=...&state=..." }`
   * **Security:** The `state` parameter prevents CSRF attacks by ensuring the callback only processes requests that originated from our backend. The state is stored server-side and will be validated when Intuit redirects back with it in the callback URL.
   * **Frontend** opens `authUrl` in a popup. Intuit will echo back the `state` parameter in the callback URL, which our backend will validate.

5. `GET /api/config/qbo/callback?code=...&state=...&realmId=...`

   * **Action:** 
     1. Validates the `state` parameter matches a stored state token (must exist and not be expired).
     2. If state is invalid or missing → returns error HTML page (prevents CSRF attack).
     3. If valid → exchanges `code` + `realmId` for access/refresh tokens, persists tokens, and deletes the used state token.
   * **Returns:** success HTML page that auto-closes popup and notifies SPA.
   * **Security:** State validation ensures only legitimate OAuth flows initiated by our backend can complete token exchange.

6. `POST /api/config/reconciliation`

   * **Body:** `{ "mode": "deposit" | "invoicing", "fallbackSyncEnabled": true, "fallbackSyncIntervalSeconds": 3600 }`
   * **Action:** update local config. Mode determines reconciliation behavior (see Section 7.2).
   * **Note:** `fallbackSyncEnabled` enables optional periodic sync to catch missed webhooks (default: true, runs every hour).

7. `POST /api/sync/now`

   * **Action:** manual “run sync once” trigger for debugging.

8. `GET /api/logs?limit=50`

   * **Action:** return latest N logs for support (for Blake).

9. `GET /api/config/api-key/initial` (no auth required, time-limited)

   * **Purpose:** retrieve the auto-generated API key on first install. Only works within the first 10 minutes after app installation (or until an API key has been used successfully in a request). After this window, users must use the API key rotation endpoint (which requires authentication) or reinstall the app.
   * **Returns:** `{ "apiKey": "abc123..." }` (plaintext, shown once per request)
   * **Security:** Time-limited, restricted to app state = `INIT`, and only reachable when the request passes through the platform’s authenticated proxy headers (e.g., Umbrel session). Frontend should immediately store the key in localStorage and use it for all subsequent requests. After 10 minutes, first authenticated request, or once the state leaves `INIT`, this endpoint returns 403.
   * **Recovery:** If the API key is lost after the initial window, users with console/SSH access run the documented CLI reset (rotates key + re-enters `INIT`), or the app can be reinstalled. Future versions may include a recovery token system.

10. `POST /api/config/api-key/rotate`

   * **Purpose:** generate a new API key, invalidating the old one.
   * **Body:** `{ "currentKey": "..." }` (optional validation)
   * **Returns:** `{ "apiKey": "new-abc123..." }` (plaintext, shown once)
   * **Action:** 
     1. Validates current API key (if provided) and existing session auth.
     2. Generates a new API key, hashes and stores it.
     3. Generates a new BTCPay webhook HMAC secret (32-byte random), encrypts and stores it.
     4. Calls BTCPay Greenfield `PUT /api/v1/stores/{storeId}/webhooks/{webhookId}` to update the webhook secret (falls back to re-registering the webhook if update fails).
     5. Returns the new API key (plaintext once); webhook secret is never returned via API.
   * **Security:** Requires valid API key authentication (uses old key to authorize the rotation). Ensures BTCPay immediately uses the fresh secret so there is no window where webhooks are signed with stale credentials.

11. `POST /webhooks/btcpay` (public endpoint, no API key required)

   * **Purpose:** Webhook endpoint for BTCPayServer invoice/payment events.
  * **Security:** Validates webhook signature using BTCPay's webhook secret (stored encrypted during BTCPay configuration).
  * **Events handled:**
    - `InvoiceSettled` — Invoice status changed to "Settled" (all payments confirmed; triggers final reconciliation).
    - `InvoicePaymentSettled` — A single payment confirmed on an invoice that has not fully settled (lets us capture partial/late payments before expiry).
    - `InvoiceExpired` — BTCPay auto-expired the invoice because the countdown ended. We still inspect `additionalStatus` (e.g., `PaidPartial`, `PaidLate`) and persist whatever value the customer sent.
    - `InvoiceInvalid` — Merchant/admin explicitly marked the invoice invalid. No further payments should be accepted, so we only log the terminal state (no reconciliation).
  * **Events NOT handled (explicitly ignored):**
    - `InvoiceReceivedPayment` — Fires for unconfirmed payments; we wait for confirmation before recording anything.
    - `InvoiceCreated` — Not relevant for reconciliation (no payment yet).
  * **Action:**
     1. Validates HMAC signature from BTCPay
     2. Extracts invoice ID and event type from webhook payload
     3. Fetches full invoice details from BTCPay API if needed
     4. Processes payment reconciliation (see Section 13.3)
  * **Returns:** `200 OK` immediately (async processing)
   * **Idempotency:** Uses BTCPay event ID to prevent duplicate processing

---

## 9. Setup State Machine (UI)

We model setup as a small state machine so the UI can be dumb and predictable.

**States:**

1. `INIT` → app just started, no config yet.
2. `BTCPAY_PENDING` → trying auto-discovery or waiting for manual input.
3. `QBO_PENDING` → BTCPay OK, but QBO not connected.
4. `MODE_PENDING` → both BTCPay + QBO OK, user must pick reconciliation mode.
5. `READY` → all good, scheduler running.
6. `ERROR` → something essential failed (e.g. QBO token refresh, BTCPay unreachable).

**Transitions:**

* `INIT` → (auto-discover success) → `QBO_PENDING`
* `INIT` → (auto-discover fail) → `BTCPAY_PENDING`
* `BTCPAY_PENDING` → (user enters valid URL + key) → `QBO_PENDING`
* `QBO_PENDING` → (successful OAuth callback) → `MODE_PENDING`
* `MODE_PENDING` → (user picks mode: `deposit` or `invoicing`) → `READY`
* `READY` → (sync error) → `ERROR`, show remediation but keep scheduler
* `ERROR` → (user fixes) → `READY`

**Mode Selection in MODE_PENDING:**
* **Deposit:** BTCPay-first, payments create deposits in QBO.
* **Invoicing:** BTCPay-first, payments match existing QBO invoices (requires manual linking).

This lets the frontend show a single prominent call-to-action depending on state, so normies aren't lost.

---

## 10. Guiding Users Through Intuit (QuickBooks) App Keys

**Context:** Most small merchants have a QBO account but have never created an Intuit Developer app. We must avoid a situation where they create **developer/sandbox** keys, then wonder why no real invoices show up.

**Strategy:** Sovereign Merchant does not ship a shared/community Intuit app. The default (and only) integration path requires each merchant to create their own Intuit developer app, paste the Client ID/Secret, and run through OAuth using those credentials. To make this painless, the UI includes a step-by-step, idiot-proof guide with inline screenshots, callouts, and copy buttons so nobody has to leave the app guessing what to click.

### 10.1 Default BYO Flow (Required)

1. User clicks **Connect QuickBooks** → wizard opens a “Create your Intuit app” panel with embedded screenshots of the Intuit developer portal.
2. Wizard instructs them to visit **[https://developer.intuit.com/app/developer/home](https://developer.intuit.com/app/developer/home)**, click **Create an app**, and choose **QuickBooks Online and Payments**.
3. Embedded checklist walks through:
   * Selecting **Production** environment (with a red “don’t pick Sandbox” screenshot).
   * Adding the node-specific redirect URI (UI provides a copy button, e.g., `https://sovereign-merchant.local/api/config/qbo/callback`).
   * Copying the generated **Client ID** and **Client Secret**.
4. User pastes credentials into Sovereign Merchant’s form (fields validate length/format and warn if anything looks sandbox).
5. Backend stores the BYO credentials encrypted, generates a cryptographically random `state`, and opens Intuit OAuth at step 6 exactly as before.
6. Upon successful OAuth callback, UI shows “✅ Connected to QuickBooks: *Company Name* (via your Intuit app)” and links back to the doc panel for future reference.

### 10.2 Guided Docs & Screenshots

* The setup flow embeds a mini-doc with numbered steps, zoomed screenshots, and animated GIFs. Each step highlights the exact button/field to click in the Intuit portal.
* The doc lives locally (bundled markdown) so it works offline and can be opened later via “Help → Intuit App Setup.”
* A downloadable PDF mirrors the in-app guide for auditors/compliance teams.
* Every sensitive value shown in the doc has an adjacent “Copy” button in the app to prevent typos.

### 10.3 Avoiding Wrong Environment

* On callback, inspect `realmId` and environment; if it’s sandbox, show: “You connected to a Sandbox company. This is fine for testing, but it will not affect your real QuickBooks.”
* Store an `environment: "production" | "sandbox"` flag alongside QBO tokens and surface it in `/api/status`.
* Disable auto-sync by default for sandbox and keep surfacing the doc snippet that explains how to switch to production credentials.

---

## 11. Diagnostics & Logging

* **`GET /api/status`:** Source of truth for the dashboard. Returns BTCPay reachability, QuickBooks OAuth status/expiry, selected reconciliation mode, last sync timestamp, and a rolling sample of recent log entries. The UI polls this endpoint every ~10 seconds while the dashboard is open so operators always see live health.
* **`GET /api/logs?limit=N`:** Streams the latest N log records (default 50, max 1000). Response shape: `{ "logs": [ { "ts": "...", "level": "info" | "warn" | "error", "component": "sync" | "api", "invoiceId": "ABCD1234", "message": "..." } ] }`. Supports `?level=error` filtering and `?download=true` to force a plaintext attachment for support tickets.
* **UI workflow:** The Status screen includes a “Logs & Diagnostics” drawer showing the newest entries with copy-to-clipboard buttons. A “Download full logs” button calls `/api/logs?limit=1000&download=true` and saves a timestamped `.log` file. Another link opens `/api/status` JSON in a modal for advanced troubleshooting, mirroring what support will ask operators to paste.

---

## 12. Next Steps

1. Scaffold Node/TS backend (`core/`) with Fastify and `/api/status`.
2. Add SQLite + migration for `config`, `logs`, `sync_state`.
3. Implement QBO OAuth endpoints (`/api/config/qbo/url`, `/api/config/qbo/callback`).
4. Implement BTCPay discovery + manual config endpoints (including webhook registration).
5. Add webhook handler for BTCPay events + optional fallback periodic sync worker.
6. Build React UI with the setup state machine.
7. Finish Start9 and Umbrel packaging under `apps/`.
8. Write operator docs: “How to tell if it’s sandbox vs production” + “How to re-auth QBO.”

---

## 13. BTCPay Integration Details

**Goal:** define exactly what we pull from BTCPay, what we persist locally, and how we hand it off to the AccountingProvider (QuickBooksOnlineProvider in v1).

**Primary integration point:** BTCPay Greenfield API  
Docs: https://docs.btcpayserver.org/API/Greenfield/v1/

### 13.1 Endpoints Used

- `GET /api/v1/stores/{storeId}`  
  to verify the store exists and that the API key is valid.

- `GET /api/v1/stores/{storeId}/invoices?status=Settled&offset=0&limit=50`  
  for fallback periodic sync (only if webhooks are missed).

- `GET /api/v1/stores/{storeId}/invoices/{invoiceId}`  
  to fetch full invoice details when webhook is received.

- `GET /api/v1/stores/{storeId}/invoices/{invoiceId}/payments`  
  to get on-chain payment details (txid, amount, confirmations) when processing webhook events.

- `POST /api/v1/stores/{storeId}/webhooks`  
  to register webhook endpoint with BTCPayServer during configuration.

- `PUT /api/v1/stores/{storeId}/webhooks/{webhookId}`  
  to rotate the webhook secret during API key rotation (falls back to re-register if the update fails).

- `GET /api/v1/stores/{storeId}/webhooks`  
  to list existing webhooks and verify registration.

- `GET /api/v1/server/info`  
  for a basic health/version check; we can surface this in the UI.

### 13.2 Data We Persist

We always persist **both** BTC and USD so accounting/debugging is easy later.

```json
{
  "invoiceId": "ABCD1234",
  "storeId": "STORE123",
  "status": "Settled",
  "additionalStatus": "PaidPartial",
  "invoiceAmountBtc": 0.0025,
  "invoiceAmountUsd": 168.32,
  "paidAmountBtc": 0.0025,
  "paidAmountUsd": 168.32,
  "currency": "USD",
  "rateSource": "btcpay-store-rate",
  "paymentCount": 1,
  "payments": [
    {
      "txId": "f0e2a3...",
      "amountBtc": 0.0025,
      "amountUsd": 168.32,
      "confirmations": 6,
      "paidAt": "2025-10-31T16:12:45Z"
    }
  ],
  "paidAt": "2025-10-31T16:12:45Z",
  "reconciliationStatus": "full" | "partial" | "overpaid" | "invalidated" | "failed"
}
```

**Payment Tracking:**
- `invoiceAmountUsd/Btc`: Original invoice amount (locked at creation time).
- `paidAmountUsd/Btc`: Sum of all confirmed payments for this invoice.
- `paymentCount`: Number of distinct payment transactions.
- `payments`: Array of all payment transactions (to handle multiple payments).
- `reconciliationStatus`: 
  - `full`: paidAmount is within 1% of invoiceAmount (accounts for exchange rate drift, timing differences, and rounding)
  - `partial`: paidAmount < 99% of invoiceAmount (customer paid significantly less than full amount)
  - `overpaid`: paidAmount > 101% of invoiceAmount (customer paid significantly more than full amount)
  - `invalidated`: invoice was invalidated or expired in BTCPay before reconciliation (no reconciliation attempted)
  - `failed`: reconciliation attempt to QBO failed (may be retried automatically or manually)

**Notes:**
- `invoiceAmountUsd` = the USD value BTCPay calculated at invoice creation time, i.e. the locked rate.
- If BTCPay doesn't return a fiat amount, we query the invoice detail to get the original price and currency from BTCPay's internal model.
- We store `rateSource` so we know where we got the number from if someone later changes store settings.
- Each payment in the `payments` array tracks individual transactions (customer may send multiple payments).
- `additionalStatus` mirrors BTCPay's additional invoice status so we can surface `PaidPartial`, `PaidLate`, or other terminal reasons in the UI.

13.3 Sync Logic (Webhook-Based)

**Primary: Real-Time Webhook Processing**

1. **BTCPay webhook received** → Validates HMAC signature using stored webhook secret.
2. **Extract event data:**
   * Invoice ID from webhook payload
   * Event type (`InvoiceSettled`, `InvoicePaymentSettled`, `InvoiceExpired`, `InvoiceInvalid`)
   * Timestamp, `additionalStatus`, and event metadata
3. **Fetch invoice + payments** (for all events except `InvoiceInvalid`, which we only log):
   * Always pull the latest invoice snapshot and payment list so we can aggregate confirmed payments, even if the invoice expired.
   * Calculate `paidAmountBtc`/`paidAmountUsd` from confirmed payments (`status === Settled` at the payment level).
   * Determine derived reconciliation status:
     - If invoice `status === Settled` and `paidAmountUsd` within ±1% of `invoiceAmountUsd` → `full`
     - If invoice not settled and `paidAmountUsd < invoiceAmountUsd * 0.99` → `partial`
     - If aggregate exceeds `invoiceAmountUsd * 1.01` → `overpaid` (may happen with late settlements)
4. **Event-specific handling:**
   * `InvoiceSettled` → Run reconciliation immediately with the aggregated amounts (final pass).
   * `InvoicePaymentSettled` → Reconcile incrementally using the updated aggregate. This unlocks partial/late payment handling before the invoice ever reaches "Settled".
   * `InvoiceExpired` with `additionalStatus` of `PaidPartial` or `PaidLate` → Persist the partial payment and issue reconciliation if we have not already processed the aggregate amount.
   * `InvoiceExpired`/`InvoiceInvalid` with no paid amount → Mark invoice as `invalidated` and skip reconciliation.
5. **Store/update payment data** in local database, including the most recent `additionalStatus` and last processed payment ID.

**Reconciliation Rules by Mode:**

* **Deposit Mode (BTCPay-first):**
  - `full` payment: Create deposit/sale in QBO for full `paidAmountUsd`
  - `partial` payment: Create deposit for `paidAmountUsd` (partial amount; invoice may remain open in BTCPay)
  - `overpaid` payment: Create deposit for `invoiceAmountUsd` (full invoice amount only; overpayment handling depends on merchant policy)
  - Store reconciliation status in local DB for audit trail

* **Invoicing Mode (BTCPay-first):**
  - `full` payment: Match to existing QBO invoice and mark as paid (if QBO invoice ID is available via metadata)
  - `partial` payment: Apply `paidAmountUsd` to QBO invoice (partial payment; QBO invoice may remain partially unpaid)
  - `overpaid` payment: Mark QBO invoice as paid in full; log overpayment amount
  - If QBO invoice ID not available, fall back to Deposit mode behavior

**Multiple Payments Handling:**
- Track all payments in the `payments` array (customer may send multiple transactions)
- Aggregate amounts across all confirmed payments
- Reconcile incrementally: every `InvoicePaymentSettled` update recalculates the aggregate so QBO reflects additional payments even if the invoice never reaches `Settled`
- Only reconcile once per invoice unless status changes (use idempotency to prevent duplicate QBO entries)

**Reconciliation Execution:**
4. Build the AccountingProvider payload (see Section 13.4) with the appropriate amount based on reconciliation status.
5. Invoke `QuickBooksOnlineProvider.reconcile(...)` which talks directly to Intuit’s REST APIs—no BTCPay plugin calls.
6. Write success/failure + reconciliation details to SQLite.
7. Mark webhook event as processed (prevents duplicate processing).

**Fallback: Periodic Sync (Optional)**

- If `fallbackSyncEnabled` is true, runs periodic sync every `fallbackSyncIntervalSeconds` (default: 3600s / 1 hour)
- Purpose: Catch any missed webhooks (network issues, downtime, etc.)
- Process: Fetch invoices with status == `Settled` since last processed timestamp
- Only processes invoices not already reconciled (idempotent)

**Edge Cases:**
- `InvoiceExpired` event with no confirmed payments: Auto-expiry with no value received — mark as `invalidated`, log but don't reconcile.
- `InvoiceExpired` event with `additionalStatus=PaidPartial` or `PaidLate`: Persist partial aggregate, run reconciliation if not already done, and surface the terminal status in the UI.
- `InvoiceInvalid` event: Merchant/admin manually cancelled the invoice in BTCPay; mark as `invalidated`, log but don't reconcile (no further payments should be accepted).
- If invoice was already reconciled and then invalidated: Future enhancement may reverse QBO entry.
- If payment is refunded in BTCPay: BTCPay may send status change event (future: handle refund reconciliation).

⸻

### 13.4 AccountingProvider → QuickBooks Mapping

QuickBooksOnlineProvider performs the actual QuickBooks writes; Sovereign Merchant simply feeds it normalized payloads and persists the results.

| Mode      | Source (BTCPay)         | Target (QBO)                | Notes                                             |
|-----------|-------------------------|-----------------------------|---------------------------------------------------|
| Deposit   | Settled invoice/payment | Deposit / Sales Receipt     | Default for BTCPay-first / “just take payments.”  |
| Invoicing | Settled invoice/payment | Payment applied to invoice  | For merchants who already issued a QBO invoice.   |

**Payload Structure:**

Base payload (full payment):
```json
{
  "invoiceId": "ABCD1234",
  "amountUsd": 168.32,
  "amountBtc": 0.0025,
  "paidAt": "2025-10-31T16:12:45Z",
  "mode": "deposit" | "invoicing",
  "reconciliationStatus": "full",
  "notes": "Synced via Sovereign Merchant"
}
```

Partial payment payload:
```json
{
  "invoiceId": "ABCD1234",
  "amountUsd": 134.65,  // partial amount actually paid
  "invoiceAmountUsd": 168.32,  // original invoice amount
  "amountBtc": 0.0020,
  "paidAt": "2025-10-31T16:12:45Z",
  "mode": "invoicing",
  "reconciliationStatus": "partial",
  "notes": "Partial payment via Sovereign Merchant (80% paid)"
}
```

Overpaid payment payload:
```json
{
  "invoiceId": "ABCD1234",
  "amountUsd": 185.15,  // overpaid amount
  "invoiceAmountUsd": 168.32,  // original invoice amount
  "amountBtc": 0.00275,
  "paidAt": "2025-10-31T16:12:45Z",
  "mode": "deposit" | "invoicing",
  "reconciliationStatus": "overpaid",
  "overpaymentAmountUsd": 16.83,
  "notes": "Overpaid via Sovereign Merchant (10% overpayment)"
}
```

**Invalidated/Failed Payloads:**
- `invalidated` status: Do not send to the AccountingProvider; only log locally that invoice was invalidated.
- `failed` status: Include error details in payload; may be retried automatically or manually

**Payload Notes:**
- For partial payments: Pass `amountUsd` as the actual paid amount, include `invoiceAmountUsd` for context
- QuickBooksOnlineProvider decides the exact QBO object type (Deposit vs Payment) based on mode and reconciliation status
- Overpayments: For deposit mode, create deposit for full invoice amount only; log overpayment separately
- Overpayments: For invoicing mode, mark invoice as paid in full; log overpayment for credit/refund handling
- Status is determined immediately when invoice is processed (no intermediate pending state)
- Include BTCPay `additionalStatus` when present so support can see if a payment was late/partial even after expiry

⸻

14. Error Handling & Retry Policy

we don't want Blake calling you because of a transient 500.
	•	idempotent per invoice: we key retries by `invoiceId + reconciliationStatus`, so we don't double-post. If reconciliation status changes (partial → full), we reconcile again with updated amount.
	•	retry on network / 5xx: exponential backoff + jitter, e.g. 5s → 15s → 60s → mark as error.
	•	auth errors (QBO token expired): try refresh once → if still bad, flip app state to ERROR and show "Reconnect QuickBooks."
	•	BTCPay unreachable: surface "BTCPay not reachable at " in the UI, don't kill the worker.
	•	logs: every failed attempt goes into SQLite with timestamp, level, message, invoiceId, and reconciliationStatus.
	•	manual retry: POST /api/sync/now?invoiceId=... to re-run a single invoice.
	•	partial payment updates: if invoice was partially paid and new payment arrives, reconcile incrementally (add new payment amount to QBO). Use idempotency key: `invoiceId-reconciliationStatus-timestamp` to prevent duplicate QBO entries for same partial payment.
	•	overpayment handling: log overpayment amount for merchant review; QBO reconciliation marks invoice as paid but doesn't create credit unless merchant configures it.

⸻

15. Developer Environment & Local Setup

for you / BTCNYC contributors / future you:
	1.	prereqs: Node LTS, pnpm (or npm), Docker, SQLite
	2.	install:

pnpm install --filter core...
pnpm install --filter web...


	3.	run backend:

cd core
pnpm dev

starts API on http://localhost:3000

	4.	run frontend:

cd web
pnpm dev

Vite on http://localhost:5173

	5.	.env (core/.env):

QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_REDIRECT_URI=http://localhost:3000/api/config/qbo/callback
BTCPAY_BASE_URL=http://localhost:8080
ENCRYPTION_KEY=... (optional, for local dev only; if not set, will generate and store in /data/encryption.key)


	6.	docker build:

docker build -t sovereign-merchant:latest .


	7.	packaging: apps/start9/ and apps/umbrel/ just point to the same image.

⸻

16. Merchant Workflow Integration

we have to explain to normies that we don’t send the email — BTCPay or QBO does.

single v1 flow:
	•	employee creates invoice in BTCPay
	•	BTCPay emails payment link
	•	customer pays
	•	Sovereign Merchant sees settlement → pushes to QBO via the native provider

we should ship a “How this works” page in the UI with that diagram, and leave a “Coming in v2 (see Roadmap)” teaser rather than documenting the future flow here.

⸻

17. Tax & Legal Disclaimer

BTC payments are recorded at the fiat value that BTCPay provides at the time of payment. Sovereign Merchant does not compute, track, or file capital gains/losses, and nothing in this app or documentation constitutes tax or legal advice.
