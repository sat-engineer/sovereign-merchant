# Sovereign Merchant – Reference Architecture & Deployment

## 1. Big Picture

Sovereign Merchant is meant to sit next to a self-hosted BTCPay Server and Bitcoin node, and give merchants:

- Customer-facing Bitcoin payments via BTCPay.
- Automatic bookkeeping in QuickBooks Online via a native, open-source integration.
- Infra they ultimately control, without getting trapped in SaaS or custodial processors.

**Recommended production architecture:**

- Run BTCPay + Sovereign Merchant on a home/office node (e.g. Umbrel, Start9).
- Front that node with a small, hardened VPS reverse proxy serving `https://pay.yourdomain.com`.
- Reverse proxy forwards requests over Tor or a private tunnel back to your node.

**Key custody (important):**

- BTCPay/Sovereign Merchant **do not need your private keys** in the recommended setup.
- Use:
  - an extended public key (xpub/ypub/zpub) → watch-only wallet, or
  - hardware wallet / PSBT / BTCPay Vault integration.
- Private keys stay in:
  - your hardware wallet, or
  - another external signer you control.
- BTCPay derives receive addresses from the xpub and never needs to hold your seed.  [oai_citation:0‡BTCPay Server](https://docs.btcpayserver.org/FAQ/Wallet/?utm_source=chatgpt.com)

The VPS is stateless and disposable. If it dies, you redeploy it; no funds are at risk.

---

## 2. Components

### 2.1 Home/Office Node (Umbrel / Start9 / bare metal)

**Runs:**

- Bitcoin node (and optionally Lightning)
- BTCPay Server
- Sovereign Merchant

**Stores:**

- BTCPay store config (including xpub / derivation scheme)
- Sovereign Merchant config
- Encrypted BTCPay API keys & QuickBooks tokens
- Local logs & reconciliation state

**Does *not* store (by recommendation):**

- Spending private keys (seeds)
- Custodial balances

**Responsibilities:**

- Create and manage BTCPay invoices.
- Receive BTCPay webhooks.
- Normalize BTCPay events and push them into QuickBooks Online using:
  - the merchant’s own Intuit app credentials,
  - via Sovereign Merchant’s `QuickBooksOnlineProvider`.
- Maintain accurate local audit trail.

---

### 2.2 Public Reverse Proxy (Minimal VPS)

**Runs:**

- Nginx / Caddy / Apache (pick your poison)
- Let’s Encrypt (or equivalent) for TLS

**Responsibilities:**

- Terminate HTTPS for `https://pay.yourdomain.com`.
- Forward only BTCPay/Sovereign Merchant endpoints to the node:
  - ideally over Tor hidden service (BTCPay supports this officially), or
  - over a secure VPN/tunnel.

BTCPay’s own docs recommend this kind of “VPS as reverse proxy to Tor” pattern to hide your node IP and simplify certs.  [oai_citation:1‡BTCPay Server](https://docs.btcpayserver.org/Deployment/ReverseProxyToTor/?utm_source=chatgpt.com)

**Does NOT:**

- Hold private keys.
- Store QuickBooks credentials.
- Run business logic (it’s just a smart pipe).

If compromised:
- Rebuild it.
- Rotate secrets (if any).
- Your node and funds remain under your control.

---

## 3. Why This Architecture

### 3.1 Benefits

- **Sovereign where it matters**
  - Payments, chain data, and accounting bridge run on a box you own.
  - Private keys stay on hardware wallets / external signers, not on the node or VPS.

- **Clean UX for customers**
  - `https://pay.yourdomain.com` feels like Stripe/Shopify.
  - They never see `.onion` URLs or weird ports.

- **Security**
  - Node is not directly exposed to the public internet.
  - Home IP stays hidden behind Tor/tunnel (with recommended setup).
  - Reverse proxy is isolated and easy to rebuild.

- **Cost-effective**
  - Tiny VPS (~$5–10/mo) vs. %
    fees and heavy SaaS.
  - BTCPay + Sovereign Merchant are open source; no per-transaction rake.

- **Aligns with BTCPay best practices**
  - Uses Greenfield API + webhooks for integration.  [oai_citation:2‡BTCPay Server](https://docs.btcpayserver.org/API/Greenfield/v1/?utm_source=chatgpt.com)
  - Encourages watch-only / hardware wallet setups, consistent with BTCPay guidance.  [oai_citation:3‡BTCPay Server](https://docs.btcpayserver.org/FAQ/Wallet/?utm_source=chatgpt.com)

---

## 4. Tradeoffs & Alternatives

### 4.1 Recommended: VPS Reverse Proxy + Home Node

**Pros**

- Best balance of:
  - security,
  - UX,
  - sovereignty,
  - and maintainability.
- Easy to standardize as your “production recipe” for merchants.

**Cons**

- One extra component (VPS) to manage.
- Requires minimal DevOps hygiene (updates, TLS renewal).

---

### 4.2 Home-Only (No VPS, direct exposure)

**Pattern**

- Port-forward 80/443 from router → reverse proxy/BTCPay on your node.
- `pay.yourdomain.com` points straight to your home IP.

**Pros**

- No VPS cost.
- Pure self-hosting flex.

**Cons**

- Home IP becomes a permanent public target:
  - regular automated scans and exploit attempts.
- Router + node must be kept very tight:
  - no default creds,
  - patched firmware,
  - strict firewall.
- ISP issues (dynamic IP, blocked ports).
- Easier to DoS your entire house.

**Use only if:**

- You absolutely want zero VPS,
- and you’re comfortable being your own security team.

---

### 4.3 Private-Only (No public checkout)

**Pattern**

- Expose BTCPay/Sovereign Merchant only over:
  - VPN,
  - Tailscale,
  - local network.

**Pros**

- Great for B2B, internal tooling, or lab environments.
- Strong privacy.

**Cons**

- Not suitable for “click & pay” consumer flows.
- Adds friction for customers.

Good for testing and some niche deployments; not the default for your “normie merchant” story.

---

## 5. Sovereign Merchant’s Role in the Stack

**Integration stance:**

- Uses BTCPay’s Greenfield API + webhooks to observe invoices and payments.  [oai_citation:4‡BTCPay Server](https://docs.btcpayserver.org/API/Greenfield/v1/?utm_source=chatgpt.com)
- Uses a first-party `AccountingProvider` abstraction to talk to accounting systems.
- v1 ships:
  - `QuickBooksOnlineProvider`
  - merchant-supplied Intuit app (BYO credentials, no shared app).

**v1 Scope (locked):**

- BTCPay-first reconciliation only:
  - Merchant issues invoices in BTCPay.
  - Customer pays.
  - Sovereign Merchant:
    - listens for settled (or relevant) events,
    - records corresponding entries in QuickBooks Online,
    - logs everything for audit/debug.

**v2+ (roadmap):**

- JIT “Pay in Bitcoin” links:
  - QuickBooks invoices gain a “Pay in Bitcoin” button.
  - On click, Sovereign Merchant:
    - reads QBO invoice,
    - creates a BTCPay invoice at current rate,
    - redirects customer,
    - reconciles on settlement.

All of this rides on the same architecture: node does the logic; VPS just fronts it.

---

## 6. Business / Services Layer (Optional but Real)

This doc is neutral, but your model can be:

- Software: MIT/OSS.
- Revenue: 
  - device setup,
  - BTCPay + Sovereign Merchant install,
  - domain + reverse proxy configuration,
  - “we’ll sit with your accountant / ops and make sure it’s right.”

Merchants already pay far more for:
- Stripe fees,
- QuickBooks add-ons,
- random consultants.

“$5–10 infra + one-time setup for a sovereign stack” is an easy pitch.

---

## 7. How This Relates to the Main Spec

- `product-and-tech-spec.md`:
  - how Sovereign Merchant is built (stack, API, sync logic).

- `architecture-and-deployment.md` (this doc):
  - how BTCPay + Sovereign Merchant + node + VPS fit together in production,
  - what’s recommended,
  - what’s optional.

The two together give:
- devs a clear implementation target,
- merchants a clear mental model,
- you a repeatable deployment story.