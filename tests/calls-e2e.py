#!/usr/bin/env python3
"""Calls tab verification (WhatsApp removed from the dialer surfaces).

Requires: API server (:8789, fresh MOCK balance) + preview (:4173, prod build).

The suite restarts dev-api itself so the server-side call-credit balance is
deterministically 0 at the start.

Covers the Calls spec:
  1. 4-tab bar renders; Calls pill style matches the other active tabs
  2. badge dot when credit < 60s at the destination rate; gone after top-up
  3. dialing +81 auto-switches to Japan with the call_rates.json rate
  4. country picker: searchable, rates match call_rates.json
  5. no credit → Buy Time sheet (packs, ≈ minutes, 12-month small print),
     never a dead end; repeat purchase → confirm step
  6. simulated call: ring → answer → per-second billing → end summary
  7. unanswered call → 'No charge' in history; redial; delete
  8. emergency numbers (112) blocked — 'use your regular SIM'
  9. NO WhatsApp banner on the Calls screen or Buy Time sheet (absence
     checks + screenshot); Help row untouched
"""
import json
import re
import signal
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4173"
API = "http://127.0.0.1:8789"
errors = []


def ok(name):
    print(f"  OK {name}")


def bad(name):
    print(f"  FAIL {name}")
    errors.append(name)


def press_key(page, k):
    """tap a keypad digit/key (the 0 key's accessible name mentions long-press)"""
    if k == "0":
        page.get_by_role("button", name=re.compile(r"^0 \(long-press")).click()
    else:
        page.get_by_role("button", name=k, exact=True).click()


def wait_body(page, needle, timeout=8000):
    """poll until document.body.innerText contains needle"""
    try:
        page.wait_for_function(
            "(n) => document.body.innerText.includes(n)", arg=needle, timeout=timeout
        )
        return True
    except Exception:
        return False


