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

**High (address soon)**: 5. Add endpoints for QBO-first flow (#7) ✅ 6. Handle partial payments (#9) ✅ 7. Improve error recovery (#11) 8. Split sync worker from API server (#18) ✅

**Medium (nice to have)**: 9. Add webhook support (#20) ✅ 10. Improve setup UX (#14, #15) 11. Add store selection (#22)

---

Looking through this comprehensive spec, here are the gaps I'd flag for a v1 release:

## Critical Missing Items

### 1. **BTCQBO Plugin Verification**

- No check during setup to verify BTCQBO plugin is actually installed in BTCPay
- What's the error message if it's missing?
- Should you include installation instructions or auto-detect and warn?

### 2. **QBO Account Mapping Configuration**

- **Deposit mode** creates deposits but doesn't specify WHICH QBO account
- Need UI for merchant to select: deposit account, income account, Bitcoin asset account
- Should have sensible defaults but allow customization

### 3. **Database Migrations**

- Schema mentioned but no migration tool specified (knex? node-pg-migrate?)
- How do schema changes work during updates?

### 4. **Update/Upgrade Strategy**

- How does `/data` volume persist during container updates on Start9/Umbrel?
- Do you need migration scripts between versions?
- How to handle breaking changes?

### 5. **BTCPay Store Selection**

- Auto-discovery mentions "detect BTCPay" but what if multiple stores exist?
- Need UI to select which store to sync, or explicitly state "single store only for v1"

### 6. **Webhook Delivery Failures**

- What if Sovereign Merchant is down when BTCPay sends webhook?
- Does BTCPay retry? For how long?
- Should you query missed invoices on restart?

## Important Gaps

### 7. **Testing Strategy**

- No mention of test coverage requirements
- E2E testing approach for OAuth flows?
- Mock BTCPay/QBO for CI/CD?

### 8. **Rate Limiting**

- Auth endpoint has limits, but what about:
  - `/api/sync/now` (prevent sync spam)
  - Webhook endpoint (prevent DoS)
  - QBO API call limits (Intuit has daily quotas)

### 9. **Observability**

- Beyond `/healthz`, consider:
  - Prometheus metrics endpoint
  - Structured logging format (JSON?)
  - Event tracking for analytics

### 10. **Network/DNS Requirements**

- Webhook URL must be reachable by BTCPay - how is this configured?
- SSL/TLS requirements for production webhooks
- Local network discovery details for Start9/Umbrel

### 11. **Documentation Plan**

- User manual (screenshots of setup flow)
- Troubleshooting guide (common errors)
- API documentation (OpenAPI spec?)
- Operator runbook for Blake

### 12. **Currency Support Scope**

- Spec only shows USD examples
- BTCPay supports many currencies - is this USD-only for v1?
- Should explicitly state limitation

## Nice-to-Haves (Consider for v1)

### 13. **First-Run Tutorial/Tooltips**

- Onboarding wizard with explanations
- Contextual help for each setup step
- Link to video walkthrough

### 14. **Diagnostic Export**

- "Download debug bundle" button for support
- Sanitized logs + config (no secrets)
- System info (BTCPay version, QBO connection status)

### 15. **Concurrent Operations**

- Race condition handling: webhook + manual sync + periodic sync
- Database locking strategy (SQLite WAL mode mentioned, good)
- Idempotency key format should be specified exactly

### 16. **Customer Notification Handling**

- Who sends the "payment received" email?
- Does Sovereign Merchant send any notifications?
- Should integrate with BTCPay's email settings?

### 17. **Start9/Umbrel Specifics**

```yaml
# Missing from apps/ folders:
- Health check interval/timeout values
- Resource limits (memory, CPU)
- Dependency declarations (BTCPayServer)
- Backup include/exclude paths
- Port mappings and conflicts
```

### 18. **Session Security**

- API key in localStorage has no expiration
- Consider: session timeout, "keep me signed in" option
- Security best practice: warn about shared computers

## Questions to Resolve

1. **BTCQBO endpoint URL** - You mention calling `/plugins/btcqbo/...` but what's the exact endpoint? Is this documented?

2. **QBO webhook support** - Section 7.2 mentions "QBO can only deliver invoice events" but QBO webhooks aren't implemented anywhere. Do you need QBO webhooks or is polling sufficient?

3. **Bitcoin address reuse** - Each BTCPay invoice gets unique address. Any privacy considerations to document?

4. **Sandbox detection** - You mention detecting sandbox realmIds follow "known patterns" - what are these patterns?

5. **Multi-payment reconciliation** - If customer sends 2 transactions before first confirms, how do you handle the race?

## Suggested Additions

### Section 19: **Testing & Quality Assurance**

- Unit test coverage target (80%?)
- Integration test scenarios
- Manual QA checklist before release

### Section 20: **Deployment Checklist**

- Pre-flight checks before packaging
- Smoke test procedures
- Rollback plan

### Section 21: **Support & Maintenance**

- How Blake reports issues
- Telemetry/crash reporting (opt-in?)
- Update notification strategy

## Overall Assessment

The spec is **very thorough** and well-structured. The main gaps are around:

1. **Operational concerns** (updates, backups, monitoring)
2. **QBO configuration details** (account mapping is critical)
3. **BTCQBO integration specifics** (endpoint URLs, error codes)
4. **Edge case handling** (multiple stores, concurrent operations)

This is solid for v1 if you address the critical items. The nice-to-haves can wait for v1.1.
