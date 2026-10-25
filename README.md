# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

---

## Module 5 — Choose Your Number (caller ID rental)

- **Screens**: `/number/country` (pick rental country, search + dial-code badges + ID-check flags + "Use same as my eSIM" quick-pick) → `/number/pick` (E.164 inventory, Voice/SMS chips, "Show more" pagination, waitlist for sold-out countries, KYC gate sheet) → `/number/verify` (6-digit PIN, 60 s resend, 3 attempts → 5-minute cooldown).
- **Dialer integration**: calls require an active rented number as caller ID; numbers normalized to E.164 with libphonenumber-js; calls blocked below 60 s of destination-rate credit with an inline top-up sheet.
- **Billing**: monthly rental priced in `public/pricing.json` under `numberRental` (never hardcoded); 3-day grace period after expiry, then the number returns to inventory; one active rental per user at MVP (switching releases the old number).
- **Provider**: `src/providers/number.ts` — `NumberProvider` interface with `MockNumberProvider` (deterministic 10-number fake inventory per country, demo SMS code surfaced honestly in the UI). Swap to the live server by implementing the same interface against `server/numbers-server.mjs`.
- **Server**: `node server/numbers-server.mjs` serves `/numbers/available`, `/numbers/rent`, `/numbers/verify`, `/numbers/release`, `/numbers/renew`, `/numbers/resend`, and `/webhooks/rental-expiry`. Keys come from env vars only (see `server/.env.example`); without Twilio keys it runs in dry-run mode.

---

# Module 6 — Production Hardening (go-live)

## Architecture
- **Client** (this app): React + TypeScript. Holds **zero secrets**. All provider
  and payment traffic goes through the production server (`CONFIG.serverUrl`).
- **Server** (`server/production-server.mjs` — orders/payments/email,
  `server/numbers-server.mjs` — number rental). Holds every key in env vars.
- **Provider swap**: `CONFIG.provider = 'mock' | 'esimgo'` in `src/config.ts`.
  The `EsimGoProvider` implements the same `EsimProvider` interface as the mock,
  so no screen changes are needed at go-live.

## Payments mode (store review implications)
`CONFIG.payments.mode`:
- **`'web'`** (current web build): Stripe checkout with three methods —
  **Apple Pay** (iOS only), **Google Pay** (Android only), **Card** (always).
  Wallet rows render only when enabled in config, on a real device build (never
  in a browser preview), and when the platform SDK reports the wallet can pay
  (`ApplePaySession.canMakePayments` / `PaymentRequest.canMakePayment`). The
  native build presents wallets through `@stripe/stripe-react-native`'s
  PaymentSheet on the same PaymentIntent as the card: Apple Pay with
  `merchantIdentifier` + `supports3DS` capability, Google Pay with
  `merchantCountryCode: "US"`, `merchantName: "Jum e-SIM"` and
  `testEnv: !isProduction`.
  Wallet/card flags live in **`config/payments.json`**
  (`applePay.merchantId: "merchant.com.jumesim"`, `googlePay.merchantName`,
  `card.enabled`) — imported by `src/config.ts`; env vars
  (`VITE_APPLE_MERCHANT_ID`, `VITE_GOOGLE_PAY_MERCHANT_NAME`) override the file
  for native builds. Web fallback uses `PaymentRequest` with
  `environment: TEST` outside production builds.
  On iOS, selling digital goods inside a native app requires IAP — see below.

### Wallet platform requirements (go-live)
- **Apple Pay**: create the merchant ID `merchant.com.jumesim` in Apple
  Developer, generate the **payment processing certificate**, and upload it in
  the **Stripe dashboard** (Settings → Payment methods → Apple Pay). Without
  the cert the sheet fails merchant validation on real devices.
- **Google Pay**: no certificate needed, but the APK/AAB must be **signed** for
  Google Pay to show real cards — until the app is signed for release, Google
  Pay runs in **TEST** env with Stripe test cards only (`testEnv: !isProduction`
  keeps this automatic).
- iOS `LSApplicationQueriesSchemes` stays as configured (WhatsApp deep link);
  wallets don't need additional queries.
- **`'iap'`** (native Expo build): payments route through App Store / Play
  billing instead of Stripe. Apple requires IAP for digital content in iOS apps;
  Google Play allows either. The README-native build sets `'iap'` on iOS.
  Document this choice in the App Store review notes to avoid rejection.

## Go-live checklist
1. `cp .env.example .env` and fill every variable (server-side only).
2. eSIM Go: create API key → `ESIM_GO_API_KEY`; whitelist the server IP.
3. Stripe: switch test → live keys; set `STRIPE_WEBHOOK_SECRET`; attach the
   Apple Pay merchant ID + payment processing certificate (`VITE_APPLE_MERCHANT_ID`,
   `VITE_GOOGLE_PAY_MERCHANT_NAME`).
4. Mail: create `support@jumesim.com` (Resend or SendGrid), set `ADMIN_EMAIL`.
5. Set `CONFIG.provider = 'esimgo'` and `VITE_SERVER_URL` to the production API.
6. Observability: `VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN` (+ release tagging and
   source-map upload in CI). Verify all 16 analytics events in the dashboard.
7. Analytics verification: Profile → Diagnostics shows the local event log —
   every event in `src/types/index.ts` must appear during a test purchase.
8. App Store / Play: hosted Privacy Policy / ToS / Refund pages live at the
   URLs in `CONFIG.legal`; data-safety form answers — collected: email,
   purchase history, device ID; **no location tracking**.

## Reliability & abuse (implemented)
- Retry with exponential backoff, max 3 attempts, on all provider/payment calls
  (`lib/retry.ts` client, `withRetry` server).
- Offline mode: catalog cached 24 h (`lib/offline.ts`); purchased eSIMs are
  local-first and always visible.
- Rate limits: client 5 order attempts/min/device; server 5/min/IP.
- Disposable-email domains blocked client + server; same-card >3 eSIMs/24 h
  → order held for manual review.
