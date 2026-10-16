# jumesim.com/checkout — guest web checkout

Single-page, guest-first checkout for Jum e-SIM plans, modeled on the
e-sim.io payment experience. Mobile-first, thumb-friendly, <2s load.

## Page layout (top → bottom)

1. **Order summary card** — plan name, country flag, data/validity,
   price (USD base + converted display via `/api/fx`). "10-min
   auto-refund guarantee" banner.
2. **Email field** — "Where should we send your eSIM?" (required,
   validated client-side and by Stripe receipt).
3. **Optional account checkbox** — "Create a Jum e-SIM account (sync
   across devices)", **unchecked by default**. Checkout works fully as
   a guest; the eSIM is delivered on the success page + by email.
4. **Stripe Payment Element** — one integration, all four methods:
   - **Apple Pay** — Safari, after domain verification (see checklist)
   - **Google Pay** — Chrome/Android (automatic)
   - **Link** — Stripe 1-click for returning users
   - **Card** — inline fields, brand detect, Luhn validation

   Wallets render automatically where supported; no PayPal or other
   wallets.
5. **Terms checkbox + lime "Pay $X.XX" CTA** — CTA stays disabled until
   the Payment Element reports complete AND terms are checked.
6. **Trust row** — "Secured by Stripe · Instant delivery · 10-min guarantee".

## Flow

- Plan arrives via `?planId=` (app link-out) or site browse
  (plan-picker fallback when the planId is unknown/missing).
- **Prices are validated server-side** (`api/checkout/plan.ts` +
  `api/lib/pricing.ts` → `pricing.json` + bundle table). Client-sent
  amounts are ignored everywhere; the PaymentIntent amount is computed
  on the server.
- `POST /api/checkout/create-payment-intent` → PaymentIntent with
  metadata `{uid?, email?, planId, topUpFor?, source:'web_checkout'}`,
  idempotency ledger row in `checkoutIntents/{piId}`.
- Payment succeeds → Stripe webhook `payment_intent.succeeded`
  (signature-verified, idempotent by payment_intent id) → eSIM Go
  order → Firestore:
  - account checkout: `users/{uid}/orders/{orderId}`
  - guest checkout: `guestOrders/{normalizedEmail}/orders/{orderId}`
- The success page polls Firestore every 2s (60s deadline) and shows
  instantly: **QR code + LPA string + install instructions (iPhone /
  Android) + [Copy code] + [Install instructions to my email] + [Open
  in Jum e-SIM app]** (`jumesim://order/{id}`). No account required to
  see the eSIM.
- **eSIM Go failure after payment** → automatic Stripe refund + ledger
  `failed_refunded` + the page shows "Payment refunded automatically".
- **Refreshing the success page never duplicates the order** — the
  webhook is the only writer and it dedupes on payment_intent id.

## Post-purchase account nudge

Guests see a soft prompt on the success page: "Create a password to
keep this eSIM forever" (email pre-filled). `POST
/api/checkout/convert-account` creates a Firebase Auth user and moves
every `guestOrders/{email}` doc to `users/{uid}/orders`, so the eSIM
appears in the app's My eSIMs on next sign-in. If the email already has
an account, the page tells the user to sign in and use "Restore
purchases". The nudge is strictly post-money — purchase never requires
an account.

## Analytics (POST /api/checkout/analytics)

Server-side allowlist (`api/checkout/analytics.ts`):

- `checkout_viewed {planId, source}`
- `method_selected {method}` (Payment Element change events:
  card / apple_pay / google_pay / link)
- `payment_success {planId, method}`
- `web_payment_failed {planId}`
- `guest_vs_account {guest, planId}`
- `delivery_viewed {planId}`
- `web_order_created {planId, orderId}`
- `web_checkout_started {planId}`
- `install_instructions_emailed {orderId}`

Events outside the allowlist are rejected with `unknown_event`.

## Server routes

| Route | Purpose |
|---|---|
| `GET /api/checkout/plan?planId=` | plan view (server-priced); no planId → popular list |
| `POST /api/checkout/create-payment-intent` | `{planId, uid?, email?, topUpFor?}` → `{clientSecret, paymentIntentId, publishableKey}` |
| `POST /api/checkout/webhook` | Stripe webhook (raw body, signature-verified, idempotent) |
| `POST /api/checkout/analytics` | funnel events (allowlisted) |
| `POST /api/checkout/email-instructions` | re-send install instructions (SendGrid; 503 without key — page degrades gracefully) |
| `POST /api/checkout/convert-account` | guest → account after purchase (moves orders to users/{uid}) |
| `POST /api/webhooks/esimaccess` | eSIM Access order-status notifications (completes 'processing' orders) |
| `POST /api/providers/setup` | deploy step: register webhook URL + warm catalog (Bearer PROVIDER_SETUP_TOKEN) |

## Provider layer & coverage

Fulfilment runs through the provider abstraction in `api/providers/`
(`PROVIDER=esimaccess` default, `esimg` = legacy eSIM Go). The plan
response includes a `coverage` field:

- `coverage: "coming_soon"` — the active provider can't fulfil this
  package yet: the page shows the plan name with NO price and no
  payment form, and offers available alternatives. Money is never taken
  for unfulfillable plans (`create-payment-intent` → 409).
- `coverage: "unknown"` — provider credentials absent on this
  deployment; normal display, fulfilment auto-refund is the backstop.
- absent/`fulfillable` — normal checkout.

## Env vars (server-only, never in the client bundle)

- `STRIPE_SECRET_KEY` — without it, create-payment-intent returns 503
  `payments_unavailable` and the page shows an explicit
  "Payments temporarily unavailable" state (no fake session).
- `STRIPE_PUBLISHABLE_KEY` — returned with the payment session; the
  static page falls back to its built-in placeholder when absent.
- `ESIM_GO_API_KEY`, `X-Merchant-Id` via `ESIMGO_MERCHANT_ID` —
  eSIM Go v2.4 order creation. Per-plan SKU override:
  `ESIMGO_SKU_{PLANID}` (e.g. `ESIMGO_SKU_GERMANY-UNL-7D`),
  fallback `ESIMGO_DEFAULT_SKU`.
- `FIREBASE_SERVICE_ACCOUNT` — Admin SDK for webhook writes + account
  conversion; absent → webhook/convert degrade gracefully.
- `SENDGRID_API_KEY` — instruction re-send emails.

## Apple Pay domain verification checklist

1. Stripe Dashboard → Settings → Payment methods → Apple Pay →
   create merchant ID `merchant.com.jumesim`.
2. Add domain `jumesim.com` (and `www.jumesim.com`) — Stripe serves a
   domain-verification file to download.
3. Serve it at **both**:
   - `https://jumesim.com/.well-known/apple-developer-merchantid-domain-association`
   - `https://www.jumesim.com/.well-known/apple-developer-merchantid-domain-association`
   Content-Type must be `text/plain`, served with the exact file bytes
   (no HTML wrapper, no redirect).
4. Apple Pay tile renders in Safari only after verification succeeds;
   Google Pay in Chrome/Android is automatic with no extra steps.

## App link-out contract

The app never processes payment. "Buy on jumesim.com" opens:

```
https://jumesim.com/checkout?planId={planId}[&uid={firebaseUid}][&topup={iccid}][&email={email}]
```

`uid` links the order into `users/{uid}/orders` (visible in the app's
My eSIMs within seconds of the webhook fulfilment). Without `uid` the
checkout is a pure guest checkout.
