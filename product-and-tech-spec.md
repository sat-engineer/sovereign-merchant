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
2. App starts with a welcome screen.
3. Detect or request BTCPay URL + API key.
4. Click **“Connect QuickBooks”** → OAuth2 popup → confirmation.
5. Choose reconciliation mode (Deposit or Invoicing).
6. Confirmation screen shows sync summary and logs.

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
   * Interval task (e.g., every 60s) → fetches BTCPay invoices → reconciles via BTCQBO.
   * Logs status, errors, and summary metrics.

3. **Storage Layer**

   * SQLite database under `/data/config.db`.
   * Stores BTCPay URL + key, QBO tokens, reconciliation mode, and logs.
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
│   │   ├── api/           # API routes (config, sync, status)
│   │   ├── jobs/          # Scheduler + sync logic
│   │   ├── services/      # BTCPay + QBO clients
│   │   ├── models/        # SQLite schema + migrations
│   │   └── utils/         # Logger, encryption helpers
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

* **API key encryption:** BTCPay + QBO tokens encrypted at rest with local key.
* **HTTPS enforced:** fallback to HTTP only if self-hosted/localnet.
* **OAuth CSRF protection:** All OAuth flows use `state` parameter validation. Server generates cryptographically random state tokens, stores them with short expiry (10 minutes), and validates on callback to prevent cross-site request forgery attacks.
* **Logs rotated:** capped log size to prevent disk growth.
* **Config export/import:** JSON backup file for migration or node restore.
* **Auto health checks:** fail-fast `/healthz` endpoint to trigger restarts.

---

## 7. Data Flow

### 7.1 High-Level Flow

1. **BTCPay invoice/payment event** (on-chain, confirmed) becomes available through BTCPay’s Greenfield API.
2. **Sovereign Merchants sync worker** (Node) polls BTCPay every 60s (configurable) for **invoices/payments since `lastSyncAt`**.
3. For each new payment, the worker formats a **BTCQBO-compatible request** and calls the BTCQBO plugin endpoint running inside BTCPay.
4. **BTCQBO plugin** uses the stored QuickBooks OAuth credentials to create/update the appropriate objects in QBO (depending on mode: Deposit vs Invoicing).
5. **Sovereign Merchants** records the outcome (success/failure, QBO object id if available) in SQLite and exposes it to the UI.
6. UI shows a chronological list: BTCPay invoice → BTCQBO call → QBO success.

### 7.2 Modes (BTCQBO)

* **Deposit Mode (default):** designed for merchants who treat BTCPay as a payment terminal. Every successful BTCPay payment is posted to QBO as a deposit/sale into a chosen account.
* **Invoicing Mode:** designed for merchants who already issue invoices from QBO and want BTCPay payments to be matched against existing QBO invoices.

---

## 8. API Schema & Routes (Backend → Frontend)

Base URL: `/api`

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

   * **Body:** `{ "url": "https://btcpay.local", "apiKey": "..." }`
   * **Action:** validates connectivity + stores encrypted.
   * **Errors:** unreachable, 401 from BTCPay, BTCQBO plugin missing.

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

   * **Body:** `{ "mode": "deposit", "intervalSeconds": 60 }`
   * **Action:** update local config and scheduler.

7. `POST /api/sync/now`

   * **Action:** manual “run sync once” trigger for debugging.

8. `GET /api/logs?limit=50`

   * **Action:** return latest N logs for support (for Blake).

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
* `MODE_PENDING` → (user picks mode) → `READY`
* `READY` → (sync error) → `ERROR`, show remediation but keep scheduler
* `ERROR` → (user fixes) → `READY`

This lets the frontend show a single prominent call-to-action depending on state, so normies aren’t lost.

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
4. Implement BTCPay discovery + manual config endpoints.
5. Add sync worker (1-minute interval) and bind to config.
6. Build React UI with the setup state machine.
7. Finish Start9 and Umbrel packaging under `apps/`.
8. Write operator docs: “How to tell if it’s sandbox vs production” + “How to re-auth QBO.”