- Idempotency keys on order creation; kill-app-mid-checkout marker shows
  "Payment pending" on relaunch — no duplicate order, no double charge.
- Stripe: authorize-only (`capture_method: manual`) → capture after the
  provider confirms; any provider failure voids the authorization — the user
  sees "Payment could not be completed — you were not charged."
- Webhook signatures verified (`stripe.webhooks.constructEvent` equivalent);
  unsigned events are rejected with 400.
- Server logging: every createOrder / confirm / refund / webhook logged with
  outcome + provider request IDs; weekly admin digest email (sales, failures,
  refund rate) at `GET /v1/admin/digest`.

## Refund flow
Support triggers `POST /v1/refund { orderId }` from the order detail (or the
in-app Help surface): Stripe refund → eSIM Go cancel → customer email. Guarded
by the provider activation window (`CONFIG.activationWindowMinutes`).

## Rollback plan
1. **Full demo revert**: `CONFIG.provider = 'mock'` → app runs on the mock
   instantly, no server needed.
2. **Payments rollback**: point `VITE_SERVER_URL` at the previous server
   version (every save of this project is a restorable version — roll back via
   the version manager).
3. **Country kill switch**: add ISO codes to `CONFIG.disabledCountries` — the
   country disappears from the catalog without a deploy.
4. **Payments mode switch**: `CONFIG.payments.mode` flips between web checkout
   and IAP in the native build.
5. Server rollback: redeploy the previous `server/` snapshot; env vars are
   independent of code.

## Acceptance-criteria mapping
| Criterion | Where |
| --- | --- |
| No secrets/keys/test cards in repo | all keys env-only; `.env.example` documents the full set |
| All 16 analytics events | `src/types/index.ts` + Diagnostics viewer on Profile |
| Graceful provider outage, no charge | authorize-only + void path; user toast + support CTA |
| Kill app mid-checkout → no dup | pending-order marker + idempotency keys + webhook reconcile |
| Refund test order | `POST /v1/refund` (Stripe refund + eSIM cancel + email) |

---

## Module 7 — Post-Purchase Connection Guide

- **"Get connected" screen** (`/setup/:orderId`): shown automatically after the Installation screen and always reachable from My eSIMs / order detail (active plans only).
- **Self-checking 6-step checklist**: Install eSIM (auto-detected from order status), Turn on line (deep links `App-Prefs:ROOT=CELLULAR` / Android roaming settings), Enable Data Roaming (marked CRITICAL + "MOST COMMON FIX" with the no-surprise-bills explanation), Set as Cellular Data line, APN `jum` (conditional), Test connection.
- **Connection test**: probes the numbers server `/health` with an 8s timeout. Success: "You're connected 🎉 — {ms}ms · Jum e-SIM ({country})" + Start browsing. Failure: auto-opens the troubleshooter — never a dead end.
- **Troubleshooter decision tree**: airplane-mode reset → roaming toggle → manual network selection → APN entry → expired-plan top-up sheet → Get help with order ID pre-filled. Every fix ends with **Retest**.
- **Support safety net**: every screen shows `Stuck? support@jumesim.com` + Copy order ID. Every checklist step, fix, and test result is appended to the order's setup log (`Setup history` section on the order detail page) so support sees exactly what the user tried.
- **Per-eSIM persistence**: progress stored under `jum-esim:setup:{iccid}:v1`.
- **Analytics**: setup_step_viewed, setup_step_completed, connection_test_passed, connection_test_failed (step + reason code), troubleshoot_fix_applied, support_opened_from_setup.

### Acceptance (verified)
Fresh purchase shows only step 1 incomplete → install auto-reflects from OS state → failed test always offers a next action → success shows connected banner + green chip → progress persists across reload → reachable from My eSIMs → setup history readable from the order ID.

### Settings deep links (guarded)

- Every settings open goes through `canOpenUrl()` first (the web equivalent of `Linking.canOpenURL`) — a rejected or false probe never leaves a dead button: the step flips to an inline fallback ("Couldn't open Settings automatically — go to: Settings → Cellular" / "Settings → Network & internet") and the failure is written to the order's setup log (`settings_open_failed`) so support sees it.
- **iOS (installed PWA):** `app-settings:` hands off to Settings with Jum e-SIM at the top; button "Open Settings" + caption "You'll see Jum e-SIM at the top."
- **Android (installed PWA):** intent `android.settings.WIRELESS_SETTINGS` / `DATA_ROAMING_SETTINGS` / `DATA_USAGE_SETTINGS`; button "Open Network Settings". If the intent can't fire, the button is hidden and the manual path replaces it — no broken buttons in any environment.
- **Preview / browser tab:** detected via `display-mode: standalone`; all settings buttons are replaced by written path instructions (both platforms) and a dev-mode banner shows "Deep links to system settings only work on a real device."
- Verified across three simulated environments (preview, iPhone PWA, Android PWA) in `tests/m7-settings-links.py`.

---

## Backend — Vercel serverless functions (Module 8)

Node/TypeScript functions in `api/`, deployable as-is to Vercel zero-config.
The client **never** calls eSIM Go or Stripe directly — every provider/payment
call goes through these endpoints, and all secrets are server-side env vars.

### Endpoints

