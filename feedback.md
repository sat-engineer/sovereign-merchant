Reviewing the spec for gaps and issues.


[1 tool called]

Findings organized by category:

## Critical security issues

### 1. Missing OAuth CSRF protection
**Section 10.1, 8.5**: The OAuth callback (`/api/config/qbo/callback`) lacks CSRF token validation. An attacker could initiate OAuth and redirect to your callback with their code, linking their QBO account.

**Fix needed**: Generate a state parameter, store it server-side (session/DB), and validate on callback.

### 2. No API authentication
**Section 8**: All API endpoints are unauthenticated. Anyone with network access can trigger syncs, view logs, or reconfigure the system.

**Fix needed**: Add API key authentication or session-based auth (at minimum for write endpoints).

### 3. Encryption key management unspecified
**Section 6**: "Encrypted at rest with local key" — but where does the encryption key come from? If it's hardcoded or generated at startup without persistence, you'll lose data on restart.

**Fix needed**: Specify key derivation (e.g., from platform secrets, user-provided passphrase, or key management service).

### 4. HMAC secret management for payment links
**Section 18.3**: Payment link signing uses "server secret" but no details on generation, rotation, or storage.

**Fix needed**: Document secret generation, storage (encrypted in DB?), and rotation strategy.

### 5. Missing HTTPS enforcement details
**Section 6**: "HTTPS enforced... fallback to HTTP only if self-hosted/localnet" — this is vague. How do you detect "localnet"? Self-signed certs?

