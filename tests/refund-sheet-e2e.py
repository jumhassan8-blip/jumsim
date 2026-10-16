#!/usr/bin/env python3
"""Profile Refund card + "Choose an eSIM to refund" sheet (Module 14).

Requires: API server (:8789, fresh) + preview (:4173, prod build).

Covers the spec:
  □ Refund card sits between the WhatsApp card and the Help row, always
    visible, lime-accented (icon circle, title, subtitle, lime chevron)
  □ No purchases: subtitle flips, tap routes to Browse destinations
  □ Badge: lime dot only while ≥1 eSIM is refundable
  □ Sheet lists purchases with correct per-row states (green / gray / gray)
  □ Unused → confirm slide → executes → "Refunded ✓ — guarantee honored"
  □ In-use row not tappable; expired row routes to WhatsApp with order ctx
  □ Analytics: refund_card_tapped, refund_sheet_viewed, refund_confirmed,
    refund_rejected_in_use, refund_executed
"""
import json
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:8789"
URL = "http://127.0.0.1:4173"
errors = []


def ok(name):
    print(f"  OK {name}")


def bad(name):
    print(f"  FAIL {name}")
    errors.append(name)



def _setup_token():
    """Local-dev server-to-server token (same machine, .env.local is gitignored).
    Never printed; falls back to the PROVIDER_SETUP_TOKEN env var."""
    import os
    from pathlib import Path
    if os.environ.get("PROVIDER_SETUP_TOKEN"):
        return os.environ["PROVIDER_SETUP_TOKEN"]
    env_local = Path(__file__).resolve().parent.parent / ".env.local"
    if env_local.exists():
        for line in env_local.read_text().splitlines():
            if line.startswith("PROVIDER_SETUP_TOKEN="):
                return line.split("=", 1)[1].strip()
    return ""

SETUP_TOKEN = _setup_token()