| Route | What it does |
|---|---|
| `POST /api/create-payment-intent` | Validates `planId` against `api/data/pricing.json` (price authority — client price must match to the cent, else `409 {expected}`), returns a Stripe-shaped `{clientSecret, amount, currency, mock:true}`. Unknown plan → `409`. |
| `POST /api/confirm-order` | Simulates eSIM Go in MOCK MODE: creates a mock order `{orderId, iccid, qrUrl, lpaString, smdpAddress, matchingId, expiresAt, ...}`, stores it, returns the install payload. Enforces: `400 invalid_email` / `409 price_mismatch` / `402 payment_failed_no_charge` (clientSecret containing `declined`) / idempotent replay via `Idempotency-Key` header (same key → same order). |
| `POST /api/refund` | Marks the order `refunded` (`404 order_not_found` if unknown). |
| `POST /api/webhooks/esimgo` | Ready for real eSIM Go webhooks — logs (type, headers, body) and acknowledges `200 {received:true}`. Verify the signature here before trusting events in live mode. |
| `POST /api/calls/balance` | Server-authoritative call-credit balance. The app never self-decrements — it renders only what the server reports. |
| `POST /api/calls/payment-intent` | Stripe PaymentIntent for a call-time pack (`$3/$5/$10/$20` — server is the price authority). |
| `POST /api/calls/credit` | Credits a pack after payment; **idempotent per paymentIntentId** (a retried tap can never double-credit). Mock clientSecret containing `declined` → `402 payment_failed_no_charge` (pack revoked, never charged). |
| `POST /api/calls/start` | Path A (in-app VoIP): checks balance **before** connect (≥ 60s at the destination rate, else `402 insufficient_credit`), snapshots the rate, refuses emergency numbers (`112/911/999` → "use your regular SIM"), one active call per account. Mock → simulated session (ring 3s, fake answer), `token: null`. Live → mint a Twilio Voice token here. |
| `POST /api/calls/end` | Bills by the second at the start-time rate snapshot (`rate/60`). Unanswered/busy (`durationSec: 0`) → no charge. Balance is clamped — never negative. |

### Secrets & configuration

All secrets are env vars — **none ship in the client bundle**:

- `ESIM_GO_API_KEY` — used by the live branch of `/api/confirm-order`
- `STRIPE_SECRET_KEY` — used by the live branch of `/api/create-payment-intent`
- `MOCK_MODE=true` — bypasses all real calls; every response is a deterministic fake shaped exactly like the live payload
- `EXPO_PUBLIC_APP_URL` — **the single public base URL** (`https://jumesim.com`). `src/config.ts` exposes it as `CONFIG.siteUrl`; every absolute link — checkout redirects, install/email links, legal pages, deep links — reads from it. Never hardcode a domain in a component. (`VITE_APP_URL` is the web alias; `EXPO_PUBLIC_CHECKOUT_URL` may still override the store base.)
- `APP_ORIGIN` — server-side comma-separated CORS allowlist; must be `https://jumesim.com` in production. In MOCK MODE `localhost`/`127.0.0.1` any port are also allowed for the local harness — that exception is dev-only and never ships.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — optional Upstash Redis REST order store for multi-instance serverless; without it MOCK MODE keeps orders in memory

`.env.example` documents every variable.

### Web checkout — `/checkout/` (guest, static sub-site)

`checkout-site/` builds verbatim into `dist/checkout/` (synced on every
build — never edit `dist/checkout` directly). Static HTML + JS; the only
runtime dependency is the API. Details live in `checkout-site/README-checkout.md`.

- One **Stripe Payment Element** renders Apple Pay / Google Pay / Link /
  card where the browser supports them; wallets appear automatically.
- **Missing Stripe env → designed "payments unavailable" state**
  (`create-payment-intent` → `503 payments_unavailable`; the page shows
  an explicit disabled state + `web_checkout_unavailable` analytics).
  No fake payment UI, no decorative "Secured by Stripe" claims when the
  real flow isn't live.
- **Publishable key** travels with the session response
  (`publishableKey`), read from `STRIPE_PUBLISHABLE_KEY` or
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — the static page never hardcodes
  a key.
- **Webhook is the source of truth** (`api/checkout/webhook.ts`):
  signature-verified, idempotent (replayed twice → exactly one order) →
  provider adapter creates the eSIM → install payload stored → email.
  Provider keys absent → honest "order confirmed — delivery within a few
  minutes" state + admin alert; never a fake QR.

### Apple Pay domain verification (go-live)

The file `public/.well-known/apple-developer-merchantid-domain-association`
ships as a clearly-marked PLACEHOLDER (this path must exist on the domain).
To enable the Apple Pay button:

1. Stripe Dashboard → Settings → Payments → Apple Pay → "Add new domain":
   add **jumesim.com** and **www.jumesim.com**.