perfect. here’s an append-only block you can drop at the very end of your current product-and-tech-spec.md — right after ## 11. Next Steps. it assumes everything up to section 11 is the version you liked.

---

## 12. BTCPay Integration Details

**Goal:** define exactly what we pull from BTCPay, what we persist locally, and how we hand it off to BTCQBO.

**Primary integration point:** BTCPay Greenfield API  
Docs: https://docs.btcpayserver.org/API/Greenfield/v1/

### 12.1 Endpoints Used

- `GET /api/v1/stores/{storeId}`  
  to verify the store exists and that the API key is valid.

- `GET /api/v1/stores/{storeId}/invoices?status=Settled&offset=0&limit=50`  
  to pull recently settled invoices (we can filter by date if needed).

- `GET /api/v1/stores/{storeId}/invoices/{invoiceId}/payments`  
  to get on-chain payment details (txid, amount, confirmations).

- `GET /api/v1/server/info`  
  for a basic health/version check; we can surface this in the UI.

### 12.2 Data We Persist

We always persist **both** BTC and USD so accounting/debugging is easy later.

```json
{
  "invoiceId": "ABCD1234",
  "storeId": "STORE123",
  "status": "Settled",
  "amountBtc": 0.0025,
  "amountUsd": 168.32,
  "currency": "USD",
  "rateSource": "btcpay-store-rate",
  "txId": "f0e2a3...",
  "paidAt": "2025-10-31T16:12:45Z"
}

Notes:
	•	amountUsd = the USD value BTCPay calculated at invoice creation time, i.e. the locked rate.
	•	if BTCPay doesn’t return a fiat amount, we can query the invoice detail to get the original price and currency from BTCPay’s internal model.
	•	we store rateSource so we know where we got the number from if someone later changes store settings.

12.3 Sync Logic
	1.	poll BTCPay every intervalSeconds (default: 60s).
	2.	fetch invoices newer than lastSyncAt and with status == Settled.
	3.	for each invoice:
	•	fetch payments → ensure at least one confirmed on-chain payment
	•	build a BTCQBO payload (see next section)
	•	call BTCQBO inside BTCPay at /plugins/btcqbo/...
	4.	write success/failure + message to SQLite
	5.	update lastSyncAt

⸻

13. BTCQBO → QuickBooks Mapping

BTCQBO does the actual QuickBooks write. Sovereign Merchant orchestrates.

Modes:

Mode	Source (BTCPay)	Target (QBO)	Notes
Deposit	settled invoice/payment	Deposit / Sales Receipt	default for BTC-first / normie flows
Invoicing	settled invoice/payment	Payment applied to existing invoice	for QBO-first, accountant-friendly flows

Payload we send conceptually:

{
  "invoiceId": "ABCD1234",
  "amountUsd": 168.32,
  "amountBtc": 0.0025,
  "paidAt": "2025-10-31T16:12:45Z",
  "mode": "deposit",
  "notes": "Synced via Sovereign Merchant"
}

we still let BTCQBO decide the exact QBO object (Deposit vs Payment) because that logic lives with the plugin.

⸻

14. Error Handling & Retry Policy

we don’t want Blake calling you because of a transient 500.
	•	idempotent per invoice: we key retries by invoiceId, so we don’t double-post.
	•	retry on network / 5xx: exponential backoff + jitter, e.g. 5s → 15s → 60s → mark as error.
	•	auth errors (QBO token expired): try refresh once → if still bad, flip app state to ERROR and show “Reconnect QuickBooks.”
	•	BTCPay unreachable: surface “BTCPay not reachable at ” in the UI, don’t kill the worker.
	•	logs: every failed attempt goes into SQLite with timestamp, level, message, and (if present) invoiceId.
	•	manual retry: POST /api/sync/now?invoiceId=... to re-run a single invoice.

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

definition: Sovereign Merchant is the thing that, when someone clicks a “pay in bitcoin” link for a QBO invoice, talks to both QBO and BTCPay, generates a short-lived BTCPay invoice, and then reconciles the payment back to QBO.

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
