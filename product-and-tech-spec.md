## Sovereign Merchants

### Product & Technical Specification (v0.2)

---

## 1. Product Overview

**Goal:**  Empower merchants using BTCPayServer on Start9 or Umbrel to automatically reconcile Bitcoin payments with QuickBooks Online, using the BTCQBO plugin under the hood. The app should require no command-line usage and feel as simple as a native App Store install.

**Tagline:**

> A plug-and-play reconciliation bridge between BTCPay and QuickBooks — built for sovereignty, not SaaS.

**Core Value:**
Merchants running self-hosted Bitcoin payment servers should have the same bookkeeping automation as fiat payment processors. Sovereign Merchants delivers that with full control, zero third-party custody, and no monthly fees beyond Bitcoin network costs.

---

## 2. Product Goals

### 2.1 Primary Goals

1. **Simple install** – one-click app install via Start9 or Umbrel, no terminal commands.
2. **Auto-discovery of BTCPayServer** – detect BTCPay on same node; fallback to manual input.
3. **QuickBooks integration** – full OAuth2 connection and auto-token refresh.
4. **Auto-reconciliation** – sync invoices/payments from BTCPay to QuickBooks using BTCQBO endpoints.
5. **Clear status UI** – always show connection health and recent syncs.

### 2.2 Non-goals (v1)

* No Lightning support (on-chain only for simplicity).
* No multi-company QuickBooks linking.
* No terminal or advanced configuration (expert settings can come later).

---

## 3. Product Experience

### 3.1 Install Flow

1. User installs from the platform app store.
2. App starts with a welcome screen. Backend auto-generates API key on first startup.
3. Frontend fetches initial API key from `/api/config/api-key/initial` (one-time, no auth required) and stores it in localStorage.
4. Detect or request BTCPay URL + API key.
5. Click **"Connect QuickBooks"** → OAuth2 popup → confirmation.
6. Choose reconciliation mode:
   * **Deposit** (default) - BTCPay-first: payments auto-create deposits in QBO.
   * **Invoicing** - BTCPay-first: payments match existing QBO invoices.
   * **QBO-First** - Traditional QBO workflow with Bitcoin payment links (see Section 18).
7. Confirmation screen shows sync summary and logs.
   * For QBO-first mode: UI shows instructions for generating payment links and integrating with QBO invoices.

### 3.2 Example UI Copy

* **Header:** *Sovereign Merchants*
* **Subtitle:** Auto-reconcile BTCPay payments to QuickBooks.
* **Setup steps:**

  1. Detect BTCPay → Confirm or enter manually.
  2. Connect QuickBooks → Launch OAuth flow.
  3. Choose Mode → Deposit (default) / Invoicing.
* **Footer:** "Powered by [BTCQBO](https://github.com/JeffVandrewJr/btcqbo)."

---

## 4. Technical Architecture

### 4.1 Core Stack (Confirmed)

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

1. **Core API Server (Express or Fastify)**

   * Serves REST API endpoints (`/api/config`, `/api/sync`, `/api/status`).
   * Hosts compiled frontend under `/`.
   * Handles QuickBooks OAuth2 and token management.
   * Manages scheduled sync job.

2. **Sync Worker**

   * Runs in the same Node process.
   * Receives webhooks from BTCPayServer for invoice/payment events.
   * Processes webhook events in real-time → reconciles via BTCQBO.
   * Logs status, errors, and summary metrics.
   * Also provides fallback periodic sync for missed webhooks (optional, configurable).

3. **Storage Layer**

   * SQLite database under `/data/config.db`.
   * Stores BTCPay URL + key (encrypted), BTCPay webhook secret (encrypted), QBO tokens (encrypted), reconciliation mode, API key (hashed), logs, QBO-first invoice mappings (BTCPay invoice ID → QBO invoice ID for reconciliation), and processed webhook event IDs (for idempotency).
   * Encryption key stored separately (see Section 6.1) in platform secrets or `/data/encryption.key`.
   * Data directory exposed as a Docker volume for persistence.

4. **Health Endpoint**

   * `/healthz` endpoint for Start9/Umbrel health checks.

5. **UI Layer**

   * React SPA (Vite) with minimal design → 3 setup steps + status dashboard.
   * Talks to `/api` endpoints from the backend.