2. Download the generated association file (hex-encoded PKCS#7 blob).
3. Replace the placeholder contents with that exact blob (same path,
   same filename), commit, push, wait ~1 min, hard-refresh.
4. Verify: `curl https://jumesim.com/.well-known/apple-developer-merchantid-domain-association`
   returns the blob; then click "Verify" in the dashboard for both domains.

Google Pay needs no verification — it appears in Chrome automatically
once live keys + HTTPS are active.

### Top-up model (OneSIM, honest)

A **top-up extends the SAME eSIM profile on the SAME iccid** — same
country/plan family via the provider's top-up endpoint. It **cannot**
convert a Germany-only eSIM into a Japan eSIM; that's a provider
constraint, stated in the UI and here. The true "one eSIM, many
countries" experience is the **regional/global bundles**: one profile
roaming across the bundle's countries, top-ups included — those are
surfaced as the "Travel everywhere on one eSIM" upsell with the region
picker. Orders persist per user (Firestore `users/{uid}/orders`), so
top-ups always target the right iccid; localStorage is an offline cache.
My eSIMs shows both actions per eSIM: **Top up** (same family) and
**Add another country** (new eSIM, new iccid).

### Security — `ESIM_GO_API_KEY` boundary, request hardening, rotation

- **Storage**: the key lives only in the host environment / gitignored
  `.env.local` (`.gitignore` lines: `.env`, `.env.local`, `.env.*`). It is
  never echoed, logged, or shipped — the boot log prints
  `key present (len N)` (length only).
- **Server boundary**: the only key holder is `api/providers/esimGo.ts`
  (plus the standalone `server/production-server.mjs`, which reads the same
  `process.env.ESIM_GO_API_KEY`). Zero occurrences of `api.esim-go.com` in
  `src/`; the client never sees the key or the provider base URL.
- **Auth gate**: provider-touching routes require a Firebase ID token
  (`Authorization: Bearer <idToken>`, verified against Google's public
  certs in `api/lib/auth.ts` — no external deps) **or** the
  server-to-server `PROVIDER_SETUP_TOKEN` (`Bearer` or `x-server-token`).
  Unauthenticated → `401`. The shipped guest-checkout flow is unaffected:
  it uses `/api/checkout/*`, never the gated legacy `/api/confirm-order`.
- **Rate limiting**: key-bearing routes sit behind a per-IP token bucket
  (capacity 10, refill 10/min) → `429` + `Retry-After`. In the standalone
  production server the public order endpoint stays open (guest checkout;
  protected by Stripe payment + price authority + disposable-domain and
  card-velocity checks) while `/v1/esimgo/*` admin routes are gated.
- **Audit log**: every request logs timestamp, request-id, method, route,
  status, latency; provider calls log path/status/upstream request-id.
  Client error responses carry only sanitized codes — internals stay in
  the server log.
- **Rotation**: ONE key name everywhere (`ESIM_GO_API_KEY`). To rotate:
  eSIM Go dashboard → generate a new key → update the env var on the host
  → restart → revoke the old key. No code change. If a key ever appears in
  git history, rotation is **mandatory, not optional** — revoke it and
  issue a fresh one.

### Local development

```bash
npm install
npm run api        # bundles api/*.ts with esbuild, serves /api/* on :8789 (MOCK_MODE=true)
npm run dev        # vite dev on :3000, proxies /api → :8789
# or: npm run build && npm run preview   (preview proxies /api the same way)
```

### Deploy to Vercel

1. Push the repo. `vercel.json` already sets `framework: vite`, `outputDirectory: dist` — Vercel builds the frontend and auto-detects `api/*.ts` as serverless functions in the same deployment (same-origin `/api/*`, no CORS issues, no `VITE_API_URL` needed).
2. `vercel env add MOCK_MODE true` (production + preview).
3. `vercel env add APP_ORIGIN https://jumesim.com` (comma-separate multiple domains).
4. `vercel --prod`.

### Flipping MOCK_MODE=false (go-live)

Set `MOCK_MODE=false` in the Vercel dashboard and add the real keys
(`ESIM_GO_API_KEY`, `STRIPE_SECRET_KEY`). The live branches are marked
`LIVE MODE` in `api/create-payment-intent.ts` and `api/confirm-order.ts`:
wire the Stripe SDK + eSIM Go REST calls there (both libraries take the same
request/response shapes as the mock payloads, so the client needs no changes).
Test the full flow on a preview deployment before promoting.

### Rollback

- **Backend broken?** Set `CONFIG.provider = 'mock'` in `src/config.ts` —
  the app reverts to the fully client-side MockProvider instantly (catalog,
  orders, refunds all local). One-line change, no backend involved.
- **One endpoint misbehaving?** Vercel lets you roll back to the previous
  deployment independently of the frontend.

---

## Module 9 — Legal pages + support system (Jum Assistant)

### Legal pages (one source, two surfaces)

- Source of truth: `src/legal/*.md` (markdown with `{{token}}` placeholders)
  + `src/legal/legal-values.json` (operator, retention, refund window,
  governing law — **review with a lawyer before launch**, the defaults are
  placeholders).
- **In-app**: `/legal/privacy`, `/legal/terms`, `/legal/refund` — dark theme,
  rendered from the same markdown (`src/components/Markdown.tsx`), "Last
  updated" + back button, `legal_page_viewed` analytics. Linked from Help.
- **Hosted static**: `public/{privacy,terms,refund}/index.html` — same content
  as standalone HTML served at jumesim.com/privacy, /terms, /refund with zero
  server rewrites. Regenerate after any edit:

  ```bash
  node scripts/build-legal.mjs
  ```

### Support chat ("Jum Assistant")

- **Help → Contact support** opens `/support/chat` (never a dead link; the
  old mailto row is gone). If the chat backend is unreachable the screen
  shows a banner + a prefilled email-app fallback (`src/lib/support-email.ts`)
  with order ID, app version, OS/device, plan, and checklist/test history.
- **Chat screen** (`src/pages/SupportChat.tsx`): WhatsApp-style thread, lime
  send button, quick-reply chips, refund confirmation cards, escalation
  handoff. Every message POSTs `{message, history, orderContext}` to
  `/api/support/chat`; the bot answers from orderContext (specific, not
  generic).
- **Modes** (`VITE_SUPPORT_MODE`, see `.env.example`):
  - `backend` (default) → `/api/support/chat` (`api/support/chat.ts`).
    `MOCK_MODE=true` **or** empty `OPENAI_API_KEY` → canned decision tree;
    with a key it calls any OpenAI-compatible endpoint whose system prompt
    embeds `api/kb.md` (the knowledge base — plan FAQs, Get-Connected
    troubleshooting tree, exact refund rules, per-OS install steps).
    `kb.md` ships with the function via `includeFiles` in `vercel.json`.
  - `mock` → local canned tree (`src/lib/support-bot.ts`), zero network.

### Guardrails (enforced in both modes)

- A refund executes **only** after the explicit confirmation card
  ("Refund $X.XX to your card?" → Confirm → `/api/refund`). The LLM can only
  emit a `[[REFUND_CONFIRM orderId=… amount=…]]` marker that the server turns
  into a card — it can never execute one.
- After 2 failed fix attempts (or on request): "Connecting you to our team" —
  transcript + order context go to support@jumesim.com, user is told to
  expect an email reply within 24h.
- The bot never invents coverage/prices/policies — it deflects to human
  support instead. Always labeled "AI assistant".
- Analytics: `chat_opened`, `chat_message_sent`, `bot_resolved`,
  `bot_escalated_human`, `refund_confirmed_via_chat`.

## Module 10 — Calls tab + WhatsApp support

### Calls tab (4th tab: Home · Explore · Calls · Profile)

- **Dialer** with keypad (0–9, `*`, `#`, long-press backspace to clear),
  searchable country picker (all 190+ destinations with flag / dial code /
  rate from `src/data/call-rates.json`), and auto-switch: typing `+81`
  switches the destination to Japan with its rate. Numbers normalize to
  E.164 via `libphonenumber-js`.
- **Balance is server-authoritative** (`/api/calls/*` above) — the app never
  decrements credit; it renders what the server reports and refreshes after
  every mutation. The tab-bar badge dot fires when credit drops below 60s at
  the selected destination's rate.
- **Buy Time sheet** (`$3/$5/$10/$20`, live "≈ X min to [country]", credit
  expires 12 months after purchase): same Stripe flow as eSIM checkout, with
  a confirm step on repeat purchases (biometric confirm on native builds).
  Balance updates instantly on success.
- **Active call**: ringing (mock: 3s) → in-call with elapsed time, live
  credit countdown, mute / speaker / DTMF keypad, red hang-up. At 60s of
  credit left: tone + "Top up to keep talking" banner — a mid-call top-up
  credits without dropping the call. End summary: `4:32 · $0.36 used ·
  18:04 remaining`.
- **Call history** (device-local): number, flag, duration, cost, timestamp;
  tap → redial, delete per row (swipe on native). Unanswered calls show
  **No charge**.
- Caller-ID plumbing (Path A): no rented number → inline sheet "Get a number
  so people see who's calling", else "Continue anyway — calls show as
  Unknown". Rates regenerate from the catalog: `node scripts/gen-call-rates.mjs`.

### WhatsApp Business support

- One number, defined once in `config/support.json`
  (`{ "whatsappNumber": "23233129788" }`), imported into `CONFIG.whatsapp.number`
  and referenced only via `src/lib/whatsapp.ts` — never hardcoded in a component.
- Buttons: Profile screen card ("Chat with us on WhatsApp" — "Fastest support
  — usually replies in minutes", green `#25D366` icon circle, lime chevron),
  placed immediately above the Help row so support options sit together; the
  Help screen itself contains NO WhatsApp (email + FAQ + legal only); plus
  one-line "Need help?" footers on error/support surfaces (install failure,
  connection-test "Still stuck?", checkout payment failure). The Calls/dialer
  screen deliberately has NO WhatsApp banner. All surfaces share the single
  `openWhatsApp()` helper. The card prefills the user's most recent order id
  when one exists.
- Tap behavior (native path): builds BOTH links from one prefill —
  `whatsapp://send?phone=<number>&text=<encoded>` (opens the WhatsApp app
  DIRECTLY into the chat, message prefilled in the input box) and
  `https://wa.me/<number>?text=<encoded>` (browser → "Continue to Chat" →
  WhatsApp Web). `Linking.canOpenURL(appUrl)` decides: supported →
  `openURL(appUrl)`; false or any error → `openURL(webUrl)`, logged with
  the surface. Never a crash, never a dead end. Native builds inject the
  expo-linking adapter once via `setWhatsAppLinking()`. In browser preview
  the link correctly opens a new tab to wa.me (expected, not a bug), and
  the Help screen shows a preview-only note: "On a real phone this opens
  WhatsApp directly."

#### WhatsApp deep-link config (REQUIRED for the app path)

Without these, `canOpenURL('whatsapp://…')` ALWAYS returns false and taps
fall back to the browser even when WhatsApp is installed:

- **iOS — Info.plist**: `LSApplicationQueriesSchemes` must include
  `"whatsapp"`. Present in BOTH `app.config.js` (`ios.infoPlist`) and
  `app.json` — EAS merges either into Info.plist automatically.
- **Android — AndroidManifest.xml** (Android 11+ package visibility):
  ```xml
  <queries>
    <package android:name="com.whatsapp" />
  </queries>
  ```
  Applied automatically by the Expo config plugin
  `plugins/with-whatsapp-queries.cjs` (registered in `app.config.js` and
  `app.json`) — no manual manifest edits needed on EAS builds. Without the
  two iOS/Android entries, `canOpenURL` always fails and taps never open
  the app directly (this was the original bug).
- Prefill carries the order context when available ("Hi Jum e-SIM! I need
  help with my order …") so users type only their problem; without an order
  it's "Hi Jum e-SIM! I need help with: ". `wa.me` works without saving the
  contact — important for travelers.
- **Setup notes**: this is a WhatsApp Business number, separate from any
  personal number — set the greeting + business-hours auto-reply in the
  WhatsApp Business app so travelers get instant acknowledgment. Test the
  exact link on iOS and Android before release:
  `https://wa.me/23233129788?text=Hi%20Jum%20e-SIM!`
- Analytics: `calls_tab_opened`, `buy_time_sheet_viewed`, `credit_purchased`,
  `call_started` (country, rate), `call_completed` (duration, cost),
  `call_blocked_insufficient`, `whatsapp_support_tapped`
  (`surface: profile | install_fail | connection_fail | checkout_fail`,
  `hasOrderContext`).

## Module 11 — Wallets checkout analytics + post-purchase rating prompt

### Wallet payment analytics
Three payment events fire on the checkout screen (`src/pages/Checkout.tsx`):
- `payment_method_selected { method: 'apple' | 'google' | 'card' }` — every
  explicit selection (auto-defaulting to a wallet does NOT fire it).
- `payment_success { method }` — after the order is confirmed, immediately
  before navigating to the Installation screen.
- `payment_failed { method, reason }` — `reason` is the classified banner
  title (e.g. "Card declined"); the payment is voided, never captured.

### Rating prompt (rate Jum e-SIM after successful purchase)
- **Trigger**: payment succeeded AND the install is confirmed — the
  "Installation successful!" moment (`src/pages/Installation.tsx`). Never
  before delivery; the auto-advance to Get Connected is paused while the
  sheet is open and resumes when it closes.
- **Sheet** (`src/components/RatingSheet.tsx`): "Enjoying Jum e-SIM?" +
  plan chip (flag · size · days), 5 large stars, "Maybe later".
- **Star split** (deliberate — never send low ratings to the stores):
  - 4–5 stars → `requestStoreReview()` (`src/lib/rating.ts`): native builds
    inject expo-store-review via `setStoreReviewHandler()` (iOS in-app review
    card / Play listing intent); the web build opens `jumesim.com/rate`.
  - 1–3 stars → NO store redirect. Routes into the WhatsApp support chat via
    the existing `openWhatsApp` helper, prefilled
    "Hi! I rated my experience X stars because…".
- **Frequency rules** (`src/lib/rating.ts`, state persisted under
  `jum-esim:rating:v1`): max 1 prompt per purchased eSIM (`perOrder`), 90-day
  global cap anchored at any "Maybe later" dismissal (`lastPromptAt`), never
  if already rated (`rated`), never during an active support/refund
  conversation (`supportActiveUntil` — set by SupportChat messages and by
  refund requests on Installation; 24 h TTL).
- **Analytics**: `rating_prompt_shown { orderId }`, `rating_store_opened
  { stars }`, `rating_support_routed { stars }`, `rating_dismissed { orderId }`.
- Tests: `tests/rating-e2e.py` (33 checks: trigger timing, sheet copy, 5-star
  store path, 2-star WhatsApp path with prefill, maybe-later + 90-day cap,
  1-per-order, support gate, wallet analytics).

## Module 12 — Auto-refund guarantee ("Never used it? Automatic refund.")

### The one rule
A refund is possible ONLY while the eSIM has NEVER been used. "Used" = ANY
network connection on the eSIM, even 1 KB / 1 second, checked against eSIM
Go's server-side status — the app is never trusted. The moment ANY usage
exists, the order locks to "No refund — plan in use" permanently: no
exceptions, no partial refunds, no support override (`/api/refund` re-checks
usage and refuses with 409 `usage_locked_no_refund`).

### Engine (server cron, every minute)
`api/lib/guarantee.ts` — one tick scans every order:
- **Inside the 10-minute window**: polls eSIM Go `GET /esims/{iccid}` for
  usage. Any session → `usageLocked` persisted (irreversible, server-side).
- **At T+10, unused**: auto-executes — Stripe full refund to the original
  payment method → eSIM Go cancel (free inside their window) → user
  notification on **WhatsApp + email + push**: "Your eSIM never connected, so
  we refunded you automatically — $X.XX is on its way back. Sorry for the
  hassle! Retry with 20% off: RETRY20". Idempotent — re-ticks never
  double-refund.
- **Race guard**: the usage check runs AGAIN milliseconds before the Stripe
  refund call — a connection at minute 9:59 wins over the refund.
- **After the window**: eSIM Go usage webhooks (`POST /api/webhooks/esimgo`,
  signature-verified in live mode) lock the order at any moment — usage can
  start at first connection abroad, even weeks later.

Scheduling: `POST /api/guarantee/tick` (Vercel Cron every minute; the local
runner schedules it in-process). When `CRON_SECRET` is set the request must
carry it — the endpoint triggers refunds. Mock orders drive usage through the
same webhook shape: `{ iccid, type: 'usage', usedKB }`.

### Anti-abuse
- Same card >2 auto-refunds per month → that order goes to a **manual review
  queue** (`manualReview` flag) instead of refunding.
- Refund rate >5% of the month's orders (minimum 20 orders, so small-sample
  noise can't throttle) → admin alert + all further auto-refunds throttled to
  manual review.

### Client surfaces (all server-authoritative via `/api/orders/status`, 30 s poll)
- **Checkout** (under Pay): "Never connects? Auto-refund in 10 min. Once you
  start using it, no refund — fair's fair."
- **Installation**: "⚡ No signal within 10 minutes? We refund you
  automatically. (Refunds stop the moment your eSIM connects.)" — the banner
  disappears permanently the instant the server sees any connection; the
  refund button becomes "No refund — plan in use".
- **My eSIMs**: unused eSIMs show a live "Auto-refund window: mm:ss"
  countdown; used eSIMs show "In use — no refund"; engine-refunded eSIMs show
  "Guarantee honored ✓" and the local purchase flips to Refunded from server
  state.
- **Get Connected / eSIM detail**: same "In use — no refund" chip after lock.

### Analytics
`auto_refund_eligible` (at purchase) · `auto_refund_executed` ·
`usage_lock_triggered` · `guarantee_expired_unused` · `abuse_flag_raised` ·
`auto_refund_rate`. The engine records them server-side on the order (returned
by `/api/orders/status`); the client mirrors each observed transition into its
local analytics log.

Tests: `tests/guarantee-e2e.py` (needs a fresh `npm run api` — the engine
state persists in the store). Covers all four acceptance rows: T+10 auto-refund
with all 3 notifications, 1 KB → permanent lock with banner/chip removal,
minute-8 usage caught by the race guard, and the 3rd same-card refund landing
in manual review.

## Module 13 — User-initiated "Refund" button on My eSIMs

### The button (two states, no ambiguity)
Every eSIM card in My eSIMs (Profile) gets a refund footer row driven by
server state (`/api/orders/status`, Module 12):
- **UNUSED (0 KB per eSIM Go, inside the 10-min window)**: lime outline
  "↩ Refund $X.XX" + sub-line "Available because this eSIM has never been
  used. Guarantee expires in mm:ss" (live countdown). Tap → confirmation
  sheet: "Refund $X.XX? Money returns to your card in 5–10 days. This eSIM
  will stop working." — [Confirm refund] (lime) / [Keep my eSIM] (gray).
- **IN USE (any connection ever — even 1 KB)**: the button is replaced by a
  disabled gray row "No refund — plan in use" + "Refunds are only available
  before your eSIM connects." Not tappable, no sheet.
- **Window closed unused**: "Guarantee expired — need help? Chat on WhatsApp"
  routes into the existing WhatsApp helper (a request would be rejected
  window_expired).
- **Refunded**: green chip "Refunded ✓ — guarantee honored" + timestamp; the
  card stays visible (transparency) and is no longer tappable.

### Execution — POST /api/refund/request { orderId } (never client-trusted)
1. Re-fetches eSIM Go status for the iccid AT THIS MOMENT.
2. REJECTS if any data session exists / Activated / In-use →
   `{ eligible: false, reason: 'in_use' }` — the race guard: a user can tap
   refund while the eSIM's first connection is happening, and only this
   server check decides.
3. REJECTS outside the 10-minute window → `{ eligible: false, reason:
   'window_expired' }`.
4. ELIGIBLE → Stripe full refund (original payment method) + eSIM Go cancel →
   `{ eligible: true, refunded: true }`; the order records `initiatedBy:
   'user'` and the **exact eSIM Go status snapshot that decided it** (auditable).
5. Same payment method >2 refunds ever → manual review (auto-execute
   disabled), `abuse_flag_raised` recorded.

Notifications on success: push (in-app) "Refund confirmed — $X.XX on its way
back", receipt-style email (amount, order ID, ETA 5–10 days, 20%-off retry
code), WhatsApp one-liner.

### Analytics
`refund_button_viewed { state: available | in_use | expired }` ·
`refund_sheet_shown` · `refund_confirmed` · `refund_rejected_in_use` ·
`refund_rejected_expired` · `refund_executed`. Rejections also recorded
server-side on the order (`refund_rejected_in_use` / `_expired`) with the
deciding snapshot.

Tests: `tests/refund-e2e.py` (needs a fresh `npm run api`). Covers the four
acceptance rows: unused → confirm → executed with honor chip + email log,
in-use → disabled row with dead tap, the mid-tap race (status flips to
Activated between tap and server check → in_use shown, no refund), card cap
→ manual review, and every analytics event.

## Module 14 — Profile "Refund" card + choose-eSIM sheet

### The card (always visible — the guarantee is marketing, not just a function)
A lime Refund card sits permanently between the WhatsApp card and the Help
row on Profile, in every state:
- **No purchases**: subtitle "Auto-refund on every plan — even if you never
  use it." Tap → Browse destinations (Explore), never a dead end.
- **Purchases, ≥1 refundable**: subtitle "N refundable eSIM{N}. Money back in
  5–10 days." + an attention badge dot (eye-drawing, only at the exact
  moment it matters — the dot disappears the instant the last refundable
  order resolves).
- **Purchases, none refundable**: subtitle names the state ("Auto-refund on
  every plan — even if you never use it.").

### The sheet — "Choose an eSIM to refund"
Lists every purchase as a row with three server-driven states (same
`/api/orders/status` authority as Module 12/13, plus the locally-known
`refundDone` set so a just-executed refund flips instantly without waiting
for the 30 s poll):
- **Unused (lime, tappable)**: country flag, plan, price + live countdown of
  the 10-minute window. Tap → confirmation slide: "Refund $X.XX? Money back
  in 5–10 days. This eSIM stops working." — [Confirm refund] / [Keep my
  eSIM] (slides back to the list).
- **In use (gray)**: "In use — no refund." Not tappable.
- **Expired / held (gray)**: "Guarantee expired — need help? Chat on
  WhatsApp" routes into the existing WhatsApp helper with order context.
- **Refunded**: green "Refunded ✓ — guarantee honored" with timestamp.
- **Empty sheet state** (all rows resolved away is impossible — purchases
  are the rows — but a user with zero purchases gets the dedicated empty
  state with the same Browse destinations CTA).

Execution reuses Module 13's `POST /api/refund/request` unchanged — the
sheet is a second doorway into the same server-authoritative path.

### Race hardening (found by tests)
- `/api/refund/request`'s in_use rejection now **persists the usage lock**
  server-side (`lockUsage(order, 'refund_request_race_guard')`): a live
  usage reading locks the order forever, so the next `/orders/status` poll
  agrees with the rejection instead of still offering the button.
- `useGuarantee` accepts a `refreshKey` — Profile bumps it after every
  refund-sheet server round-trip, so rows, the badge dot and the card
  subtitle re-poll immediately rather than waiting for the 30 s tick.

### Analytics
`refund_card_tapped { hasPurchases, refundableCount }` ·
`refund_sheet_viewed` · plus the existing Module 13 events
(`refund_sheet_shown`, `refund_confirmed`, `refund_executed`,
`refund_rejected_in_use`, `refund_rejected_expired`, and the honor events).

Tests: `tests/refund-sheet-e2e.py` (needs a fresh API + `npm run build` +
`vite preview`). Covers: card always visible in all three subtitle states,
badge dot appears only while ≥1 refundable, sheet row states for
unused / in-use / expired / refunded / empty, the confirmation slide copy,
execution flipping the row to honored immediately, the badge dot clearing,
the mid-tap race (connection during confirm → row flips to in_use, nothing
refunded), and the two new analytics events.

`tests/run-all.sh` runs the whole regression (rating, guarantee, refund,
refund-sheet, rating-unit) with a fresh API server before each suite — the
engine's global monthly abuse-rate cap means suites contaminate each other
otherwise.


## Module 16 — User accounts (Firebase Auth) + order sync

**Auth.** Firebase Auth (anonymous + email/password) behind a provider
interface (`src/lib/auth/`). With `VITE_FIREBASE_*` env set (see
`.env.example`) the real SDK loads dynamically — `firebase` ships in the
bundle but only initializes when configured; otherwise a local emulation
layer mirrors Firebase semantics (anonymous sessions, persisted login,
linkWithCredential, reset tokens) so dev/tests/preview need zero services.
Social sign-in (Google/Apple) sits behind `config.auth.socialEnabled`
(phase 2, off by default).

**Guest mode stays.** The app never walls anything behind an account. On
first launch the device signs in ANONYMOUSLY, so every purchase already has
a stable uid. Signing up from that state links the credential to the same
uid (`linkWithCredential`) — orders follow the user with zero migration UI.

**Data.** Every purchase dual-writes: local cache (`jum-esim:purchases:v1`,
offline-first) AND the cloud doc `users/{uid}/orders/{orderId}` (Firestore;
the cross-device source of truth). Checkout also stamps the anonymous uid
onto the server order (`/api/confirm-order` body.uid) so guest checkouts
can be re-associated later. Login resyncs: cloud wins on conflicts, local-
only orders are pushed up. Reinstall/new-device backup path: "Restore
purchases" calls `/api/auth/reassociate` (Admin SDK bypasses rules; matches
orders by delivery email with no uid).