def post(path, payload):
    req = urllib.request.Request(
        API + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {SETUP_TOKEN}"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def create_order(fp):
    s, b = post("/api/confirm-order", {
        "planId": "japan-5gb-30d", "email": "traveller@example.com",
        "cardFingerprint": fp})
    assert s == 200, f"confirm-order failed: {s} {b}"
    return b


def note_usage(iccid, kb=1):
    s, b = post("/api/webhooks/esimgo", {"iccid": iccid, "type": "usage", "usedKB": kb})
    assert s == 200, b


def seed_purchases(orders):
    arr = ",".join(f"""
  {{
    order: {{
      id: '{o['orderId']}', iccid: '{o['iccid']}',
      qrUrl: '{o['qrUrl']}', lpaString: '{o['lpaString']}',
      planId: '{o['planId']}', email: '{o['email']}',
      createdAt: {o['createdAt']},
    }},
    plan: {{
      id: '{o['planId']}', countrySlug: 'japan', name: '5GB · 30 days',
      dataGB: 5, days: 30, priceUSD: {o['priceUSD']}, wholesaleUSD: 6, fiveG: true,
      networks: ['SoftBank'], hotspot: true, group: 'data', label: '30 Days',
    }},
    country: {{
      slug: 'japan', name: 'Japan', iso2: 'JP', flag: '🇯🇵',
      region: 'asia-pacific', fiveG: true, networks: ['SoftBank'], popular: true,
    }},
    status: 'not_installed',
    installedAt: null,
  }}""" for o in orders)
    return f"localStorage.setItem('jum-esim:purchases:v1', JSON.stringify([{arr}]))"


def analytics(page):
    return page.evaluate(
        "(k) => JSON.parse(localStorage.getItem(k) || '[]')", "jum-esim:analytics:v1")


def fired(page):
    return {e["event"] for e in analytics(page)}


OPEN_CAPTURE = """
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])

    # ── no purchases: card visible, routes to Browse destinations ──
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page.goto(f"{URL}/profile", wait_until="networkidle")
    page.wait_for_timeout(700)
    card = page.get_by_text("Refund — money-back guarantee").locator(
        "xpath=ancestor::button[1]")
    wa_card = page.get_by_text("Chat with us on WhatsApp").locator(
        "xpath=ancestor::button[1]")
    help_row = page.get_by_text("FAQ · contact support").locator(
        "xpath=ancestor::button[1]")
    if card.count() == 1 and wa_card.count() == 1 and help_row.count() == 1:
        wa_b = wa_card.bounding_box()
        c = card.bounding_box()
        h = help_row.bounding_box()
        if wa_b["y"] < c["y"] < h["y"]:
            ok("placement: Refund card sits between the WhatsApp card and Help row")
        else:
            bad(f"placement wrong: wa@{wa_b['y']} card@{c['y']} help@{h['y']}")
    else:
        bad("card/whatsapp/help row missing")
    card_html = card.inner_html()
    if "bg-[#D7FF3F]" in card_html and "text-[#D7FF3F]" in card_html:
        ok("styling: lime icon circle + lime chevron")
    else:
        bad("styling: lime accents missing")
    if "Buy a plan first — refunds are instant while it’s unused" in card.inner_text():
        ok("empty: subtitle 'Buy a plan first…'")
    else:
        bad("empty: subtitle wrong")
    if card.get_by_label("refundable eSIM available").count() == 0:
        ok("empty: no badge dot without purchases")
    else:
        bad("empty: badge dot shown without purchases")
    card.click()
    page.wait_for_timeout(600)
    if "/explore" in page.url:
        ok("empty: tap routes to Browse destinations (never a dead tap)")
    else:
        bad(f"empty: tap went to {page.url}")
    ctx.close()

    # ── with purchases: badge, sheet, row states, execution ──
    # order matters: the fake-clock ticks below sweep EVERY live order, so
    # the refundable/in-use orders must be created AFTER the held-order dance
    # expired-row order: exhaust the same-card cap (2 engine refunds), then a
    # third order on that card gets held in manual review at T+10 — the
    # expired surface
    fp_hold = f"fp_sheet_hold_{int(time.time() * 1000)}"
    for _ in range(2):
        o_r = create_order(fp_hold)
        post("/api/guarantee/tick", {"now": o_r["createdAt"] + 11 * 60_000})
    o_hold = create_order(fp_hold)
    post("/api/guarantee/tick", {"now": o_hold["createdAt"] + 11 * 60_000})
    _s, _g = post("/api/orders/status", {"orderIds": [o_hold["orderId"]]})
    assert _g["orders"][o_hold["orderId"]]["manualReview"], "o_hold must be held for the expired row"
    o_unused = create_order(f"fp_sheet_u_{int(time.time() * 1000)}")
    o_used = create_order(f"fp_sheet_used_{int(time.time() * 1000)}")
    note_usage(o_used["iccid"], kb=1)

    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    ctx.add_init_script(seed_purchases([o_unused, o_used, o_hold]))
    page = ctx.new_page()
    page.goto(f"{URL}/profile", wait_until="networkidle")
    page.wait_for_timeout(1000)
    card = page.get_by_text("Refund — money-back guarantee").locator(
        "xpath=ancestor::button[1]")
    if "1 tap to refund any unused eSIM" in card.inner_text():
        ok("with purchases: subtitle '1 tap to refund any unused eSIM'")
    else:
        bad("with purchases: subtitle wrong")
    if card.get_by_label("refundable eSIM available").count() == 1:
        ok("badge: lime dot while an eSIM is refundable")
    else:
        bad("badge: lime dot missing")
    card.click()
    page.wait_for_timeout(500)
    if page.get_by_role("dialog", name="Choose an eSIM to refund").count() == 1:
        ok("tap → sheet opens")
    else:
        bad("sheet missing")
    ev = [e for e in analytics(page) if e["event"] == "refund_card_tapped"]
    if ev and ev[-1]["data"].get("hasPurchases") is True:
        ok("analytics: refund_card_tapped { hasPurchases: true }")
    else:
        bad(f"analytics: refund_card_tapped wrong: {ev}")
    if "refund_sheet_viewed" in fired(page):
        ok("analytics: refund_sheet_viewed")
    else:
        bad("analytics: refund_sheet_viewed missing")

    # row states
    sheet = page.get_by_label("Choose an eSIM to refund")
    if sheet.get_by_role("button", name=re.compile(r"^Refund \$8\.99")).count() == 1:
        ok("rows: exactly one lime refundable row")
    else:
        bad("rows: refundable row count wrong")
    if sheet.get_by_text("No refund — plan in use").count() == 1:
        ok("rows: in-use row gray with exact copy")
    else:
        bad("rows: in-use row missing")
    if sheet.get_by_text("Guarantee expired").count() == 1:
        ok("rows: expired row gray with exact copy")
    else:
        bad("rows: expired row missing")
    # in-use row must not be tappable
    sheet.get_by_text("No refund — plan in use").click()
    page.wait_for_timeout(300)
    if page.get_by_text("Money back in 5–10 days").count() == 0:
        ok("rows: in-use row tap does nothing (no confirm slide)")
    else:
        bad("rows: in-use row opened the confirm slide!")

    # expired "Need help?" → WhatsApp with order context
    sheet.get_by_role("button", name="Need help?").click()
    page.wait_for_timeout(500)
    opened = page.evaluate("window.__opened")
    if opened and opened[-1].startswith("https://wa.me/23233129788?text="):
        ok("expired: Need help? routes to WhatsApp")
    else:
        bad(f"expired: WhatsApp url wrong: {opened}")
    if opened and f"order%20{o_hold['orderId']}" in opened[-1]:
        ok("expired: order context pre-filled")
    else:
        bad("expired: order context missing")

    # unused → confirm slide → execute
    sheet.get_by_role("button", name=re.compile(r"^Refund \$8\.99")).click()
    page.wait_for_timeout(400)
    if page.get_by_text("Money back in 5–10 days. This eSIM stops working.").count() == 1:
        ok("confirm slide: exact copy")
    else:
        bad("confirm slide: copy wrong")
    page.get_by_role("button", name="Keep my eSIM").click()
    page.wait_for_timeout(300)
    if page.get_by_text("Choose an eSIM to refund").count() == 1:
        ok("confirm slide: Keep my eSIM slides back to the list")
    else:
        bad("confirm slide: back navigation failed")

    sheet.get_by_role("button", name=re.compile(r"^Refund \$8\.99")).click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Confirm refund").click()
    page.wait_for_timeout(1500)
    if sheet.get_by_text("Refunded ✓ — guarantee honored").count() == 1:
        ok("executed: row becomes 'Refunded ✓ — guarantee honored'")
    else:
        bad("executed: honor state missing")
    for want in ("refund_confirmed", "refund_executed"):
        if want in fired(page):
            ok(f"analytics: {want}")
        else:
            bad(f"analytics: {want} missing")
    # badge dot gone (nothing refundable left)
    page.get_by_role("button", name="Close").click()
    page.wait_for_timeout(400)
    card = page.get_by_text("Refund — money-back guarantee").locator(
        "xpath=ancestor::button[1]")
    if card.get_by_label("refundable eSIM available").count() == 0:
        ok("badge: dot disappears once nothing is refundable")
    else:
        bad("badge: dot still shown after refund")
    ctx.close()

    # ── RACE in the sheet: confirm while first connection happens ──
    orr = create_order(f"fp_sheet_race_{int(time.time() * 1000)}")
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(seed_purchases([orr]))
    page = ctx.new_page()
    page.goto(f"{URL}/profile", wait_until="networkidle")
    page.wait_for_timeout(900)
    page.get_by_text("Refund — money-back guarantee").click()
    page.wait_for_timeout(400)
    race_sheet = page.get_by_label("Choose an eSIM to refund")
    race_sheet.get_by_role("button", name=re.compile(r"^Refund \$8\.99")).click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Confirm refund").wait_for()
    note_usage(orr["iccid"], kb=1)  # first connection, milliseconds before confirm
    page.get_by_role("button", name="Confirm refund").click()
    page.wait_for_timeout(1500)
    if race_sheet.get_by_text("No refund — plan in use").count() == 1 and \
       race_sheet.get_by_text("Refunded ✓").count() == 0:
        ok("race: server rejected it — row flipped to in_use, nothing refunded")
    else:
        bad("race: refund executed despite the connection")
    if "refund_rejected_in_use" in fired(page):
        ok("analytics: refund_rejected_in_use")
    else:
        bad("analytics: refund_rejected_in_use missing")
    ctx.close()
    browser.close()

print()
if errors:
    print(f"REFUND SHEET E2E: {len(errors)} FAILURES")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print("REFUND SHEET E2E: ALL PASS")
