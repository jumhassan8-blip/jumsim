#!/usr/bin/env python3
"""Post-purchase rating prompt + wallet payment analytics.

Requires: preview (:4173, prod build). The install-confirm flow is fully
client-side (mock provider / confirm-order), no API server needed beyond
whatever the checkout already used to create the seeded purchase.

Covers the spec:
  1. Trigger: "Installation successful!" moment only — sheet appears on
     confirm-installed, never before
  2. Sheet: "Enjoying Jum e-SIM?" + plan chip (flag · size · days),
     5 large stars, "Maybe later"
  3. 5 stars → store review (jumesim.com/rate on web), analytics
     rating_prompt_shown + rating_store_opened, rated flag persisted
  4. 2 stars → NO store redirect; WhatsApp chat opens with
     "Hi! I rated my experience 2 stars because…" prefill;
     analytics rating_support_routed
  5. "Maybe later" → analytics rating_dismissed + 90-day global cap
     (a second order right after is NOT prompted)
  6. Max 1 prompt per purchased eSIM (same order re-confirmed → no sheet)
  7. Never during an active support conversation (supportActiveUntil future)
  8. Checkout analytics: payment_method_selected / payment_success /
     payment_failed { method, reason }
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


def seed_purchase(order_id):
    return f"""
  localStorage.setItem('jum-esim:purchases:v1', JSON.stringify([{{
    order: {{
      id: '{order_id}', iccid: '8985299999999999999',
      qrUrl: 'https://example.test/qr.png', lpaString: 'LPA:1$esim.jum.app$TEST{order_id}',
      planId: 'japan-data-7d-5gb', email: 'traveller@example.com',
      createdAt: Date.now() - 60000,
    }},
    plan: {{
      id: 'japan-data-7d-5gb', countrySlug: 'japan', name: '5GB · 7 days',
      dataGB: 5, days: 7, priceUSD: 8.99, wholesaleUSD: 6, fiveG: true,
      networks: ['SoftBank'], hotspot: true, group: 'data', label: '7 Days',
    }},
    country: {{
      slug: 'japan', name: 'Japan', iso2: 'JP', flag: '🇯🇵',
      region: 'asia-pacific', fiveG: true, networks: ['SoftBank'], popular: true,
    }},
    status: 'not_installed',
    installedAt: null,
  }}]));
"""


def seed_two_purchases(order_id_a, order_id_b):
    """Seed TWO orders in one write — the app's store re-persists its own
    in-memory purchases on change, clobbering any mid-run localStorage edit."""
    return f"""
  const mk = (id) => ({{
    order: {{
      id, iccid: '8985299999999999999',
      qrUrl: 'https://example.test/qr.png', lpaString: 'LPA:1$esim.jum.app$TEST' + id,
      planId: 'japan-data-7d-5gb', email: 'traveller@example.com',
      createdAt: Date.now() - 60000,
    }},
    plan: {{
      id: 'japan-data-7d-5gb', countrySlug: 'japan', name: '5GB · 7 days',
      dataGB: 5, days: 7, priceUSD: 8.99, wholesaleUSD: 6, fiveG: true,
      networks: ['SoftBank'], hotspot: true, group: 'data', label: '7 Days',
    }},
    country: {{
      slug: 'japan', name: 'Japan', iso2: 'JP', flag: '🇯🇵',
      region: 'asia-pacific', fiveG: true, networks: ['SoftBank'], popular: true,
    }},
    status: 'not_installed',
    installedAt: null,
  }});
  localStorage.setItem('jum-esim:purchases:v1',
    JSON.stringify([mk('{order_id_a}'), mk('{order_id_b}')]));
