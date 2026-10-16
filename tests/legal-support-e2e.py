#!/usr/bin/env python3
"""Module 9 verification — legal pages (in-app + hosted) and support chat.

Requires: API server (:8789, `npm run api`) and preview (:4173, `npm run preview`).

Covers:
  A. in-app legal pages  — /legal/{privacy,terms,refund}, Last updated, back,
                           legal_page_viewed analytics
  B. hosted static pages — /privacy/, /terms/, /refund/ served by the same build
  C. contact row         — Help → Contact support opens chat (never a dead link)
  D. chat backend mode   — real POSTs to /api/support/chat: greeting + chips,
                           numbered steps + "Did this fix it?", 2-strike
                           escalation, refund eligibility → confirmation card,
                           Confirm executes refund via /api/refund
  E. fallback            — backend unreachable → banner + prefilled email link
  F. analytics           — chat_opened / chat_message_sent / bot_escalated_human
                           / refund_confirmed_via_chat / legal_page_viewed
"""
import json
import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"

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

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    suffix = (" — " + detail) if (detail and not ok) else ""
    print(f"{PASS if ok else FAIL}  {name}{suffix}")


def analytics_events(page):
    return page.evaluate(
        """() => {
          try {
            return JSON.parse(localStorage.getItem('jum-esim:analytics:v1') || '[]').map(e => e.event)
          } catch { return [] }
        }"""
    )


def wait_body(page, needle, timeout=8000):
    """Poll until `needle` appears in <body> text (case-insensitive)."""
    page.wait_for_function(
        """(n) => document.body.innerText.toLowerCase().includes(n.toLowerCase())""",
        arg=needle,
        timeout=timeout,
    )