**Security.** `/firestore.rules` — users can only touch their own subtree,
order creates/updates must stamp `request.auth.uid`; `/plans` is public
read-only; everything else denies. All provider-priveleged writes (iccid,
qrUrl, status, usage) go through backend functions only (Admin SDK).

**UX.** Sign up (strength meter, verify-password, terms, inline errors),
login, forgot password (Firebase reset email + in-app confirmation; the
local emulation exposes a dev-only "complete reset" panel since it has no
mailbox), Profile auth card (lime CTA signed-out; avatar + email + sync
state signed-in → Account sheet with member-since, "Last synced X min ago",
sign out (cache kept), delete account (confirm → auth user + cloud docs +
local cache wiped)). Auth errors map inline: email-in-use → "Sign in
instead"; wrong-password → reset link; network → retry copy. All auth copy
lives in `auth.*` / `profile.*` i18n keys across the 18 locales.

### Analytics
`auth_signup_started` · `auth_signup_completed` · `auth_login_completed` ·
`auth_reset_requested` · `account_linked_anonymous` · `orders_restored` ·
`account_deleted`


## Module 17 — Email verification + Gmail notifications (welcome + owner alert)

Connects the app to an **existing** Firebase project and turns account creation
into a full email flow: verification link, branded welcome email, and a
real-time owner alert.