"""


def seed_rating_state(state):
    return (
        "localStorage.setItem('jum-esim:rating:v1', JSON.stringify("
        + json.dumps(state)
        + "));"
    )


def analytics_events(page):
    return page.evaluate(
        "(k) => JSON.parse(localStorage.getItem(k) || '[]')", "jum-esim:analytics:v1"
    )


def last_event(page, name):
    evs = [e for e in analytics_events(page) if e["event"] == name]
    return evs[-1] if evs else None


def rating_state(page):
    return page.evaluate(
        "() => JSON.parse(localStorage.getItem('jum-esim:rating:v1') || '{}')"
    )


def confirm_install(page, order_id):
    """Drive the install flow to the success moment; returns nothing."""
    page.goto(f"{URL}/install/{order_id}", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Install eSIM").click()
    page.wait_for_timeout(2200)  # 'installing' → 'manual'
    page.get_by_role("button", name="I installed it — continue").click()
    page.wait_for_timeout(600)


def sheet_visible(page):
    return page.get_by_role("dialog", name="Rate Jum e-SIM").count() == 1


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])

    # ══ 1 — happy path: sheet at the success moment, 5 stars → store ══
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    ctx.add_init_script(seed_purchase("ord_RATE1"))
    page = ctx.new_page()
    page.goto(f"{URL}/install/ord_RATE1", wait_until="networkidle")
    page.wait_for_timeout(500)
    # NOT before delivery: no sheet on the ready screen
    if not sheet_visible(page):
        ok("trigger: no prompt before install is confirmed")
    else:
        bad("trigger: prompt shown before delivery")
    confirm_install(page, "ord_RATE1")
    if sheet_visible(page):
        ok("trigger: prompt at the 'Installation successful!' moment")
    else:
        bad("trigger: prompt missing after install success")
    # header + chip + stars + maybe later
    if page.get_by_text("Enjoying Jum e-SIM?").count() == 1:
        ok("sheet: exact header copy")
    else:
        bad("sheet: header copy wrong")
    chip = page.locator("span", has_text="Japan")
    chip_html = chip.first.inner_html() if chip.count() else ""
    if chip.count() == 1 and "5GB" in chip_html and "7 days" in chip_html:
        ok("sheet: plan chip (flag · 5GB · 7 days)")
    else:
        bad("sheet: plan chip wrong")
    stars = page.get_by_role("radio")
    if stars.count() == 5:
        ok("sheet: 5 tappable stars")
    else:
        bad(f"sheet: expected 5 stars, got {stars.count()}")
    if page.get_by_role("button", name="Maybe later").count() == 1:
        ok("sheet: 'Maybe later' dismiss")
    else:
        bad("sheet: 'Maybe later' missing")

    # 5 stars → store review (web build → jumesim.com/rate)
    page.get_by_role("radio", name="5 stars").click()
    page.wait_for_timeout(600)
    opened = page.evaluate("window.__opened")
    if opened and opened[-1] == "https://jumesim.com/rate":
        ok("5 stars: opens jumesim.com/rate (web store-review path)")
    else:
        bad(f"5 stars: store URL wrong: {opened}")
    if not sheet_visible(page):
        ok("5 stars: sheet closes after rating")
    else:
        bad("5 stars: sheet still open")
    ev = last_event(page, "rating_prompt_shown")
    if ev and ev["data"].get("orderId") == "ord_RATE1":
        ok("analytics: rating_prompt_shown { orderId }")
    else:
        bad(f"analytics: rating_prompt_shown wrong: {ev}")
    ev = last_event(page, "rating_store_opened")
    if ev and ev["data"].get("stars") == 5:
        ok("analytics: rating_store_opened { stars: 5 }")
    else:
        bad(f"analytics: rating_store_opened wrong: {ev}")
    if not last_event(page, "rating_support_routed"):
        ok("analytics: no support routing on a 5-star rating")
    else:
        bad("analytics: support routed on 5 stars")
    state = rating_state(page)
    if state.get("rated") is True:
        ok("state: rated flag persisted")
    else:
        bad(f"state: rated flag missing: {state}")
    if "ord_RATE1" in state.get("perOrder", {}):
        ok("state: perOrder consumed for this order")
    else:
        bad("state: perOrder missing order")

    # auto-advance to setup after the sheet closes
    page.wait_for_timeout(1500)
    if "/setup/ord_RATE1" in page.url:
        ok("flow: auto-advances to Get Connected after rating")
    else:
        bad(f"flow: did not advance to setup: {page.url}")
    ctx.close()

    # ══ 2 — 2 stars → WhatsApp, never the store ══
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    ctx.add_init_script(seed_purchase("ord_RATE2"))
    page = ctx.new_page()
    confirm_install(page, "ord_RATE2")
    if sheet_visible(page):
        ok("2-star flow: prompt shown")
    else:
        bad("2-star flow: prompt missing")
    page.get_by_role("radio", name="2 stars").click()
    page.wait_for_timeout(600)
    opened = page.evaluate("window.__opened")
    if opened and opened[-1].startswith("https://wa.me/23233129788?text="):
        ok("2 stars: routes to WhatsApp support chat")
    else:
        bad(f"2 stars: WhatsApp URL wrong: {opened}")
    if opened and any("jumesim.com/rate" in u for u in opened):
        bad("2 stars: store redirect on a LOW rating (must never happen)")
    else:
        ok("2 stars: NO store redirect (deliberate split)")
    if "I%20rated%20my%20experience%202%20stars%20because" in (opened[-1] if opened else ""):
        ok("2 stars: prefill 'Hi! I rated my experience 2 stars because…'")
    else:
        bad("2 stars: prefill wrong")
    ev = last_event(page, "rating_support_routed")
    if ev and ev["data"].get("stars") == 2:
        ok("analytics: rating_support_routed { stars: 2 }")
    else:
        bad(f"analytics: rating_support_routed wrong: {ev}")
    if not last_event(page, "rating_store_opened"):
        ok("analytics: no rating_store_opened on 2 stars")
    else:
        bad("analytics: store opened on 2 stars")
    state = rating_state(page)
    if state.get("rated") is not True:
        ok("state: low rating does NOT set the rated flag (support may fix it)")
    else:
        bad("state: rated flag set on a low rating")
    ctx.close()

    # ══ 3 — Maybe later → 90-day global cap ══
    # both orders seeded upfront: the app store re-persists its own
    # in-memory purchases on change, clobbering mid-run localStorage edits
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    ctx.add_init_script(seed_two_purchases("ord_RATE3", "ord_RATE3b"))
    page = ctx.new_page()
    confirm_install(page, "ord_RATE3")
    page.get_by_role("button", name="Maybe later").click()
    page.wait_for_timeout(500)
    if not sheet_visible(page):
        ok("maybe-later: sheet dismisses")
    else:
        bad("maybe-later: sheet still open")
    ev = last_event(page, "rating_dismissed")
    if ev and ev["data"].get("orderId") == "ord_RATE3":
        ok("analytics: rating_dismissed { orderId }")
    else:
        bad(f"analytics: rating_dismissed wrong: {ev}")
    # second order immediately after dismissal → 90-day global cap blocks it.
    # let the ineligible path's 1800ms auto-advance timer fire BEFORE driving
    # the next order — otherwise it hijacks the navigation mid-test
    page.wait_for_timeout(2100)
    confirm_install(page, "ord_RATE3b")
    if not sheet_visible(page):
        ok("90-day cap: second order right after dismissal NOT prompted")
    else:
        bad("90-day cap: second order prompted too soon")
    # same order re-confirmed → never again (1 prompt per eSIM). Reload the
    # ORIGINAL seed (two orders) since the store re-persists on change and
    # confirming flips status to installed.
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
    ctx2.add_init_script(OPEN_CAPTURE)
    ctx2.add_init_script(seed_purchase("ord_RATE3"))
    ctx2.add_init_script(seed_rating_state({
        # lastPromptAt 0 → the 90-day cap is NOT in play; only perOrder can
        # block the prompt, isolating the 1-prompt-per-eSIM rule
        "lastPromptAt": 0,
        "rated": False,
        "perOrder": {"ord_RATE3": int(__import__("time").time() * 1000) - 1000},
        "supportActiveUntil": 0,
    }))
    page2 = ctx2.new_page()
    confirm_install(page2, "ord_RATE3")
    if not sheet_visible(page2):
        ok("1-per-order: no prompt on re-confirm of the same eSIM")
    else:
        bad("1-per-order: prompt repeated for the same order")
    ctx2.close()
    ctx.close()

    # ══ 4 — never during an active support conversation ══
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    ctx.add_init_script(seed_purchase("ord_RATE4"))
    ctx.add_init_script(seed_rating_state({
        "lastPromptAt": 0, "rated": False, "perOrder": {},
        "supportActiveUntil": int(__import__("time").time() * 1000) + 86400000,
    }))
    page = ctx.new_page()
    confirm_install(page, "ord_RATE4")
    if not sheet_visible(page):
        ok("support gate: no prompt during an active support conversation")
    else:
        bad("support gate: prompt shown mid-conversation")
    ctx.close()

    # ══ 5 — checkout wallet analytics ══
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_placeholder(re.compile("Search|Where")).first.fill("Japan")
    page.wait_for_timeout(300)
    page.get_by_text("Japan", exact=True).first.click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name=re.compile(r"^5 GB")).first.click()
    page.get_by_role("button", name=re.compile(r"Continue · 5GB \$8\.99")).click()
    page.wait_for_timeout(600)
    # web preview: only Card is visible; selecting it fires the event
    if page.get_by_role("button", name="Apple Pay", exact=True).count() == 0 and \
       page.get_by_role("button", name="Google Pay", exact=True).count() == 0:
        ok("checkout: wallet rows hidden in web preview (Card only)")
    else:
        bad("checkout: wallet rows visible in web preview")
    page.locator("#email").fill("traveller@example.com")
    page.get_by_role("button", name="Credit or debit card").click()
    page.locator("#card-number").fill("4242424242424242")
    page.locator("#card-expiry").fill("1228")
    page.locator("#card-cvc").fill("123")
    page.locator('input[type="checkbox"]').first.check()
    page.get_by_role("button", name=re.compile(r"^Pay \$")).click()
    page.wait_for_timeout(2500)
    ev = last_event(page, "payment_method_selected")
    if ev and ev["data"].get("method") == "card":
        ok("analytics: payment_method_selected { method: card }")
    else:
        bad(f"analytics: payment_method_selected wrong: {ev}")
    if "/install/" in page.url:
        ok("checkout: test payment completes to Installation screen")
        ev = last_event(page, "payment_success")
        if ev and ev["data"].get("method") == "card":
            ok("analytics: payment_success { method: card }")
        else:
            bad(f"analytics: payment_success wrong: {ev}")
    else:
        bad(f"checkout: did not reach install screen: {page.url}")
    # failure path: decline confirm-order → payment_failed { method, reason }
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
    ev = last_event(page, "payment_failed")
    if ev and ev["data"].get("method") == "card" and ev["data"].get("reason"):
        ok(f"analytics: payment_failed {{ method, reason: {ev['data']['reason']} }}")
    else:
        bad(f"analytics: payment_failed wrong: {ev}")
    ctx.close()

    browser.close()

print()
if errors:
    print(f"RATING E2E: {len(errors)} FAILURES")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print("RATING E2E: ALL PASS")
