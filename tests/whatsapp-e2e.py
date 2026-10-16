#!/usr/bin/env python3
"""WhatsApp support verification (Profile card + error surfaces).

Requires: API server (:8789) + preview (:4173, prod build).

Covers the spec:
  1. Profile screen: green WhatsApp card immediately adjacent to the Help
     row — #25D366 icon circle, exact title/subtitle copy, lime chevron
  2. Help screen: NO WhatsApp anywhere inside it (email + FAQ + legal only)
  3. Preview-only dev note: "On a real phone this opens WhatsApp directly."
  4. Tap behavior: opens https://wa.me/23233129788?text=<prefill>; prefill
     carries the order ID when context exists; generic otherwise
  5. Error surfaces: checkout payment failure, installation failure,
     connection-test failure — each with the shared row + surface analytics
  6. Analytics: whatsapp_support_tapped { surface: profile | install_fail |
     connection_fail | checkout_fail, hasOrderContext }
  7. Number defined once in config/support.json; iOS LSApplicationQueriesSchemes
     + Android queries config present in repo
"""
import json
import re
import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4173"
errors = []


def ok(name):
    print(f"  OK {name}")


def bad(name):
    print(f"  FAIL {name}")
    errors.append(name)


OPEN_CAPTURE = """
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
"""

SEED_PURCHASE = """
  localStorage.setItem('jum-esim:purchases:v1', JSON.stringify([{
    order: {
      id: 'ord_WA1', iccid: '8985299999999999999',
      qrUrl: 'https://example.test/qr.png', lpaString: 'LPA:1$esim.jum.app$TESTWA1',
      planId: 'japan-data-7d-5gb', email: 'traveller@example.com',
      createdAt: Date.now() - 60000,
    },
    plan: {
      id: 'japan-data-7d-5gb', countrySlug: 'japan', name: '5GB · 7 days',
      dataGB: 5, days: 7, priceUSD: 8.99, wholesaleUSD: 6, fiveG: true,
      networks: ['SoftBank'], hotspot: true, group: 'data', label: '7 Days',
    },
    country: {
      slug: 'japan', name: 'Japan', iso2: 'JP', flag: '🇯🇵',
      region: 'asia-pacific', fiveG: true, networks: ['SoftBank'], popular: true,
    },
    status: 'not_installed',
    installedAt: null,
  }]));
"""


def analytics_events(page):
    return page.evaluate(
        "(k) => JSON.parse(localStorage.getItem(k) || '[]')", "jum-esim:analytics:v1"
    )


def last_whatsapp_event(page):
    evs = [e for e in analytics_events(page) if e["event"] == "whatsapp_support_tapped"]
    return evs[-1] if evs else None