### Config — `config/firebase.ts`

Exact structure from the spec; values come from the existing project's console
(Firebase Console → Project settings → General → Your apps → web app →
`firebaseConfig`). They identify the project — **not secrets, safe to ship**:

```ts
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
}
export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
```

`VITE_FIREBASE_*` vars are accepted as fallbacks (web build). All three
exports are guarded behind `firebaseEnabled` — with empty vars the app boots
into the local emulation backend instead of throwing `auth/invalid-api-key`.

**Console checklist (existing project):**
1. Authentication → Sign-in method → enable **Email/Password**
2. Firestore Database → **Create database** (production mode)
3. Authentication → Settings → **Authorized domains** → add your domain(s)
4. Authentication → Templates → **Email address verification** → brand the
   subject/body/sender as Jum e-SIM

### Emails sent on sign-up

1. **Verification (built-in)** — `sendEmailVerification(user)` right after
   `createUserWithEmailAndPassword`. In-app state: amber banner *"We sent a
   verification link to {email} — check your inbox (and spam)."* with
   **Resend** (60s cooldown, max 3 sends/hour/account, persisted send log)
   and **I'll verify later** (dismissal persists per account). Verification is
   required only for sensitive actions: purchases stay open, **refund requests
   are gated** (`verify.refundBlocked` toast + `refund_blocked_unverified`
   analytics event) in both the per-card button and the RefundSheet.