---

## 5. Repository Structure

```plaintext
sovereign-merchants/
├── core/                  # Node backend (Express/Fastify API, sync worker)
│   ├── src/
│   │   ├── api/           # API routes (config, sync, status, qbo-first)
│   │   ├── jobs/          # Scheduler + sync logic (handles both BTCPay-first and QBO-first)
│   │   ├── services/      # BTCPay + QBO clients
│   │   ├── models/        # SQLite schema + migrations (includes qbo-first invoice mappings)
│   │   ├── routes/        # Public routes (/pay endpoint for QBO-first)
│   │   └── utils/         # Logger, encryption helpers, HMAC signing
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
* **HMAC secret management:** QBO-first payment links use HMAC signatures. Secret is auto-generated on first install (32-byte random), stored encrypted alongside encryption key (Section 6.1), and rotated via API key rotation (same lifecycle). See Section 18 for payment link security.
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
* QuickBooks OAuth access tokens (stored in `qbo_tokens` table)
* QuickBooks OAuth refresh tokens (stored in `qbo_tokens` table)

**Data NOT Encrypted (stored in plaintext):**
* BTCPay Server URL (not sensitive)
* Reconciliation mode settings (not sensitive)
* Sync state metadata (not sensitive)
* Logs (may contain non-sensitive operational data)

---

## 7. Data Flow

### 7.1 BTCPay-First Flow (Default)

**Use case:** Merchants create invoices directly in BTCPay and want payments auto-synced to QuickBooks.

1. **BTCPay invoice/payment event** (on-chain, confirmed) triggers a webhook to Sovereign Merchants.
2. **Sovereign Merchants webhook handler** receives the event in real-time and processes it immediately.
3. For each new payment event, the worker formats a **BTCQBO-compatible request** and calls the BTCQBO plugin endpoint running inside BTCPay.
4. **BTCQBO plugin** uses the stored QuickBooks OAuth credentials to create/update the appropriate objects in QBO (depending on mode: Deposit vs Invoicing).
5. **Sovereign Merchants** records the outcome (success/failure, QBO object id if available) in SQLite and exposes it to the UI.
6. UI shows a chronological list: BTCPay invoice → BTCQBO call → QBO success.

### 7.2 QBO-First Flow (Dynamic Invoice Bridge)

**Use case:** Merchants create invoices in QuickBooks (traditional workflow) and offer Bitcoin payment option via "Pay in Bitcoin" links.

1. **QBO invoice created** → Merchant generates signed "Pay in Bitcoin" link (see Section 18) and includes it in QBO invoice email.
2. **Customer clicks payment link** → Hits `/pay?q=...&sig=...` endpoint on Sovereign Merchants.
3. **Sovereign Merchants validates link** → Verifies HMAC signature, fetches invoice details from QBO, confirms invoice status and amount.
4. **Sovereign Merchants creates BTCPay invoice** → Creates short-lived BTCPay invoice (30-minute expiry) with current BTC rate for the USD amount.
5. **Customer redirected to BTCPay** → Pays on BTCPay payment page.
6. **Sovereign Merchants webhook handler** → Receives webhook event for settled BTCPay invoice (same real-time mechanism as 7.1).
7. **Reconciliation** → Worker calls BTCQBO to mark the original QBO invoice as paid (using the QBO invoice ID stored during step 3).
8. UI shows: QBO invoice → Payment link clicked → BTCPay invoice created → Payment settled → QBO invoice marked paid.

**Note:** The sync worker handles both BTCPay-first and QBO-first flows by tracking invoice source and reconciliation mode.

### 7.3 Reconciliation Modes (BTCQBO)

* **Deposit Mode (default, BTCPay-first):** designed for merchants who treat BTCPay as a payment terminal. Every successful BTCPay payment is posted to QBO as a deposit/sale into a chosen account.
* **Invoicing Mode (BTCPay-first):** designed for merchants who already issue invoices from QBO and want BTCPay payments to be matched against existing QBO invoices (requires manual matching or additional metadata).
* **QBO-First Mode:** designed for merchants who create invoices in QBO and use Sovereign Merchants as a dynamic payment bridge. BTCPay invoices are created on-demand when customers click payment links, and payments are automatically reconciled back to the original QBO invoice (see Section 18).

---

## 8. API Schema & Routes (Backend → Frontend)

Base URL: `/api`

**Authentication:** All `/api/*` endpoints except `/api/config/qbo/callback` and `/api/config/api-key/initial` require API key authentication. The API key must be provided in the `Authorization` header as `Bearer <api-key>` or as a query parameter `?apiKey=<api-key>`. The API key is auto-generated on first install and stored hashed in the database. It can be rotated via the settings UI. The frontend stores the API key in localStorage after first successful authentication.

**Authentication Errors:** Invalid or missing API keys result in `401 Unauthorized` response with `{ "error": "Invalid or missing API key" }`. Failed authentication attempts are rate-limited (max 10 attempts per IP per minute) to prevent brute force attacks.

**Public Endpoints:**
- `GET /healthz` - platform health checks (no auth required)
- `GET /api/config/api-key/initial` - initial API key retrieval (one-time only, no auth required)
- `GET /api/config/qbo/callback` - OAuth callback (protected by state validation, no API key required)
- `GET /pay?q=...&sig=...` - QBO-first payment link handler (protected by HMAC signature, no API key required; see endpoint #11)
- `POST /webhooks/btcpay` - BTCPay webhook handler (protected by BTCPay HMAC signature, no API key required; see endpoint #14)

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
   * **Errors:** unreachable, 401 from BTCPay, BTCQBO plugin missing, webhook registration failed.

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

   * **Body:** `{ "mode": "deposit" | "invoicing" | "qbo-first", "fallbackSyncEnabled": true, "fallbackSyncIntervalSeconds": 3600 }`
   * **Action:** update local config. Mode determines reconciliation behavior (see Section 7.3).
   * **Note:** `qbo-first` mode enables dynamic invoice bridge functionality (Section 18).
   * **Note:** `fallbackSyncEnabled` enables optional periodic sync to catch missed webhooks (default: true, runs every hour).

7. `POST /api/sync/now`

   * **Action:** manual “run sync once” trigger for debugging.

8. `GET /api/logs?limit=50`

   * **Action:** return latest N logs for support (for Blake).

9. `GET /api/config/api-key/initial` (no auth required, time-limited)

   * **Purpose:** retrieve the auto-generated API key on first install. Only works within the first 10 minutes after app installation (or until an API key has been used successfully in a request). After this window, users must use the API key rotation endpoint (which requires authentication) or reinstall the app.
   * **Returns:** `{ "apiKey": "abc123..." }` (plaintext, shown once per request)
   * **Security:** Time-limited to prevent indefinite access without proper authentication. Frontend should immediately store the key in localStorage and use it for all subsequent requests. After 10 minutes or first authenticated request, this endpoint returns 403.
   * **Recovery:** If API key is lost after the initial window, users with console/SSH access can reset it directly in the database, or the app can be reinstalled. Future versions may include a recovery token system.

10. `POST /api/config/api-key/rotate`

   * **Purpose:** generate a new API key, invalidating the old one.
   * **Body:** `{ "currentKey": "..." }` (optional validation)
   * **Returns:** `{ "apiKey": "new-abc123..." }` (plaintext, shown once)
   * **Action:** generates new key, hashes and stores it, returns plaintext once. Frontend must update localStorage immediately.
   * **Security:** Requires valid API key authentication (uses old key to authorize the rotation).

11. `GET /pay?q=...&sig=...` (public endpoint, no API key required)

   * **Purpose:** QBO-first flow — customer clicks "Pay in Bitcoin" link from QBO invoice.
   * **Parameters:** 
     * `q` - Base64-encoded JSON: `{ "invoiceId": "INV-12345", "amountUsd": 168.32, "version": 1 }`
     * `sig` - HMAC signature over `q` using server secret (prevents tampering).
   * **Action:**
     1. Validates HMAC signature; rejects if invalid.
     2. Fetches invoice details from QBO to confirm amount, status, and existence.
     3. Checks if invoice is already paid; if so, shows "Invoice already paid" message.
     4. Creates BTCPay invoice for the USD amount (30-minute expiry, current BTC rate).
     5. Stores mapping: BTCPay invoice ID → QBO invoice ID.
     6. Redirects customer to BTCPay payment page.
   * **Returns:** HTTP 302 redirect to BTCPay payment page, or error page if validation fails.
   * **Security:** HMAC signature prevents amount/invoice ID tampering. Only works if reconciliation mode is set to `qbo-first`.

12. `POST /api/qbo-first/generate-link` (requires auth)

   * **Purpose:** Generate a signed "Pay in Bitcoin" link for a QBO invoice.
   * **Body:** `{ "qboInvoiceId": "INV-12345", "amountUsd": 420.69 }`
   * **Returns:** `{ "paymentLink": "https://sovereign-merchant.local/pay?q=...&sig=..." }`
   * **Action:** Creates HMAC-signed payment link for embedding in QBO invoice emails or invoices.
   * **Note:** Payment links don't expire. When a customer clicks the link, a BTCPay invoice is created with a 30-minute expiry (see Section 18). The QBO invoice status is checked at click-time to prevent paying already-paid invoices.

13. `GET /api/qbo-first/pending-invoices` (requires auth)

   * **Purpose:** List BTCPay invoices that are pending payment for QBO invoices.
   * **Returns:** `{ "pending": [ { "btcpayInvoiceId": "...", "qboInvoiceId": "INV-12345", "amountUsd": 168.32, "createdAt": "...", "expiresAt": "..." } ] }`
   * **Action:** Returns list of BTCPay invoices created via QBO-first flow that are not yet settled.

14. `POST /webhooks/btcpay` (public endpoint, no API key required)

   * **Purpose:** Webhook endpoint for BTCPayServer invoice/payment events.
   * **Security:** Validates webhook signature using BTCPay's webhook secret (stored encrypted during BTCPay configuration).
   * **Events handled:**
     - `InvoiceSettled` - Invoice status changed to "Settled" (all payments confirmed; may be full or partial payment)
     - `InvoiceExpired` - Invoice expired due to timeout (no reconciliation)
     - `InvoiceInvalid` - Invoice invalidated (marked invalid; no reconciliation)
   * **Events NOT handled (explicitly ignored):**
     - `InvoiceReceivedPayment` - Fires for unconfirmed payments; we wait for `InvoiceSettled` instead
     - `InvoicePaymentSettled` - Individual payment confirmed; redundant since `InvoiceSettled` fires when invoice is settled
     - `InvoiceCreated` - Not relevant for reconciliation (only process when settled)
   * **Action:**
     1. Validates HMAC signature from BTCPay
     2. Extracts invoice ID and event type from webhook payload
     3. Fetches full invoice details from BTCPay API if needed
     4. Processes payment reconciliation (see Section 12.3)
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
* `MODE_PENDING` → (user picks mode: `deposit`, `invoicing`, or `qbo-first`) → `READY`
* `READY` → (sync error) → `ERROR`, show remediation but keep scheduler
* `ERROR` → (user fixes) → `READY`

**Mode Selection in MODE_PENDING:**
* **Deposit:** BTCPay-first, payments create deposits in QBO.
* **Invoicing:** BTCPay-first, payments match existing QBO invoices (requires manual linking).
* **QBO-First:** Traditional QBO invoice workflow with Bitcoin payment option via dynamic links.

This lets the frontend show a single prominent call-to-action depending on state, so normies aren't lost.

---

## 10. Guiding Users Through Intuit (QuickBooks) App Keys

**Context:** Most small merchants have a QBO account but have never created an Intuit Developer app. We must avoid a situation where they create **developer/sandbox** keys, then wonder why no real invoices show up.

**Strategy:** the Sovereign Merchants app should ship with **our** Intuit app credentials (server-side) for the common case. Merchants just click “Connect QuickBooks” and do OAuth — no key creation. **However**, we should document a BYO-keys path for advanced/self-hosted users who insist on using their own Intuit app.

### 10.1 Preferred Path (No Keys Required)

1. User clicks **Connect QuickBooks**.
2. Backend generates a cryptographically random `state` parameter (e.g., 32-byte random hex), stores it server-side with a 10-minute expiry, and builds an **OAuth2 auth URL** using **our** client id + redirect URL + `state` parameter.
3. Frontend opens the auth URL in a popup.
4. User signs into their real QBO (not sandbox) and selects the company.
5. Intuit redirects back to `/api/config/qbo/callback` with `code`, `realmId`, and `state`.
6. Backend validates the `state` parameter matches the stored token (CSRF protection). If invalid or expired, returns error and rejects the callback.
7. If valid, backend exchanges `code` for **production** access/refresh tokens and stores them.
8. Backend deletes the used state token (one-time use to prevent replay attacks).
9. UI shows: "✅ Connected to QuickBooks: *Company Name*".

**Security Note:** The `state` parameter prevents CSRF attacks. If an attacker attempts to redirect a callback with a forged `code`, they cannot provide a valid `state` that matches our server-stored token, so the request is rejected.

This is the smooth path. No dev portal. No dashboard. No confusion.

### 10.2 BYO Keys Path (Advanced)

For shops that don’t want to trust our Intuit app (fully sovereign), we give them exact instructions:

1. Go to **[https://developer.intuit.com/app/developer/home](https://developer.intuit.com/app/developer/home)** and sign in with the same Intuit account that owns the QBO company.
2. Click **Create an app** → choose **QuickBooks Online and Payments**.
3. In the app settings:

   * Make sure the **Environment** is **Production**, not just Sandbox.
   * Add an **OAuth redirect URI** pointing to their node’s Sovereign Merchants URL, e.g. `https://sovereign-merchants.local/api/config/qbo/callback`.
   * Copy the **Client ID** and **Client Secret**.
4. In Sovereign Merchants → Settings → "Use my own Intuit app" → paste Client ID + Secret + Redirect URI.
5. Click **Connect QuickBooks** again → now the flow uses **their** keys (same CSRF protection via `state` parameter applies).

We should explicitly warn:

> “If you only create a Sandbox app in Intuit, Sovereign Merchants will sync only to your Sandbox company, not your real books.”

We can detect this in the callback: Intuit’s sandbox realmIds follow known patterns and we can flag the UI to show a yellow banner.

### 10.3 Avoiding Wrong Environment

* On callback, inspect `realmId` and environment; if it’s sandbox, show: “You connected to a Sandbox company. This is fine for testing, but it will not affect your real QuickBooks.”
* Store an `environment: "production" | "sandbox"` flag alongside QBO tokens.
* Disable auto-sync by default for sandbox.

---

## 11. Next Steps

1. Scaffold Node/TS backend (`core/`) with Express/Fastify and `/api/status`.
2. Add SQLite + migration for `config`, `logs`, `sync_state`.
3. Implement QBO OAuth endpoints (`/api/config/qbo/url`, `/api/config/qbo/callback`).
4. Implement BTCPay discovery + manual config endpoints (including webhook registration).
5. Add webhook handler for BTCPay events + optional fallback periodic sync worker.
6. Build React UI with the setup state machine.
7. Finish Start9 and Umbrel packaging under `apps/`.
8. Write operator docs: “How to tell if it’s sandbox vs production” + “How to re-auth QBO.”

---

## 12. BTCPay Integration Details

**Goal:** define exactly what we pull from BTCPay, what we persist locally, and how we hand it off to BTCQBO.

**Primary integration point:** BTCPay Greenfield API  
Docs: https://docs.btcpayserver.org/API/Greenfield/v1/

### 12.1 Endpoints Used

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

- `GET /api/v1/stores/{storeId}/webhooks`  
  to list existing webhooks and verify registration.

- `GET /api/v1/server/info`  
  for a basic health/version check; we can surface this in the UI.

### 12.2 Data We Persist

We always persist **both** BTC and USD so accounting/debugging is easy later.

```json
{
  "invoiceId": "ABCD1234",
  "storeId": "STORE123",
  "status": "Settled",
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

12.3 Sync Logic (Webhook-Based)

**Primary: Real-Time Webhook Processing**

1. **BTCPay webhook received** → Validates HMAC signature using stored webhook secret.
2. **Extract event data:**
   * Invoice ID from webhook payload
   * Event type (`InvoiceSettled`, `InvoiceExpired`, `InvoiceInvalid`)
   * Timestamp and event metadata
3. **For `InvoiceSettled` events only** (skip reconciliation for `InvoiceExpired`/`InvoiceInvalid`):
   * Fetch invoice details from BTCPay API (if not already in webhook payload)
   * Fetch all payments via `/api/v1/stores/{storeId}/invoices/{invoiceId}/payments`
   * **Note:** When invoice status is "Settled", all payments are already confirmed, so no need to filter
   * Calculate `paidAmountBtc` = sum of all payment amounts
   * Calculate `paidAmountUsd` = sum of all payment amounts converted to USD at invoice rate
   * Determine `reconciliationStatus`:
     - If `paidAmountUsd >= invoiceAmountUsd * 0.99` and `paidAmountUsd <= invoiceAmountUsd * 1.01` (within 1% tolerance for exchange rate drift and rounding) → `full`
     - If `paidAmountUsd < invoiceAmountUsd * 0.99` → `partial`
     - If `paidAmountUsd > invoiceAmountUsd * 1.01` → `overpaid`
   * Store/update payment data in local database

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

* **QBO-First Mode:**
  - `full` payment: Mark original QBO invoice as paid in full via BTCQBO
  - `partial` payment: Apply `paidAmountUsd` as partial payment to QBO invoice (QBO invoice remains partially unpaid)
  - `overpaid` payment: Mark QBO invoice as paid in full; log overpayment amount for credit/refund handling
  - Uses stored BTCPay invoice ID → QBO invoice ID mapping (from Section 7.2)

**Multiple Payments Handling:**
- Track all payments in the `payments` array (customer may send multiple transactions)
- Aggregate amounts across all confirmed payments
- Reconcile incrementally: if invoice was `partial` and new payment arrives, update QBO with additional amount
- Only reconcile once per invoice unless status changes (use idempotency to prevent duplicate QBO entries)

**Reconciliation Execution:**
4. Build BTCQBO payload (see Section 13) with appropriate amount based on reconciliation status
5. Call BTCQBO inside BTCPay at `/plugins/btcqbo/...` (pass `paidAmountUsd` for partial payments)
6. Write success/failure + reconciliation details to SQLite
7. Mark webhook event as processed (prevents duplicate processing)

**Fallback: Periodic Sync (Optional)**

- If `fallbackSyncEnabled` is true, runs periodic sync every `fallbackSyncIntervalSeconds` (default: 3600s / 1 hour)
- Purpose: Catch any missed webhooks (network issues, downtime, etc.)
- Process: Fetch invoices with status == `Settled` since last processed timestamp
- Only processes invoices not already reconciled (idempotent)

**Edge Cases:**
- `InvoiceExpired` event: Mark as `invalidated`, log but don't reconcile (invoice never paid)
- `InvoiceInvalid` event: Mark as `invalidated`, log but don't reconcile (invoice was invalidated)
- If invoice was already reconciled and then invalidated: Future enhancement may reverse QBO entry
- If payment is refunded in BTCPay: BTCPay may send status change event (future: handle refund reconciliation)

⸻

13. BTCQBO → QuickBooks Mapping

BTCQBO does the actual QuickBooks write. Sovereign Merchant orchestrates.

Modes:

Mode	Source (BTCPay)	Target (QBO)	Notes
Deposit	settled invoice/payment	Deposit / Sales Receipt	default for BTC-first / normie flows
Invoicing	settled invoice/payment	Payment applied to existing invoice	for BTCPay-first with existing QBO invoices
QBO-First	settled invoice/payment	Payment applied to QBO invoice	QBO-first mode with invoice mapping

**Payload Structure:**

Base payload (full payment):
```json
{
  "invoiceId": "ABCD1234",
  "amountUsd": 168.32,
  "amountBtc": 0.0025,
  "paidAt": "2025-10-31T16:12:45Z",
  "mode": "deposit" | "invoicing" | "qbo-first",
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
  "mode": "invoicing" | "qbo-first",
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
  "mode": "deposit" | "invoicing" | "qbo-first",
  "reconciliationStatus": "overpaid",
  "overpaymentAmountUsd": 16.83,
  "notes": "Overpaid via Sovereign Merchant (10% overpayment)"
}
```

**Invalidated/Failed Payloads:**
- `invalidated` status: Do not send to BTCQBO; only log locally that invoice was invalidated
- `failed` status: Include error details in payload; may be retried automatically or manually

**Payload Notes:**
- For partial payments: Pass `amountUsd` as the actual paid amount, include `invoiceAmountUsd` for context
- For QBO-first mode: Include `qboInvoiceId` in payload (from stored mapping) to ensure payment applies to correct QBO invoice
- BTCQBO decides the exact QBO object type (Deposit vs Payment) based on mode and reconciliation status
- Overpayments: For deposit mode, create deposit for full invoice amount only; log overpayment separately
- Overpayments: For invoicing/qbo-first modes, mark invoice as paid in full; log overpayment for credit/refund handling
- Status is determined immediately when invoice is processed (no intermediate pending state)

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

two main flows:
	1.	BTCPay-first
	•	employee creates invoice in BTCPay
	•	BTCPay emails payment link
	•	customer pays
	•	Sovereign Merchant sees settlement → pushes to QBO
	2.	QBO-first (your mining host case)
	•	employee makes invoice in QBO like always
	•	customer gets normal QBO email
	•	customer clicks “Pay in Bitcoin” link
	•	Sovereign Merchant generates a BTCPay invoice right then
	•	settlement gets pushed back to QBO

we should ship a “How this works” page in the UI with those two diagrams.

⸻

17. Just-in-Time (JIT) Bitcoin Payment Flow for QBO-First Merchants

problem: BTC price moves too fast to email a fixed BTC amount.
solution: email the USD invoice → generate BTC quote at payment time.

17.1 flow
	1.	QBO invoice exists in USD.
	2.	customer clicks Pay in Bitcoin link.
	3.	Sovereign Merchant:
	•	verifies the link (HMAC/signed payload)
	•	fetches invoice from QBO to confirm amount + invoice id
	•	calls BTCPay to create invoice now using current store rate
	4.	BTCPay shows payment page with 30-minute expiry.
	5.	customer pays.
	6.	Sovereign Merchant sees settled payment → tells BTCQBO to mark the original QBO invoice paid.

17.2 why 30 minutes?
	•	15 minutes is e-com friendly but tight for invoices.
	•	30 minutes gives humans time to open their wallet and broadcast.
	•	we also support “auto-extend until first confirmation” — once we see a tx before expiry, we keep it alive until 3 blocks.

⸻

18. Sovereign Merchant as Dynamic Invoice Bridge

**Note:** This section details the QBO-first reconciliation mode. See Section 7.2 for the integrated data flow and Section 8 (endpoints #11-13) for API details.

**Definition:** When reconciliation mode is set to `qbo-first`, Sovereign Merchant acts as a dynamic invoice bridge. When a customer clicks a "pay in bitcoin" link for a QBO invoice, the system talks to both QBO and BTCPay, generates a short-lived BTCPay invoice, and then reconciles the payment back to QBO automatically.

18.1 steps
	1.	customer hits /pay?qboInvoice=INV-12345&sig=...
	2.	app verifies sig (HMAC with server secret) → protects against amount/id tampering
	3.	app pulls invoice details from QBO (amount, currency, status)
	4.	app calls BTCPay:
	•	create invoice for amountUsd
	•	expiry: 30 minutes
	5.	app redirects customer to BTCPay payment page
	6.	app watches BTCPay invoice:
	•	if tx broadcast before expiry → auto-extend until 3 blocks
	•	else → invoice expires, customer can click link again to regenerate
	7.	on settlement, app triggers BTCQBO to mark QBO invoice as paid

18.2 why the bridge lives here (not in BTCPay)
	•	Sovereign Merchant has both credentials (QBO + BTCPay)
	•	Sovereign Merchant can enforce ACLs (access control lists): customers can only pay their invoice; BTCPay can only send webhooks; QBO can only deliver invoice events
	•	keeps customer invoice privacy — customers can’t enumerate other invoices
	•	keeps BTCPay simple — it just makes invoices and takes money

18.3 link format (example)

https://sovereign-merchant.local/pay?q=eyJpbnZvaWNlSWQiOiJJTlYtMTIzNDUiLCJhbW91bnRVc2QiOjE2OC4zMiwidmVyc2lvbiI6MX0.&sig=abc123...

	•	q = base64/json of invoice id + amount
	•	sig = HMAC over q
	•	if someone tampers with amount → signature fail → we refuse to create BTCPay invoice

⸻
