# eSIM provider layer (`api/providers/`)

All provider traffic flows through one interface (`types.ts`), selected by env:

```
PROVIDER=esimaccess   # eSIM Access — DEFAULT
PROVIDER=esimg        # eSIM Go v2.4 — legacy, kept intact for the switch
```

Flipping `PROVIDER` and restarting swaps the entire fulfilment path —
checkout webhook, coverage filter, usage polling, cancel — with **zero
app/site changes**.

## Files

| File | Role |
|---|---|
| `types.ts` | `EsimProvider` interface + normalized types. Contract: prices in USD, volumes in bytes, `esimTranNo` is the primary key wherever it exists |
| `rateLimit.ts` | Token bucket (8 req/s, burst 8) + exponential backoff (429/5xx/network, jittered). eSIM Access rate limit defense |
| `esimAccess.ts` | eSIM Access adapter. HMAC-SHA256 `RT-*` headers (ESIMA_ACCESS_CODE / ESIMA_SECRET_KEY), base `https://api.esimaccess.com/api/v1/open`. Normalizes ×10,000 prices → USD, bytes → GB, async provisioning (order → poll `/esim/query` by orderNo → ORDER_STATUS webhook fallback) |
| `esimGo.ts` | eSIM Go adapter — the pre-existing v2.4 integration (Bearer auth, `ESIMGO_SKU_{planId}` env mapping) wrapped to the same interface |
| `index.ts` | `getProvider()` registry + `planCoverage()` gate |

## eSIM Access specifics

- **Auth**: `signStr = timestamp + requestId + accessCode + body`,
  `RT-Signature = HMAC_SHA256(signStr, secretKey)`. If your account
  signs with the accessCode as key instead, set `ESIMA_SIGN_KEY=accesscode`.
- **Per-plan package overrides**: `ESIMA_PKG_GERMANY-UNL-7D=EU_7_30`
  (env name auto-sanitized: uppercased, non-alnum → `_`). An override
  pointing at a package absent from the live catalog resolves to
  "coming soon" — never silently falls back to guessing.
- **Coverage filter**: `planCoverage(planId)` returns
  `fulfillable | coming_soon | unknown`.
  - `coming_soon` → checkout renders the plan name with NO price, NO
    payment form; `create-payment-intent` refuses with 409
    `plan_coming_soon`. pricing.json prices are never shown for
    packages the active provider can't fulfil.
  - `unknown` (credentials absent) → normal display; the fulfilment
    auto-refund guarantee is the backstop.

## Webhook

`POST /api/webhooks/esimaccess` receives provider notifications:

- sender IP whitelist (provider's published IPs) — disable with
  `ESIMA_WEBHOOK_STRICT_IPS=0`, override list with `ESIMA_WEBHOOK_IPS`
- optional shared-secret header via `ESIMA_WEBHOOK_SECRET`
  (`x-jum-webhook-secret`)
- `ORDER_STATUS` re-queries the API for the install payload (per
  provider docs the notification doesn't carry the ICCID) and completes
  order docs idempotently via the checkout ledger's `providerOrderNo`
- `ESIM_STATUS` / `SMDP_EVENT` / `DATA_USAGE` / `VALIDITY_USAGE` stamp
  the latest provider state on matching orders (by `esimTranNo`)
- raw events are audit-logged to `providerWebhookEvents`

**Register on deploy** (one-shot):

```
curl -X POST https://jumesim.com/api/providers/setup \
  -H "Authorization: Bearer $PROVIDER_SETUP_TOKEN"
```

registers `https://jumesim.com/api/webhooks/esimaccess` via
`/webhook/save`, verifies via `/webhook/query`, and warms the catalog.
(eSIM Go webhooks are dashboard-configured — the setup route returns a
hint instead.)

## Order doc shape (Firestore, both providers)

```js
users/{uid}/orders/{orderId}            // + guestOrders/{email}/orders/{orderId}
{
  orderId, planId, provider, providerOrderNo,
  esimTranNo,        // PRIMARY key — prefer over iccid everywhere
  iccid, qrUrl, lpaString, smdpAddress, matchingId,
  status,            // 'processing' → 'active' (webhook completes)
  email, uid, topUpFor, paymentIntentId, amountCents, createdAt,
}
```

## Tests

```
node --test tests/esimaccess-adapter.test.mjs   # 26 offline tests (mock fetch)
ESIMA_ACCESS_CODE=… ESIMA_SECRET_KEY=… node scripts/test-esimaccess-live.mjs
```

The live script performs the acceptance flow against real credentials:
catalog load → test order → install payload (orderNo → QR/ICCID) →
usage query → optional cancel-for-refund. It skips cleanly (exit 0)
without credentials and costs a few cents of balance.