def seed_purchase(page, order_id, iccid, price=6.99):
    """Minimal Purchase record so orderContext resolves on this device."""
    purchase = {
        "order": {
            "id": order_id,
            "iccid": iccid,
            "qrUrl": "https://esim.jum.app/qr/test.png",
            "lpaString": "LPA:1$esim.jum.app$TEST",
            "planId": "germany-5gb-30d",
            "email": "tester@example.com",
            "createdAt": 1700000000000,
        },
        "plan": {
            "id": "germany-5gb-30d",
            "countrySlug": "germany",
            "name": "Germany 5GB",
            "dataGB": 5,
            "days": 30,
            "priceUSD": price,
            "wholesaleUSD": 5.0,
            "fiveG": True,
            "networks": ["T-Mobile DE"],
            "hotspot": True,
            "group": "data",
            "label": "5 GB",
        },
        "country": {
            "slug": "germany",
            "name": "Germany",
            "iso2": "DE",
            "flag": "DE",
            "region": "europe",
            "fiveG": True,
            "networks": ["T-Mobile DE"],
            "popular": True,
        },
        "status": "not_installed",
        "installedAt": None,
    }
    page.evaluate(
        """(p) => localStorage.setItem('jum-esim:purchases:v1', JSON.stringify([p]))""",
        purchase,
    )


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])

    # ── A. in-app legal pages ────────────────────────────────────────────
    page = browser.new_page()
    page.goto(f"{BASE}/help", wait_until="networkidle")

    for label, path, needles in [
        ("Privacy Policy", "/legal/privacy", ["GDPR", "7 years", "12 months", "encrypted in transit", "october 7, 2026"]),
        ("Terms of Service", "/legal/terms", ["2.5 GB/day", "512 kbps", "estonia", "courts of tallinn", "as is"]),
        ("Refund Policy", "/legal/refund", ["14 days", "5–10 business days", "never connected", "profile → help"]),
    ]:
        page.get_by_role("button", name=re.compile(f"^{label}$")).click()
        page.wait_for_url(re.compile(re.escape(path)))
        wait_body(page, needles[0])
        body = page.locator("main").inner_text().lower()
        missing = [n for n in needles if n.lower() not in body]
        check(f"in-app {label} content", not missing, f"missing {missing}")
        page.get_by_role("button", name="Back").first.click()
        page.wait_for_url(re.compile(r"/help$"))

    seen = analytics_events(page)
    check("legal_page_viewed tracked ×3", seen.count("legal_page_viewed") == 3,
          f"got {seen.count('legal_page_viewed')}")
    page.close()

    # ── B. hosted static versions ────────────────────────────────────────
    ctx = browser.new_context()
    for path, needles in [
        ("/privacy/", ["Jum e-SIM", "Last updated", "GDPR", "support@jumesim.com"]),
        ("/terms/", ["Terms of Service", "2.5 GB/day", "Estonia"]),
        ("/refund/", ["Refund Policy", "14 days", "5–10 business days"]),
    ]:
        resp = ctx.request.get(f"{BASE}{path}")
        text = resp.text()
        missing = [n for n in needles if n not in text]
        check(f"hosted {path}", resp.status == 200 and not missing,
              f"status={resp.status} missing={missing}")
    ctx.close()

    # ── C. contact row opens chat ────────────────────────────────────────
    page = browser.new_page()
    page.goto(f"{BASE}/help", wait_until="networkidle")
    page.get_by_role("button", name=re.compile(r"Contact support")).click()
    page.wait_for_url(re.compile(r"/support/chat"))
    wait_body(page, "what do you need help with")
    body = page.locator("main").inner_text()
    check("chat greeting visible", "Jum Assistant" in page.locator("header").inner_text()
          and "AI assistant" in page.locator("header").inner_text())
    for chip in ["eSIM won't install", "No internet connection", "Check my order", "Request a refund", "Something else"]:
        check(f"chip present: {chip}", page.get_by_role("button", name=chip).count() == 1)
    check("chat_opened tracked", "chat_opened" in analytics_events(page))

    # ── D. connection troubleshooting → 2-strike escalation ──────────────
    page.get_by_role("button", name="No internet connection").click()
    wait_body(page, "Data Roaming")
    body = page.locator("main").inner_text()
    check("numbered steps reply", "1." in body and "2." in body and "Data Roaming" in body)
    check("'Did this fix it?' chips", page.get_by_role("button", name="Yes ✓").count() == 1
          and page.get_by_role("button", name="No, more help").count() == 1)
    check("chat_message_sent tracked", "chat_message_sent" in analytics_events(page))

    page.get_by_role("button", name="No, more help").click()
    wait_body(page, "one more thing to try")
    page.get_by_role("button", name="No, more help").click()
    wait_body(page, "Connecting you to our team")
    check("escalation after 2 failed fixes", True)
    check("escalation offers transcript email",
          page.get_by_role("link", name="Email my transcript").count() == 1)
    check("bot_escalated_human tracked", "bot_escalated_human" in analytics_events(page))

    href = page.get_by_role("link", name="Email my transcript").first.get_attribute("href")
    check("transcript mailto prefilled", bool(href) and href.startswith("mailto:support@jumesim.com")
          and "transcript" in href.lower() and "Device" in href and "Jum%20Assistant" in href,
          f"href={(href or '')[:120]}")

    # ── E. refund guardrail: check → card → explicit confirm ─────────────
    resp = page.request.post(
        f"{BASE}/api/confirm-order",
        data=json.dumps({"planId": "germany-5gb-30d", "email": "tester@example.com"}),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {SETUP_TOKEN}"},
    )
    order = resp.json()
    seed_purchase(page, order["orderId"], order["iccid"])

    page.goto(f"{BASE}/support/chat?orderId={order['orderId']}", wait_until="networkidle")
    wait_body(page, "what do you need help with")
    page.get_by_role("button", name="Request a refund").click()
    wait_body(page, "eligible for a full refund")
    body = page.locator("main").inner_text()
    check("refund eligibility explained from orderContext",
          "never connected" in body and order["orderId"][:8] in body)
    check("confirmation card shown", "Refund $6.99 to your card?" in body)
    check("no premature refund", "on its way" not in body)

    page.get_by_role("button", name="Cancel").click()
    page.wait_for_timeout(300)
    check("cancel dismisses card", "Refund $6.99 to your card?" not in page.locator("main").inner_text())

    # second request via the text input (typed path, not just chips)
    page.get_by_label("Message").fill("Request a refund")
    page.get_by_role("button", name="Send").click()
    wait_body(page, "Refund $6.99 to your card?")
    page.get_by_role("button", name="Confirm").click()
    wait_body(page, "refund is on its way", timeout=10000)
    check("refund executes after explicit confirm", True)
    check("refund_confirmed_via_chat tracked", "refund_confirmed_via_chat" in analytics_events(page))

    # idempotent re-mark confirms the order exists and is refunded server-side
    refund_resp = page.request.post(
        f"{BASE}/api/refund",
        data=json.dumps({"orderId": order["orderId"]}),
        headers={"Content-Type": "application/json"},
    )
    check("order recorded refunded server-side",
          refund_resp.status == 200 and refund_resp.json().get("status") == "refunded",
          f"status={refund_resp.status} body={refund_resp.text()[:120]}")

    # ── F. backend-down → email fallback ─────────────────────────────────
    page.route(re.compile(r".*/api/support/chat$"), lambda r: r.abort())
    page.goto(f"{BASE}/support/chat", wait_until="networkidle")
    page.get_by_label("Message").fill("hello?")
    page.get_by_role("button", name="Send").click()
    wait_body(page, "Support server unreachable")
    check("unreachable-backend banner", True)
    email_link = page.get_by_role("link", name="Email us instead")
    check("email fallback link present", email_link.count() == 1)
    if email_link.count():
        href = email_link.first.get_attribute("href")
        check("fallback mailto prefilled", bool(href) and "mailto:support@jumesim.com" in (href or "")
              and "Order" in (href or ""),
              f"href={(href or '')[:140]}")
    page.close()

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
