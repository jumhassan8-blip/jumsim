"""Module 7 follow-up: guarded settings deep links on the Get Connected checklist.

Covers the three acceptance environments:
  A. preview/browser tab     -> dev banner + written path, NO settings buttons
  B. iPhone (installed PWA)  -> "Open Settings" + caption; failed canOpenURL ->
                                inline fallback "Settings → Cellular"
  C. Android (installed PWA) -> "Open Network Settings"; failed launch ->
                                button hidden + fallback "Settings → Network & internet"
"""
import json
import re
import subprocess
import time

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4173"
ORDER_ID = "ORD-TEST-001"

NOW = int(time.time() * 1000)
SEED = [
    {
        "order": {
            "id": ORDER_ID,
            "iccid": "898821100000000001",
            "qrUrl": "https://api.jumesim.test/qr/898821100000000001",
            "lpaString": "LPA:1$test$998821100000000001",
            "planId": "japan-5gb-30d",
            "email": "traveller@example.com",
            "createdAt": NOW - 60_000,
        },
        "plan": {
            "id": "japan-5gb-30d",
            "countrySlug": "japan",
            "name": "5 GB · 30 days",
            "dataGB": 5,
            "days": 30,
            "priceUSD": 6.99,
            "wholesaleUSD": 4.0,
            "fiveG": True,
            "networks": ["NTT DoCoMo"],
            "hotspot": True,
            "group": "data",
            "label": "30 Days",
        },
        "country": {
            "slug": "japan",
            "name": "Japan",
            "iso2": "JP",
            "flag": "🇯🇵",
            "region": "asia-pacific",
            "fiveG": True,
            "networks": ["NTT DoCoMo"],
            "popular": True,
        },
        "status": "active",
        "installedAt": NOW - 30_000,
    }
]

INIT = f"""
localStorage.setItem('jum-esim:purchases:v1', {json.dumps(json.dumps(SEED))});
"""

STANDALONE_OVERRIDE = """
const __origMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
window.matchMedia = (q) => {
  if (String(q).includes('display-mode')) {
    return { matches: true, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false };
  }
  return __origMatchMedia ? __origMatchMedia(q) : { matches: false, media: q };
};
"""

OPEN_STUB = """
window.__stubOpenOk = true;
window.__lastOpenedUrl = null;
window.open = (url) => {
  window.__lastOpenedUrl = url;
  if (!window.__stubOpenOk) return null;
  return { location: { href: url }, close() {} };
};
"""

IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
ANDROID_UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")

errors = []
ok = lambda m: print(f"  OK {m}")
bad = lambda m: (print(f"  FAIL {m}"), errors.append(m))


def new_context(p, ua=None, standalone=False, seed=True):
    init = (INIT if seed else "") + STANDALONE_OVERRIDE if standalone else (INIT if seed else "")
    ctx = p.chromium.launch_persistent_context(
        "",
        executable_path="/usr/bin/chromium",
        args=["--no-sandbox"],
        user_agent=ua,
        viewport={"width": 390, "height": 844},
    ) if False else p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"]).new_context(
        user_agent=ua, viewport={"width": 390, "height": 844}
    )
    if seed:
        ctx.add_init_script(INIT)
    if standalone:
        ctx.add_init_script(STANDALONE_OVERRIDE)
    ctx.on("pageerror", lambda e: bad(f"JS error: {e}"))
    return ctx


def open_step2(page):
    # step 1 (install) auto-completes; expand step 2 (line_on) which has a settings link
    page.get_by_role("button", name=re.compile(r"2\. Turn on your Jum e-SIM line")).click()
    page.wait_for_timeout(200)