**Fix needed**: Specify certificate management (Let's Encrypt? platform-provided? self-signed warning?).

## Data flow inconsistencies

### 6. QBO-first flow not integrated into main architecture
**Sections 7 vs 17-18**: The main data flow (Section 7) describes BTCPay → QuickBooks. Sections 17-18 introduce QBO-first with dynamic invoice generation, but this isn't reflected in:
- Setup state machine (Section 9)
- Core data flow (Section 7)
- API schema (Section 8)
- Repository structure (Section 5)

**Fix needed**: Either integrate QBO-first as a core feature or clearly mark it as v2/experimental.

### 7. Missing API endpoints for QBO-first flow
**Section 18**: The flow mentions `/pay?qboInvoice=...` but this endpoint isn't in the API schema (Section 8). Also missing:
- Endpoint to generate signed payment links from QBO invoices
- Endpoint to check BTCPay invoice status during payment flow
- Webhook endpoint if BTCPay supports it

### 8. Unclear who creates the "Pay in Bitcoin" link
**Section 16**: You mention merchants adding "Pay in Bitcoin" links to QBO invoices, but how? Manual copy-paste? QBO plugin? Email template modification?

**Fix needed**: Specify the integration point and user workflow.

## Missing error handling and edge cases

### 9. Partial payments not handled
**Section 12.3**: You check for "at least one confirmed on-chain payment" but don't address:
- Multiple payments to the same invoice
- Partial payments (customer pays 80% of invoice)
- Overpayments

**Fix needed**: Specify reconciliation rules for partial/overpayments.

### 10. Invoice expiration/regeneration race conditions
**Section 17.1, 18.1**: If a customer clicks the payment link twice before the BTCPay invoice expires, do you create duplicate invoices? Reuse existing?

**Fix needed**: Track pending BTCPay invoice IDs per QBO invoice and reuse if unexpired.

### 11. Token refresh failure handling unclear
**Section 14**: You mention "try refresh once → if still bad, flip to ERROR" but don't specify:
- How often to check token expiry
- What happens to sync queue during refresh failure
- Whether to queue syncs or drop them

### 12. Missing idempotency for BTCQBO calls
**Section 14**: You prevent double-posting by `invoiceId`, but BTCQBO might need idempotency tokens if called multiple times (e.g., retries).

**Fix needed**: Specify idempotency token generation and handling for BTCQBO calls.

### 13. No handling for invoice status changes
**Section 12.3**: What if an invoice goes from Settled → Invalid/Expired between syncs? What if a payment gets reversed/refunded in BTCPay?

**Fix needed**: Define handling for status transitions and refunds.

## UX gaps

### 14. Setup flow doesn't explain reconciliation mode choice
**Section 9**: User must pick "Deposit" vs "Invoicing" but there's no guidance on which to choose. Section 7.2 has brief notes, but not in the UI flow.

**Fix needed**: Add clear explanations and maybe examples in the MODE_PENDING state.

### 15. No progress feedback during initial sync
**Section 3.1**: "Confirmation screen shows sync summary" — but what if there are 1,000 historical invoices? Users should see progress.

**Fix needed**: Stream sync progress or show "Syncing X of Y invoices..."

### 16. Missing "disconnect/reconnect" flows
**Sections 8-9**: No endpoint or UI to disconnect/reconnect BTCPay or QBO. Users might need to change API keys or reconnect after token expiry.

**Fix needed**: Add disconnect/reconnect endpoints and UI.

### 17. Sandbox detection might be too late
**Section 10.3**: You detect sandbox on callback, but users might have already gone through OAuth. Better to warn during the OAuth URL generation if using BYO keys.

**Fix needed**: Add validation/warning in the OAuth URL generation step.

## Single responsibility violations

### 18. API server does too much
**Section 4.2**: The API server handles:
- REST API endpoints
- Frontend static hosting
- OAuth flow
- Sync job scheduling
- Sync execution

**Better approach**: Split into:
- API server (Express/Fastify) — REST + OAuth
- Sync worker (separate service/process) — polling + sync logic
- Optional: Frontend server (or CDN)

This improves:
- Resilience (sync worker can crash without taking down API)
- Scalability (can scale workers independently)
- Debuggability (clearer logs)

### 19. Storage layer responsibilities mixed
**Section 4.2**: SQLite stores both:
- Configuration (API keys, tokens)
- Application logs (sync status, errors)
- Application state (sync queue, retry state)

**Better approach**: Consider separate tables/schemas, or move logs to a separate log file/system if volume is high.

## Technical gaps

### 20. Missing webhook support
**Section 12.3**: You poll every 60s, but BTCPay supports webhooks. Polling works, but webhooks are more efficient and real-time.

**Fix needed**: At minimum, document why polling was chosen over webhooks, or add webhook support as an option.

### 21. No rate limiting
**Section 8**: No mention of rate limiting on API endpoints. `/api/sync/now` could be abused to spam BTCQBO/QBO.

**Fix needed**: Add rate limiting (especially for `/api/sync/now`).

### 22. Missing storeId selection/management
**Section 12.1**: BTCPay APIs require `storeId`, but:
- How do you discover which stores exist?
- How do users pick a store (or all stores)?
- What if merchant has multiple stores?

**Fix needed**: Add store discovery endpoint and store selection in config.

### 23. Auto-discovery implementation undefined
**Section 8.3, 12.3**: "Platform-specific discovery" is vague. Start9 and Umbrel have different discovery mechanisms. No fallback if both fail.

**Fix needed**: Specify exactly how discovery works for each platform, plus timeout/fallback behavior.

### 24. Missing database migration strategy
**Section 5**: SQLite is mentioned but no migration strategy. What happens when you need to add columns or change schemas?

**Fix needed**: Specify a migration system (e.g., `node-db-migrate`, `knex migrations`, custom scripts).

## Minor but important

### 25. Log rotation details missing
**Section 6**: "Capped log size" — what's the cap? What happens when reached? Rotate files? Delete oldest?

### 26. Health check too simplistic
**Section 4.2**: `/healthz` should check:
- Database connectivity
- BTCPay reachability
- QBO token validity (not expired)
- Sync worker health

Currently it's just "fail-fast" but not clear what it checks.

### 27. Missing versioning strategy
No mention of:
- API versioning (`/api/v1/...`)
- Database schema versioning
- App version display in UI

### 28. Config export/import security
**Section 6**: Export includes encrypted secrets — how do you ensure the import file isn't tampered with? Add signature verification?

---

## Priority recommendations

**Critical (fix before v1)**:
1. Add OAuth CSRF protection (#1) ✅
2. Add API authentication (#2) ✅
3. Specify encryption key management (#3) ✅
4. Clarify QBO-first flow integration (#6) ✅

**High (address soon)**:
5. Add endpoints for QBO-first flow (#7) ✅
6. Handle partial payments (#9) ✅
7. Improve error recovery (#11)
8. Split sync worker from API server (#18) ✅

**Medium (nice to have)**:
9. Add webhook support (#20) ✅
10. Improve setup UX (#14, #15)
11. Add store selection (#22)

This is a solid foundation. Addressing the security items (#1-4) is essential before release.

extra safety: make webhooks fire-and-forget

super important: /webhooks/btcpay should never do the real work.

why?
	•	BTCPay expects fast 200
	•	if QBO is slow, you don’t want BTCPay to retry and send dupes
	•	you already have idempotency in the worker

Findings

- product-and-tech-spec.md:606 – Spec says we process only InvoiceSettled events and explicitly ignore InvoiceReceivedPayment / InvoicePaymentSettled. In BTCPay partial/underpaid invoices never reach Settled; they end as Expired with the PaidPartial additional status. As written we’ll miss every partial (and late) payment while the surrounding text claims partial reconciliation support.

Resolved:
- product-and-tech-spec.md:185 vs product-and-tech-spec.md:237 – Section 6 now lists the BTCPay webhook HMAC secret in the encrypted data set, matching the earlier statement.
- product-and-tech-spec.md:185 vs product-and-tech-spec.md:369 – API key rotation flow now documents regenerating the webhook secret and updating BTCPay automatically.