def expect_url(page, want_prefill_substr, label):
    opened = page.evaluate("window.__opened")
    url = opened[-1] if opened else ""
    if not url.startswith("https://wa.me/23233129788?text="):
        bad(f"{label}: url wrong: {url}")
        return None
    ok(f"{label}: opens wa.me/23233129788")
    if want_prefill_substr in url:
        ok(f"{label}: prefill correct")
    else:
        bad(f"{label}: prefill missing '{want_prefill_substr}': {url}")
    return url


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])

    # ══ Context 1 — Profile WhatsApp card + checkout failure (no seeded order) ══
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    page = ctx.new_page()

    page.goto(f"{URL}/profile", wait_until="networkidle")
    page.wait_for_timeout(600)

    # green WhatsApp card, immediately ABOVE the Help row (same card style)
    wa_card = page.get_by_text("Chat with us on WhatsApp").locator(
        "xpath=ancestor::button[1]")
    help_row = page.get_by_text("FAQ · contact support").locator(
        "xpath=ancestor::button[1]")
    if wa_card.count() == 1 and help_row.count() == 1:
        wa_bottom = wa_card.bounding_box()["y"] + wa_card.bounding_box()["height"]
        help_top = help_row.bounding_box()["y"]
        help_bottom = help_top + help_row.bounding_box()["height"]
        # adjacent: the card sits right before the Help row
        if -30 <= (help_top - wa_bottom) <= 80 and help_bottom > wa_bottom:
            ok("profile: WhatsApp card adjacent to the Help row (above it)")
        else:
            bad(f"profile: card not adjacent: gap {help_top - wa_bottom}")
    else:
        bad("profile: WhatsApp card or Help row missing")
    card_html = wa_card.inner_html()
    if "bg-[#25D366]" in card_html:
        ok("profile: official-green #25D366 icon circle")
    else:
        bad("profile: icon circle not #25D366")
    if "text-[#D7FF3F]" in card_html:
        ok("profile: lime chevron on the right")
    else:
        bad("profile: lime chevron missing")
    if "Fastest support — usually replies in minutes" in wa_card.inner_text():
        ok("profile: exact title + subtitle copy")
    else:
        bad("profile: title/subtitle copy wrong")
    # preview-only dev note (browser build = 'preview' env)
    note = page.get_by_text(re.compile(r"on a real phone this opens WhatsApp directly", re.I))
    if note.count() == 1:
        ok("profile: preview dev note shown")
    else:
        bad("profile: preview dev note missing")
    # Help screen contains NO WhatsApp at all
    page.goto(f"{URL}/help", wait_until="networkidle")
    page.wait_for_timeout(500)
    help_html = page.locator("main").inner_html()
    if "WhatsApp" not in help_html and "25D366" not in help_html:
        ok("help: no WhatsApp anywhere inside it")
    else:
        bad("help: WhatsApp still present inside Help")
    if page.get_by_text("Contact support").count() == 1:
        ok("help: email row present (email is the channel here)")
    else:
        bad("help: email row missing")

    # tap on Profile (no order yet) → generic prefill, hasOrderContext false
    page.goto(f"{URL}/profile", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.get_by_text("Chat with us on WhatsApp").click()
    page.wait_for_timeout(400)
    expect_url(page, "Hi%20Jum%20e-SIM!%20I%20need%20help%20with%3A%20", "profile (no order)")
    ev = last_whatsapp_event(page)
    if ev and ev["data"].get("surface") == "profile" and ev["data"].get("hasOrderContext") is False:
        ok("analytics: profile tap → surface=profile, hasOrderContext=false")
    else:
        bad(f"analytics wrong: {ev}")

    # tap WITH order context (seeded purchase → latest order prefilled)
    ctx1b = browser.new_context(viewport={"width": 390, "height": 844})
    ctx1b.add_init_script(OPEN_CAPTURE)
    ctx1b.add_init_script(SEED_PURCHASE)
    page1b = ctx1b.new_page()
    page1b.goto(f"{URL}/profile", wait_until="networkidle")
    page1b.wait_for_timeout(600)
    page1b.get_by_text("Chat with us on WhatsApp").click()
    page1b.wait_for_timeout(400)
    expect_url(page1b, "my%20order%20ord_WA1", "profile (with order)")
    ev = last_whatsapp_event(page1b)
    if ev and ev["data"].get("hasOrderContext") is True:
        ok("analytics: order context → hasOrderContext=true")
    else:
        bad(f"analytics wrong: {ev}")
    ctx1b.close()

    # ── checkout payment failure footer ──────────────────────────────
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_placeholder(re.compile("Search|Where")).first.fill("Japan")
    page.wait_for_timeout(300)
    page.get_by_text("Japan", exact=True).first.click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name=re.compile(r"^5 GB")).first.click()
    page.get_by_role("button", name=re.compile(r"Continue · 5GB \$8\.99")).click()
    page.wait_for_timeout(600)
    page.route(re.compile(r".*/api/confirm-order$"), lambda r: r.fulfill(
        status=402, content_type="application/json",
        body=json.dumps({"error": "payment_failed_no_charge"})))
    page.locator("#email").fill("traveller@example.com")
    page.get_by_role("button", name="Credit or debit card").click()
    page.locator("#card-number").fill("4242424242424242")
    page.locator("#card-expiry").fill("1228")
    page.locator("#card-cvc").fill("123")
    page.locator('input[type="checkbox"]').first.check()
    page.get_by_role("button", name=re.compile(r"^Pay \$")).click()
    page.wait_for_timeout(2000)
    if page.get_by_text("Card declined").count() == 1:
        ok("checkout failure: declined banner shown")
    else:
        bad("checkout failure: no declined banner")
    banner = page.get_by_text("Card declined").locator("..")
    if banner.get_by_text("Need help?").count() == 1:
        ok("checkout failure: 'Need help?' WhatsApp footer in banner")
    else:
        bad("checkout failure: WhatsApp footer missing")
    banner.get_by_text("Chat with us on WhatsApp").click()
    page.wait_for_timeout(400)
    expect_url(page, "Hi%20Jum%20e-SIM!%20I%20need%20help%20with%3A%20", "checkout_fail")
    ev = last_whatsapp_event(page)
    if ev and ev["data"].get("surface") == "checkout_fail":
        ok("analytics: surface=checkout_fail")
    else:
        bad(f"analytics wrong: {ev}")
    ctx.close()

    # ══ Context 2 — seeded order: install failure + connection failure ══
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
    ctx2.add_init_script(OPEN_CAPTURE)
    ctx2.add_init_script(SEED_PURCHASE)
    page2 = ctx2.new_page()

    # installation failure surface
    page2.goto(f"{URL}/install/ord_WA1", wait_until="networkidle")
    page2.wait_for_timeout(600)
    page2.get_by_role("button", name=re.compile(r"Installation didn’t work")).click()
    page2.wait_for_timeout(400)
    if page2.get_by_text("Chat with us on WhatsApp").count() >= 1:
        ok("install failure: WhatsApp row in the help panel")
    else:
        bad("install failure: WhatsApp row missing")
    page2.get_by_text("Chat with us on WhatsApp").first.click()
    page2.wait_for_timeout(400)
    expect_url(page2, "my%20order%20ord_WA1", "install_fail")
    ev = last_whatsapp_event(page2)
    if ev and ev["data"].get("surface") == "install_fail" and ev["data"].get("hasOrderContext") is True:
        ok("analytics: surface=install_fail, hasOrderContext=true")
    else:
        bad(f"analytics wrong: {ev}")

    # connection-test failure surface (Get Connected footer on every screen)
    page2.goto(f"{URL}/setup/ord_WA1", wait_until="networkidle")
    page2.wait_for_timeout(600)
    if page2.get_by_text("Still stuck?").count() == 1:
        ok("connection flow: 'Still stuck?' footer present")
    else:
        bad("connection flow: 'Still stuck?' footer missing")
    page2.get_by_text("Chat on WhatsApp").click()
    page2.wait_for_timeout(400)
    expect_url(page2, "my%20order%20ord_WA1", "connection_fail")
    ev = last_whatsapp_event(page2)
    if ev and ev["data"].get("surface") == "connection_fail":
        ok("analytics: surface=connection_fail")
    else:
        bad(f"analytics wrong: {ev}")
    ctx2.close()

    browser.close()

    # number stored in exactly one place (config/support.json). config.ts
    # holds the single import binding; every other file must read CONFIG.
    src_files = ["src/lib/whatsapp.ts", "src/components/WhatsAppRow.tsx",
                 "src/pages/Help.tsx", "src/pages/Installation.tsx", "src/pages/GetConnected.tsx",
                 "src/pages/Checkout.tsx", "src/pages/Calls.tsx", "src/pages/Profile.tsx",
                 "src/components/BuyTimeSheet.tsx"]
    src_occurrences = sum(open(f).read().count("23233129788") for f in src_files)
    support_json = json.load(open("config/support.json"))
    if src_occurrences == 0 and support_json.get("whatsappNumber") == "23233129788":
        ok("config: number defined once in config/support.json, none in components/libs")
    else:
        bad(f"src occurrences {src_occurrences}, support.json {support_json}")

    # required platform config survives EAS builds
    app_cfg = open("app.config.js").read()
    app_json = json.load(open("app.json"))
    plugin = open("plugins/with-whatsapp-queries.cjs").read()
    if 'LSApplicationQueriesSchemes' in app_cfg and 'LSApplicationQueriesSchemes' in json.dumps(app_json):
        ok("config: iOS LSApplicationQueriesSchemes ['whatsapp'] in app.config.js + app.json")
    else:
        bad("iOS whatsapp scheme config missing")
    if 'com.whatsapp' in plugin and 'with-whatsapp-queries' in app_cfg:
        ok("config: Android <queries> com.whatsapp plugin wired into EAS config")
    else:
        bad("Android queries config missing")

print()
if errors:
    print(f"FAILED ({len(errors)})")
    raise SystemExit(1)
print("ALL PASSED")