with sync_playwright() as p:
    # ── A. preview / browser tab ──────────────────────────────────────
    ctx = new_context(p)
    page = ctx.new_page()
    page.goto(f"{URL}/setup/{ORDER_ID}", wait_until="networkidle")
    page.wait_for_timeout(400)

    if page.get_by_text("Deep links to system settings only work on a real device").count():
        ok("preview: dev-mode banner shown")
    else:
        bad("preview: dev-mode banner missing")

    open_step2(page)
    if page.get_by_role("button", name="Open Settings").count() == 0 and \
       page.get_by_role("button", name="Open Network Settings").count() == 0:
        ok("preview: no settings buttons rendered")
    else:
        bad("preview: a settings button rendered")

    box = page.get_by_text("On your phone")
    if box.count() and page.get_by_text(re.compile(r"iPhone:.*Settings → Cellular")).count() and \
       page.get_by_text(re.compile(r"Android:.*Settings → Network")).count():
        ok("preview: written path instructions for both platforms")
    else:
        bad("preview: manual path text missing/incomplete")
    ctx.close()

    # ── B. iPhone installed PWA, open succeeds ────────────────────────
    ctx = new_context(p, ua=IOS_UA, standalone=True)
    page = ctx.new_page()
    page.add_init_script(OPEN_STUB)
    page.goto(f"{URL}/setup/{ORDER_ID}", wait_until="networkidle")
    page.wait_for_timeout(400)
    open_step2(page)

    if page.get_by_role("button", name="Open Settings").count():
        ok("ios: 'Open Settings' button shown")
    else:
        bad("ios: 'Open Settings' button missing")
    if page.get_by_text("You’ll see Jum e-SIM at the top.").count():
        ok("ios: caption 'You'll see Jum e-SIM at the top.' shown")
    else:
        bad("ios: caption missing")
    if page.get_by_text("Deep links to system settings only work on a real device").count() == 0:
        ok("ios: no dev banner on device")
    else:
        bad("ios: dev banner wrongly shown on device")

    page.evaluate("() => { window.__stubOpenOk = true; }")
    page.get_by_role("button", name="Open Settings").click()
    page.wait_for_timeout(300)
    opened = page.evaluate("() => window.__lastOpenedUrl")
    if opened == "app-settings:":
        ok(f"ios: handed off to app-settings: (got {opened!r})")
    else:
        bad(f"ios: wrong URL handed off: {opened!r}")
    if page.get_by_text("Couldn’t open Settings automatically").count() == 0:
        ok("ios: no fallback after successful open")
    else:
        bad("ios: fallback shown despite successful open")

    # ── C. iPhone installed PWA, canOpenURL fails ─────────────────────
    page.evaluate("() => { window.__stubOpenOk = false; }")
    page.get_by_role("button", name="Open Settings").click()
    page.wait_for_timeout(400)
    fb = page.get_by_text(re.compile(r"Couldn’t open Settings automatically — go to:.*Settings → Cellular"))
    if fb.count():
        ok("ios: inline fallback with exact path after failed open")
    else:
        bad("ios: inline fallback missing after failed open")
    # failure logged to the order so support sees it
    log = page.evaluate("() => JSON.parse(localStorage.getItem('jum-esim:purchases:v1') || '[]')[0].setupLog || []")
    if any(e.get("event") == "settings_open_failed" and e.get("url") == "app-settings:" for e in log):
        ok("ios: settings_open_failed written to order setup log")
    else:
        bad(f"ios: settings_open_failed not in setup log: {log}")
    ctx.close()

    # ── D. Android installed PWA, intent launcher unavailable ─────────
    ctx = new_context(p, ua=ANDROID_UA, standalone=True)
    page = ctx.new_page()
    page.add_init_script(OPEN_STUB)
    page.goto(f"{URL}/setup/{ORDER_ID}", wait_until="networkidle")
    page.wait_for_timeout(400)
    open_step2(page)

    if page.get_by_role("button", name="Open Network Settings").count():
        ok("android: 'Open Network Settings' button shown")
    else:
        bad("android: 'Open Network Settings' button missing")

    page.evaluate("() => { window.__stubOpenOk = false; }")
    page.get_by_role("button", name="Open Network Settings").click()
    page.wait_for_timeout(400)
    fb = page.get_by_text(re.compile(r"Couldn’t open Settings automatically — go to:.*Settings → Network & internet"))
    if fb.count():
        ok("android: inline fallback with exact path after failed launch")
    else:
        bad("android: inline fallback missing")
    if page.get_by_role("button", name="Open Network Settings").count() == 0:
        ok("android: broken button hidden after launcher unavailable")
    else:
        bad("android: broken button still visible")
    ctx.close()

print()
if errors:
    print(f"FAILED ({len(errors)})")
    raise SystemExit(1)
print("ALL PASSED")
