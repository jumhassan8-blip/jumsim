"""Backend E2E (Module 8): the app talks ONLY to /api/* — never eSIM Go or
Stripe directly — through the full purchase + refund flow.

Assumes: vite preview on :4173 (proxying /api → :8789 dev-api, MOCK_MODE=true)
"""
import json
import re

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4173"
FORBIDDEN = re.compile(r"(esim-go\.com|api\.stripe\.com|js\.stripe\.com|stripe\.com)")

errors = []
ok = lambda m: print(f"  OK {m}")
bad = lambda m: (print(f"  FAIL {m}"), errors.append(m))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.on("pageerror", lambda e: bad(f"JS error: {e}"))
    page = ctx.new_page()

    api_calls = []
    all_calls = []
    page.on("request", lambda r: (all_calls.append(r.url), api_calls.append(r.url) if "/api/" in r.url else None))

    # ── Home → Japan ────────────────────────────────────────────────
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(500)
    page.get_by_placeholder(re.compile("Search|Where")).first.fill("Japan")
    page.wait_for_timeout(400)
    page.get_by_text("Japan", exact=True).first.click()
    page.wait_for_timeout(600)
    if "/country/japan" in page.url:
        ok("navigated to /country/japan")
    else:
        bad(f"expected /country/japan, at {page.url}")

    # ── select 5GB plan → Continue ──────────────────────────────────
    page.get_by_role("button", name=re.compile(r"^5 GB")).first.click()
    page.get_by_role("button", name=re.compile(r"Continue · 5GB \$8\.99")).click()
    page.wait_for_timeout(700)
    if "/checkout/japan-5gb-30d" in page.url:
        ok("checkout route with exact plan id japan-5gb-30d")
    else:
        bad(f"checkout route wrong: {page.url}")
    if page.get_by_text("$8.99").count():
        ok("order summary shows pricing.json price $8.99")
    else:
        bad("price $8.99 missing on checkout")

    # ── fill form → Pay ─────────────────────────────────────────────
    page.locator("#email").fill("traveller@example.com")
    page.get_by_placeholder("Card number").fill("4242424242424242")
    page.get_by_placeholder("MM/YY").fill("12/28")
    page.get_by_placeholder("CVC").fill("123")
    page.locator('input[type="checkbox"]').first.check()
    page.get_by_role("button", name=re.compile(r"^Pay \$")).click()
    page.wait_for_timeout(2500)

    if "/install/" in page.url:
        ok("paid → redirected to installation screen")
    else:
        bad(f"expected /install/ after pay, at {page.url}")

    # ── purchase created from the backend payload ───────────────────
    purchases = json.loads(page.evaluate("() => localStorage.getItem('jum-esim:purchases:v1') || '[]'"))
    if len(purchases) == 1:
        order = purchases[0]["order"]
        if order["id"].startswith("ord_") and "esim.jum.app" in order["lpaString"]:
            ok(f"purchase stored with backend order {order['id']} (mock SM-DP+ LPA string)")
        else:
            bad(f"order payload wrong: {order}")
        if purchases[0]["plan"]["priceUSD"] == 8.99:
            ok("plan price intact through backend flow")
        else:
            bad(f"plan price wrong: {purchases[0]['plan']['priceUSD']}")
    else:
        bad(f"expected 1 purchase, got {len(purchases)}")

    # ── traffic audit: only our /api endpoints, nothing external ────
    intents = [u for u in api_calls if "create-payment-intent" in u]
    confirms = [u for u in api_calls if "confirm-order" in u]
    if intents and confirms:
        ok(f"payment-intent + confirm-order went to our API ({len(intents)}+{len(confirms)} calls)")
    else:
        bad(f"expected /api payment calls, saw: {api_calls}")
    ext = [u for u in all_calls if FORBIDDEN.search(u)]
    if not ext:
        ok("zero requests to eSIM Go or Stripe from the client")
    else:
        bad(f"client called external provider directly: {ext[:3]}")

    # ── refund via install page ─────────────────────────────────────
    page.get_by_role("button", name="Installation didn’t work?").click()
    page.wait_for_timeout(300)
    refund_btn = page.get_by_role("button", name="Request one-tap refund")
    if refund_btn.count():
        refund_btn.click()
        page.wait_for_timeout(1500)
        purchases = json.loads(page.evaluate("() => localStorage.getItem('jum-esim:purchases:v1') || '[]'"))
        if purchases and purchases[0]["status"] == "refunded":
            ok("order marked refunded after backend refund")
        else:
            bad(f"status after refund: {purchases[0]['status'] if purchases else 'none'}")
        refunds = [u for u in api_calls if u.endswith("/api/refund")]
        if refunds:
            ok("/api/refund called")
        else:
            bad("/api/refund never called")
    else:
        bad("refund button not found on install page")

    page.screenshot(path="/tmp/backend-e2e.png")
    ctx.close()
    browser.close()

print()
if errors:
    print(f"FAILED ({len(errors)})")
    raise SystemExit(1)
print("ALL PASSED")