2. **Welcome email** — outbox doc `users-welcome/welcome-{uid}`
   `{ to, template: { name: "welcome", data: { email } } }` consumed by the
   **Trigger Email** extension (firestore-send-email + SendGrid free tier,
   100 emails/day). Subject: *"Welcome to Jum e-SIM 🌍"* + deep-link button.
3. **Owner alert** — second doc `users-welcome/owner-{uid}` to
   `support@jumesim.com`: *"New signup: {email} at {timestamp}"*.

The outbox pattern is what makes **email failure non-blocking**: writes are
fire-and-forget, retried once after 2s, and any final failure is logged +
tracked (`welcome_email_failed`) — account creation never depends on email.

### Server side

- `functions/src/index.ts` — Cloud Functions v2 `onAuthCreate` identity
  trigger writes the same welcome/owner docs server-side (Admin SDK bypasses
  rules). Deploy with `cd functions && npm install && firebase deploy --only
  functions`; set `OWNER_EMAIL` (default `support@jumesim.com`) and
  `SENDGRID_API_KEY` (server-only, never in the client bundle).
- `firestore.rules` — `users-welcome/{docId}`: `create` allowed for any
  signed-in user; no read/update/delete (outbox is write-only).
- Guest checkout stamps `uid` server-side; purchase flow needs no verification.

### Local emulation (no Firebase values yet)

With empty env vars the `LocalAuthBackend` mirrors the whole flow: salted
credentials, a persisted **mail outbox** in the local auth store
(`mail[welcome-{uid}]`, `mail[owner-{uid}]`, `mail[verify:{uid}:{ts}]`), and
a dev-only *"Mark as verified (dev)"* button on the banner. Same schemas,
same throttling, same gates — swap in real values later without code changes.

### Acceptance verified locally (19/19)

Welcome/owner docs enqueued with the exact Trigger Email schema · spam note +
resend/later buttons · 60s cooldown + 3/hour cap · refund blocked while
unverified (card + sheet paths) with analytics · resend re-enqueues ·
dismissal persists across reload · zero page errors. Actual Gmail delivery
and Authentication → Users visibility require the real project values in
`.env`.

### Analytics
`auth_signup_started` · `auth_signup_completed` · `auth_login_completed` ·
`auth_reset_requested` · `account_linked_anonymous` · `orders_restored` ·
`account_deleted` · `auth_verification_resent` · `refund_blocked_unverified` ·
`welcome_email_failed`