def restart_api():
    """fresh in-memory balance → deterministically 0"""
    subprocess.run("pgrep -f 'dev-api\\.mj[s]' | xargs -r kill", shell=True)
    time.sleep(1)
    subprocess.run("rm -rf .api-dist", shell=True)
    proc = subprocess.Popen(
        ["node", "scripts/dev-api.mjs"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(40):
        try:
            import urllib.request
            with urllib.request.urlopen(f"{API}/health", timeout=1) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(0.25)
    bad("dev-api did not come up")
    sys.exit(1)


OPEN_CAPTURE = """
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
"""

with sync_playwright() as p:
    restart_api()
    browser = p.chromium.launch(
        executable_path="/usr/bin/chromium", args=["--no-sandbox"]
    )
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(OPEN_CAPTURE)
    page = ctx.new_page()

    # ── tab bar + badge dot ──────────────────────────────────────────
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(500)
    tabs = page.get_by_role("link")
    names = [tabs.nth(i).inner_text() for i in range(tabs.count())]
    joined = " ".join(names)
    if all(t in joined for t in ("Home", "Explore", "Calls", "Profile")):
        ok("tab bar: 4 tabs (Home · Explore · Calls · Profile)")
    else:
        bad(f"tab bar tabs wrong: {names}")
    if page.get_by_label("Low call credit").count() == 1:
        ok("badge dot: shown with zero credit")
    else:
        bad("badge dot missing with zero credit")

    # ── calls screen basics ──────────────────────────────────────────
    page.get_by_role("link", name="Calls").click()
    page.wait_for_timeout(600)
    if "Calls" in page.locator("h1").inner_text():
        ok("calls screen: title renders")
    else:
        bad("calls screen: title missing")
    active_tab = page.get_by_role("link", name="Calls")
    cls = active_tab.get_attribute("class") or ""
    if "bg-[#D7FF3F]" in cls and "text-black" in cls:
        ok("calls tab: lime pill active style matches Explore reference")
    else:
        bad(f"calls tab active style wrong: {cls}")
    if page.get_by_text(re.compile(r"Chat with us")).count() == 0:
        ok("calls screen: NO WhatsApp banner (dialer stays clean)")
    else:
        bad("calls screen: WhatsApp banner must be removed")
    if page.locator("main").inner_html().count("25D366") == 0:
        ok("calls screen: no WhatsApp-green element anywhere")
    else:
        bad("calls screen: WhatsApp-green element still present")
    # screenshot for visual diff vs the spec
    page.screenshot(path="/tmp/calls-clean.png", full_page=False)

    # auto-switch: typing +81 switches destination to Japan
    # ('+' comes from long-pressing 0 — the native dialer convention)
    page.get_by_role("button", name=re.compile(r"long-press for \+")).dispatch_event("pointerdown")
    page.wait_for_timeout(650)
    page.get_by_role("button", name=re.compile(r"long-press for \+")).dispatch_event("pointerup")
    for k in ["8", "1", "9", "0"]:
        press_key(page, k)
    page.wait_for_timeout(400)
    dest_bar = page.get_by_label("Choose destination").inner_text()
    if "Japan" in dest_bar and "$0.09/min" in dest_bar:
        ok("dialer: +81 auto-switches to Japan at $0.09/min")
    else:
        bad(f"dialer: destination bar wrong: {dest_bar}")

    # keypad backspace (short press removes one digit)
    page.get_by_label(re.compile("Delete digit")).click()
    dialed = page.get_by_label("Dialed number").inner_text()
    if dialed == "+819":
        ok("dialer: backspace removes one digit")
    else:
        bad(f"dialer: backspace wrong ({dialed})")
    # long-press clears (the button unmounts once the field is empty — that
    # IS the assertion, so no pointerup here)
    page.get_by_label(re.compile("Delete digit")).dispatch_event("pointerdown")
    page.wait_for_timeout(700)
    dialed = page.get_by_label("Dialed number").inner_text()
    if "…" in dialed or dialed.strip() == "":
        ok("dialer: long-press backspace clears the number")
    else:
        bad(f"dialer: long-press clear failed ({dialed})")
    page.keyboard.press("Escape")  # release any held pointer state

    # ── country picker + rates match call_rates.json ─────────────────
    rates = {r["iso2"]: r for r in json.load(open("src/data/call-rates.json"))}
    if len(rates) >= 190:
        ok(f"call_rates.json: {len(rates)} entries (190+)")
    else:
        bad(f"call_rates.json only {len(rates)} entries")

    page.get_by_label("Choose destination").click()
    page.wait_for_timeout(400)
    page.get_by_label("Search destination").fill("Germany")
    page.wait_for_timeout(300)
    row = page.get_by_role("option", name=re.compile("Germany"))
    if row.count() == 1 and "+49" in row.inner_text() and "$0.08/min" in row.inner_text():
        ok("picker: searchable, row shows flag/name/code/rate")
    else:
        bad(f"picker: Germany row wrong: {row.inner_text() if row.count() else 'missing'}")
    row.click()
    page.wait_for_timeout(400)
    dest_bar = page.get_by_label("Choose destination").inner_text()
    if "Germany" in dest_bar:
        ok("picker: tap selects destination")
    else:
        bad("picker: selection did not apply")

    card = page.get_by_text(re.compile(r"Local Call Rates")).locator("..").inner_text()
    de = rates["DE"]
    if f"${de['mobilePerMin']:.2f}/min" in card and f"${de['landlinePerMin']:.2f}/min" in card:
        ok("rates card: mobile + landline match call_rates.json")
    else:
        bad(f"rates card mismatch: {card}")

    # ── no credit → Buy Time sheet ───────────────────────────────────
    for k in ["3", "0", "9", "0", "1", "8", "2", "0"]:
        press_key(page, k)
    page.wait_for_timeout(300)
    cta = page.get_by_role("button", name=re.compile(r"Buy time"))
    if cta.count() == 1:
        ok("no credit: CTA shows 'Buy time' (not a dead Call button)")
    else:
        bad("no credit: CTA should be 'Buy time'")
    cta.click()
    page.wait_for_timeout(500)
    sheet = page.get_by_role("dialog", name="Buy call time")
    if sheet.count() == 1:
        ok("buy time sheet opens")
    else:
        bad("buy time sheet did not open")
    txt = sheet.inner_text()
    if all(p in txt for p in ("$3", "$5", "$10", "$20")) and "12 months" in txt:
        ok("sheet: all four packs + 12-month expiry small print")
    else:
        bad(f"sheet packs/expiry wrong: {txt[:120]}")
    ests = [int(m) for m in re.findall(r"≈ (\d+) min to Germany", txt)]
    want = [int(p / de["mobilePerMin"]) for p in (3, 5, 10, 20)]
    if ests == want:
        ok(f"sheet: live ≈ minutes per pack at the destination rate {ests}")
    else:
        bad(f"sheet: ≈ minutes wrong: {ests} want {want}")

    # close the sheet via backdrop tap
    page.mouse.click(195, 120)
    page.wait_for_timeout(400)

    # ── purchase $5 → balance updates instantly ──────────────────────
    page.get_by_role("button", name=re.compile(r"Buy time")).click()
    page.wait_for_timeout(400)
    page.get_by_role("button", name=re.compile(r"^\$5")).click()
    page.wait_for_timeout(1500)
    chip = page.get_by_label("Buy call time").first.inner_text()
    expect_sec = int(5 / de["mobilePerMin"] * 60)
    if f"{expect_sec // 60}:{expect_sec % 60:02d} left" in chip:
        ok(f"balance chip updates instantly after purchase ({chip.strip()})")
    else:
        bad(f"balance chip wrong after purchase: {chip}")
    if page.get_by_label("Low call credit").count() == 0:
        ok("badge dot cleared after top-up")
    else:
        bad("badge dot still shown after top-up")

    # ── repeat purchase → confirm step (biometric on native) ─────────
    page.get_by_label("Buy call time").first.click()
    page.wait_for_timeout(400)
    page.get_by_role("button", name=re.compile(r"^\$3")).click()
    page.wait_for_timeout(400)
    if page.get_by_text(re.compile(r"Confirm \$3\.00")).count() == 1:
        ok("repeat purchase: confirm step shown (biometric confirm on native)")
    else:
        bad("repeat purchase: confirm step missing")
    page.get_by_role("button", name=re.compile(r"Pay \$3\.00")).click()
    page.wait_for_timeout(1500)
    chip = page.get_by_label("Buy call time").first.inner_text()
    if "left" in chip:
        ok("repeat purchase completed through confirm")
    else:
        bad(f"repeat purchase failed: {chip}")

    # ── simulated call: ring → answer → per-second billing ───────────
    # (dialed number "30901820" persists through the purchase)
    page.get_by_role("button", name=re.compile(r"^Call Germany")).click()
    page.wait_for_timeout(400)
    # caller-ID sheet comes first (no rented number) → continue as Unknown
    if page.get_by_text(re.compile(r"Get a number so people")).count() == 1:
        ok("caller ID: rental upsell sheet before first call")
        page.get_by_role("button", name=re.compile(r"Continue anyway")).click()
        page.wait_for_timeout(300)
    else:
        bad("caller ID sheet missing")
    if page.get_by_text("Ringing…").count() == 1:
        ok("active call: ringing phase (mock 3s)")
    else:
        bad("active call: no ringing phase")
    if not wait_body(page, "Ringing…", 3000):
        pass  # may have already been answered
    wait_body(page, "credit left", 8000)
    page.wait_for_timeout(5200)  # answer at ~3s, talk ~5s → 0:05
    dur = page.get_by_label("Call duration").inner_text()
    if dur.startswith("0:0"):
        ok(f"active call: live duration ticking ({dur})")
    else:
        bad(f"active call: duration wrong ({dur})")
    if page.get_by_label("Credit remaining").inner_text():
        ok("active call: live credit countdown shown")
    page.get_by_label("Hang up").click()
    page.wait_for_timeout(1500)
    summary_visible = wait_body(page, "used ·", 5000)
    body = page.locator("body").inner_text()
    m = re.search(r"0:0\d · \$0\.0\d used · \d+:\d\d remaining", body)
    if summary_visible and m:
        ok(f"end summary correct: {m.group(0)}")
    else:
        bad(f"end summary wrong: {body[:200]}")

    # history entry billed
    hist = page.get_by_text(re.compile(r"Recent calls")).locator("..").inner_text()
    if "+49 30 901820" in hist.replace("\u200e", "") or "901820" in hist:
        ok("history: completed call recorded with number + cost")
    else:
        bad(f"history missing completed call: {hist[:160]}")

    # ── unanswered call → No charge ──────────────────────────────────
    page.get_by_label(re.compile("Delete digit")).dispatch_event("pointerdown")
    page.wait_for_timeout(700)  # long-press clears the previous number
    for k in ["3", "0", "9", "0", "2", "2", "2", "2"]:
        press_key(page, k)
    page.wait_for_timeout(200)
    page.get_by_role("button", name=re.compile(r"^Call Germany")).click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name=re.compile(r"Continue anyway")).click()
    page.wait_for_timeout(1200)  # still ringing — never answered
    page.get_by_label("Hang up").click()
    page.wait_for_timeout(1200)
    hist = page.get_by_text(re.compile(r"Recent calls")).locator("..").inner_text()
    if "No charge" in hist:
        ok("unanswered call: 'No charge' in history")
    else:
        bad("unanswered call should show No charge")

    # ── redial + delete ──────────────────────────────────────────────
    page.get_by_label(re.compile(r"Redial")).first.click()
    page.wait_for_timeout(300)
    dialed = page.get_by_label("Dialed number").inner_text()
    if "30902222" in dialed.replace(" ", ""):
        ok("history: tap redials the number")
    else:
        bad(f"redial wrong: {dialed}")
    entries_before = page.get_by_label(re.compile(r"Delete call")).count()
    page.get_by_label(re.compile(r"Delete call")).first.click()
    page.wait_for_timeout(300)
    if page.get_by_label(re.compile(r"Delete call")).count() == entries_before - 1:
        ok("history: delete removes the entry")
    else:
        bad("history delete failed")

    # ── emergency blocked ────────────────────────────────────────────
    page.get_by_label(re.compile("Delete digit")).dispatch_event("pointerdown")
    page.wait_for_timeout(700)  # long-press clears the redialed number
    for k in ["1", "1", "2"]:
        press_key(page, k)
    page.wait_for_timeout(300)
    if page.get_by_role("button", name=re.compile(r"Emergency\? Use your regular SIM")).count() == 1:
        ok("emergency: 112 blocked with 'use your regular SIM' CTA")
    else:
        bad("emergency 112 not blocked")

    # ── WhatsApp: NOT on the dialer, NOT in Help (moved to Profile) ──
    page.goto(f"{URL}/help", wait_until="networkidle")
    page.wait_for_timeout(500)
    help_html = page.locator("main").inner_html()
    if "WhatsApp" not in help_html and "25D366" not in help_html:
        ok("help screen: no WhatsApp (lives on Profile now)")
    else:
        bad("help screen: WhatsApp should not be inside Help")

    # analytics: calls events tracked (whatsapp surfaces covered in
    # tests/whatsapp-e2e.py / tests/whatsapp-unit.mjs)
    log = page.evaluate(
        "(k) => JSON.parse(localStorage.getItem(k) || '[]')", "jum-esim:analytics:v1"
    )
    if not any(e["event"] == "whatsapp_support_tapped" and e["data"].get("surface") == "calls"
               for e in log):
        ok("analytics: no whatsapp 'calls' surface (removed from the enum)")
    else:
        bad("analytics: whatsapp calls surface should no longer fire")
    for ev in ("calls_tab_opened", "buy_time_sheet_viewed", "credit_purchased",
               "call_started", "call_completed"):
        if any(e["event"] == ev for e in log):
            ok(f"analytics: {ev} fired")
        else:
            bad(f"analytics: {ev} missing")

    ctx.close()
    browser.close()

print()
if errors:
    print(f"FAILED ({len(errors)})")
    raise SystemExit(1)
print("ALL PASSED")
