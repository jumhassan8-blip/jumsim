#!/usr/bin/env python3
"""Anti-cheat refund — end-to-end verification (USER-REQUESTED ONLY).

Requires: API server (:8789, fresh — the suite creates its own orders) and
preview (:4173, prod build) for the UI surfaces.

Covers the spec:
  □ Buy → execute → Stripe refunded AND supplier-terminated (mock registry),
    install payload purged, idempotent replay
  □ Activated/used eSIM → Step 1 denies 'in_use', zero money moved
  □ Simulated supplier-cancellation failure → no refund, admin alert path
  □ Double-tap race → idempotency lock ('Refund in progress'), one refund
  □ UI: Installation + My eSIMs button with countdown, confirm sheet,
    refunded card state
"""
import json
import re
import sys
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:8789"
URL = "http://127.0.0.1:4173"
errors = []


def ok(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        errors.append(label)



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

def post(path, payload, headers=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json",
                 "Authorization": f"Bearer {SETUP_TOKEN}", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def create_order():
    status, body = post("/api/confirm-order", {
        "planId": "japan-5gb-30d",  # JP 5GB = $8.99 in pricing.json
        "email": "traveller@example.com",
        "clientSecret": "pi_mock_test_secret_mock",
    })
    assert status == 200, f"confirm-order failed: {status} {body}"
    return body


def execute(order_id, headers=None):
    return post("/api/refund/execute", {"orderId": order_id}, headers)


def order_status(order_id):
    status, body = post("/api/orders/status", {"orderIds": [order_id]})
    assert status == 200, body
    return body["orders"][order_id]


def note_usage(iccid, used_kb=1):
    status, body = post("/api/webhooks/esimgo", {
        "iccid": iccid, "type": "usage", "usedKB": used_kb,
    })
    assert status == 200, body


def event_names(st):
    return [e["event"] for e in st.get("events", [])]


# ═══ 1. happy path: refund executes, terminates, purges, replays ═══════════
o1 = create_order()
st, r1 = execute(o1["orderId"])
ok(st == 200 and r1.get("ok") is True, "execute → ok:true")
ok(r1.get("status") == "refunded_terminated", "status refunded_terminated")
ok(isinstance(r1.get("amountUSD"), (int, float)), "amountUSD returned")
ok(r1.get("refundedAt"), "refundedAt returned")

s1 = order_status(o1["orderId"])
ev = event_names(s1)
ok(s1["status"] == "refunded_terminated", "orders/status shows refunded_terminated")
ok(s1.get("terminatedAt"), "terminatedAt stamped")
ok(s1.get("windowOpen") is False, "window closed after refund")
for name in ("refund_gate_passed", "refund_terminate_confirmed", "refund_executed"):
    ok(name in ev, f"event recorded: {name}")

st, r1b = execute(o1["orderId"])
ok(st == 200 and r1b.get("ok") is True and r1b.get("idempotent") is True,
   "replay is idempotent success")

# ═══ 2. in-use denial: used eSIM → denied, zero money moved ════════════════
o2 = create_order()
note_usage(o2["iccid"], used_kb=1)
st, r2 = execute(o2["orderId"])
ok(st == 200 and r2.get("ok") is False and r2.get("reason") == "in_use",
   "used eSIM denied in_use")
ok("no refund" in (r2.get("message") or "").lower() or "Already in use" in (r2.get("message") or ""),
   "denial message tells the user why")
s2 = order_status(o2["orderId"])
ok(s2["status"] != "refunded_terminated" and not s2.get("terminatedAt"),
   "denied order: no termination, no refund")
ok("refund_denied_in_use" in event_names(s2), "event recorded: refund_denied_in_use")
ok(s2.get("refundInProgress") is not True, "denied order not left locked")

# ═══ 3. supplier-cancellation failure → NO refund ══════════════════════════
o3 = create_order()
st, r3 = execute(o3["orderId"], headers={"x-mock-terminate-fail": "1"})
ok(st == 200 and r3.get("ok") is False and r3.get("reason") == "cant_terminate",
   "terminate failure denied cant_terminate")
ok("team will handle" in (r3.get("message") or "").lower() or "safely cancel" in (r3.get("message") or "").lower(),
   "user told a human will handle it")
s3 = order_status(o3["orderId"])
ok(s3["status"] != "refunded_terminated", "no refund after terminate failure")
ok(s3.get("refundInProgress") is not True, "lock released after terminate failure")
ok("refund_denied_cant_terminate" in event_names(s3),
   "event recorded: refund_denied_cant_terminate")
# and the order is still refundable afterwards (retry works)
st, r3b = execute(o3["orderId"])
ok(st == 200 and r3b.get("ok") is True, "retry after transient failure succeeds")

# ═══ 4. double-tap race: idempotency lock ══════════════════════════════════
import threading
o4 = create_order()
results = []


def fire():
    results.append(execute(o4["orderId"]))


threads = [threading.Thread(target=fire) for _ in range(5)]
for t in threads:
    t.start()
for t in threads:
    t.join()
real = [r for _, r in results if r.get("ok") is True and not r.get("idempotent")]
idempotent = [r for _, r in results if r.get("idempotent") is True]
locked = [r for _, r in results if "refund_in_progress" in json.dumps(r)]
ok(len(real) == 1, f"exactly one refund executed ({len(real)}/5)")
ok(len(locked) + len(idempotent) == 4,
   f"losers answered lock or idempotent replay ({len(locked)} locked, {len(idempotent)} replay)")
s4 = order_status(o4["orderId"])
ok(event_names(s4).count("refund_executed") == 1, "exactly one refund_executed event")

# ═══ 5. UI: Installation + My eSIMs button, confirm sheet, refunded card ═══
o5 = create_order()
purchase = {
    "order": {
        "id": o5["orderId"],
        "iccid": o5["iccid"],
        "qrUrl": o5["qrUrl"],
        "lpaString": o5["lpaString"],
        "planId": o5["planId"],
        "email": o5["email"],
        "createdAt": o5["createdAt"],
    },
    "plan": {"id": o5["planId"], "dataGB": 5, "days": 30, "priceUSD": o5["priceUSD"]},
    "country": {"slug": "japan", "name": "Japan", "flag": "🇯🇵"},
    "status": "not_installed",
    "installedAt": None,
}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    page = browser.new_page()
    page.goto(URL + "/profile")
    page.evaluate(
        "(p) => localStorage.setItem('jum-esim:purchases:v1', JSON.stringify([p]))",
        purchase,
    )
    page.reload()

    # My eSIMs card: countdown chip + refund CTA (auto-waits for the
    # guarantee poll to land)
    chip = page.locator("text=Guarantee valid for").first
    try:
        chip.wait_for(state="visible", timeout=10_000)
        ok(True, "My eSIMs card shows 'Guarantee valid for' countdown")
    except Exception:
        ok(False, "My eSIMs card shows 'Guarantee valid for' countdown")
    cta = page.get_by_role("button", name=re.compile(r"Request refund")).first
    ok(cta.is_visible(), "My eSIMs card refund CTA visible")

    # Installation screen: banner + CTA
    page.goto(f"{URL}/install/{o5['orderId']}")
    ok(page.locator("text=No signal?").first.is_visible(), "Installation banner visible")
    ok(page.get_by_role("button", name=re.compile(r"Request refund")).first.is_visible(),
       "Installation refund CTA visible")

    # confirm sheet copy
    page.get_by_role("button", name=re.compile(r"Request refund")).first.click()
    ok(page.locator("text=permanently cancelled").first.is_visible(), "confirm sheet warns permanent cancel")
    ok(page.locator("text=5–10 days").first.is_visible(), "confirm sheet states 5–10 days")
    ok(page.get_by_role("button", name="Keep my eSIM").is_visible(), "Keep my eSIM option")

    # execute the refund through the UI (confirm button lives in the sheet)
    sheet = page.get_by_role("dialog")
    sheet.get_by_role("button", name="Request refund").click()
    try:
        page.locator("text=Refunded — eSIM deactivated").first.wait_for(state="visible", timeout=8000)
        ok(True, "card flips to Refunded — eSIM deactivated")
    except Exception:
        ok(False, "card flips to Refunded — eSIM deactivated")
    ok(page.locator("text=Guarantee valid for").count() == 0,
       "countdown gone after refund")

    # cached install view re-checks: refunded order shows deactivated state
    page.goto(f"{URL}/install/{o5['orderId']}")
    try:
        page.locator("text=Refunded — eSIM deactivated").first.wait_for(state="visible", timeout=8000)
        ok(True, "cached install view shows deactivated state")
    except Exception:
        ok(False, "cached install view shows deactivated state")
    ok(page.locator("canvas, img[alt*='QR'], [data-qr]").count() == 0,
       "no QR rendered for refunded eSIM")
    browser.close()

print()
if errors:
    print(f"{len(errors)} FAILURES")
    sys.exit(1)
print("ALL PASS")
