#!/usr/bin/env python3
"""Checkout (card-only) verification.

Requires: API server (:8789) + preview (:4173, prod build) + dev server (:3000).

Covers the current spec:
  1. exactly ONE payment path — inline credit/debit card fields, no wallet
     rows/strings anywhere
  2. validation before Pay: Luhn + brand, future expiry, 3–4 digit CVC, email
     format — inline field errors, Pay disabled until all valid
  3. demo-mode test-card hint; dev-only config banner
  4. failure taxonomy: declined → 'Card declined' + not-charged + Try again;
     network → 'Couldn’t reach payment server'
  5. banner in-flow above terms (no overlap)
  6. retry after Try again succeeds → /install/ (demo test card end-to-end)
  7. 'Secured by Stripe' badge under Pay
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


def goto_japan_checkout(page):
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_placeholder(re.compile("Search|Where")).first.fill("Japan")
    page.wait_for_timeout(300)
    page.get_by_text("Japan", exact=True).first.click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name=re.compile(r"^5 GB")).first.click()
    page.get_by_role("button", name=re.compile(r"Continue · 5GB \$8\.99")).click()
    page.wait_for_timeout(600)


def pay_button(page):
    return page.get_by_role("button", name=re.compile(r"^Pay \$"))


def fill_valid_form(page):
    page.locator("#email").fill("traveller@example.com")
    page.locator("#card-number").fill("4242424242424242")
    page.locator("#card-expiry").fill("1228")
    page.locator("#card-cvc").fill("123")
    page.locator('input[type="checkbox"]').first.check()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])

    # ══ PREVIEW CONTEXT ══════════════════════════════════════════════
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.on("pageerror", lambda e: bad(f"JS error: {e}"))
    console_errors = []
    ctx.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page = ctx.new_page()

    goto_japan_checkout(page)

    # (1) preview/web: ONLY Card — wallet rows auto-hidden, card fields inline
    body = page.locator("body").inner_text()
    if "Apple Pay" not in body and "Google Pay" not in body:
        ok("preview: wallet rows hidden (card only)")
    else:
        bad("wallet rows visible in preview")
    if "with Card" in pay_button(page).inner_text():
        ok("preview: Pay CTA defaults to 'with Card'")
    else:
        bad(f"unexpected Pay CTA: {pay_button(page).inner_text()}")
    for field in ("#card-number", "#card-expiry", "#card-cvc"):
        if page.locator(field).count() == 1:
            ok(f"preview: {field} visible without a method step")
        else:
            bad(f"{field} missing")
    if page.get_by_role("button", name=re.compile(r"^(Apple Pay|Google Pay)$")).count() == 0:
        ok("preview: no wallet selector buttons")
    else:
        bad("wallet selector buttons present in preview")

    # brand badge appears once a Visa number is typed
    page.locator("#card-number").fill("4242")
    if page.get_by_text("VISA").count():
        ok("brand detect: VISA badge on 4-prefix")
    else:
        bad("VISA badge missing")
    page.locator("#card-number").fill("")

    # (4) demo-mode test-card hint (prod build has no key → hint shows)
    if page.get_by_text("Test card: 4242 4242 4242 4242").count():
        ok("demo: 4242 test-card hint shown")
    else:
        bad("test-card hint missing")

    # (7) Secured by Stripe badge under Pay
    if page.get_by_text("Secured by Stripe").count():
        ok("'Secured by Stripe' badge under Pay")
    else:
        bad("Stripe badge missing")

    # (2) dev config banner is DEV-ONLY — not in the production preview build
    if page.get_by_text("Demo mode: add Stripe test key in config").count() == 0:
        ok("preview (prod build): no dev config banner")
    else:
        bad("preview (prod build): dev banner wrongly shown")

    # (6) validation: Pay disabled until everything is valid + inline errors
    if pay_button(page).is_disabled():
        ok("Pay disabled with empty form")
    else:
        bad("Pay enabled with empty form")

    page.locator("#email").fill("not-an-email")
    page.locator("#email").press("Tab")
    if page.get_by_text(re.compile("valid email")).count():
        ok("email: inline error for bad format")
    else:
        bad("email inline error missing")

    page.locator("#card-number").fill("4242424242424241")  # Visa, bad Luhn
    page.locator("#card-number").press("Tab")
    if page.get_by_text("doesn’t look right").count():
        ok("card number: Luhn failure inline error")
    else:
        bad("Luhn inline error missing")
    if pay_button(page).is_disabled():
        ok("Pay stays disabled on Luhn failure")
    else:
        bad("Pay enabled despite Luhn failure")

    page.locator("#card-expiry").fill("1220")  # past
    page.locator("#card-expiry").press("Tab")
    if page.get_by_text("expired").count():
        ok("expiry: past date inline error")
    else:
        bad("expiry inline error missing")

    page.locator("#card-cvc").fill("12")
    page.locator("#card-cvc").press("Tab")
    if page.get_by_text(re.compile("CVC is 3 digits")).count():
        ok("CVC: short code inline error")
    else:
        bad("CVC inline error missing")

    # fix everything → errors clear, Pay enables
    page.locator("#email").fill("traveller@example.com")
    page.locator("#card-number").fill("4242424242424242")
    page.locator("#card-number").press("Tab")
    page.locator("#card-expiry").fill("1230")
    page.locator("#card-expiry").press("Tab")
    page.locator("#card-cvc").fill("123")
    page.locator("#card-cvc").press("Tab")
    page.wait_for_timeout(300)
    if page.get_by_text("doesn’t look right").count() == 0 and page.get_by_text("expired").count() == 0:
        ok("inline errors clear once fields are valid")
    else:
        bad("inline errors stuck after fixing fields")
    if pay_button(page).is_disabled():
        ok("Pay stays disabled until terms accepted")
    else:
        bad("Pay enabled before terms accepted")
    page.locator('input[type="checkbox"]').first.check()
    if not pay_button(page).is_disabled():
        ok("Pay enabled after terms accepted")
    else:
        bad("Pay still disabled with fully valid form")

    # (1)+(5) declined card → reasoned banner + Try again + console log
    page.route(re.compile(r".*/api/confirm-order$"), lambda r: r.fulfill(
        status=402, content_type="application/json",
        body=json.dumps({"error": "payment_failed_no_charge"})))
    pay_button(page).click()
    page.wait_for_timeout(2500)
    if page.get_by_text("Card declined").count():
        ok("failure banner title: 'Card declined'")
    else:
        bad("'Card declined' title missing")
    if page.get_by_text(re.compile("you were not charged", re.I)).count():
        ok("banner reassures: not charged")
    else:
        bad("banner missing 'not charged' reassurance")
    if any("[checkout] payment failed" in c for c in console_errors):
        ok("full error logged to console")
    else:
        bad(f"console error missing; console errors: {console_errors[:3]}")
    try_again = page.get_by_role("button", name="Try again")
    if try_again.count():
        ok("'Try again' lime button under banner")
    else:
        bad("'Try again' button missing")
    if "/install/" not in page.url:
        ok("user stays on checkout (not dead-ended)")
    else:
        bad("unexpectedly navigated away on failure")

    # banner in flow: it sits between sections → terms pushed below it
    banner = page.get_by_text("Card declined").locator("..")
    terms = page.get_by_text("I agree to the")
    if banner.bounding_box()["y"] < terms.bounding_box()["y"]:
        ok("banner is in-flow above terms (pushes content down)")
    else:
        bad("banner does not push terms down")
    bb, tb = banner.bounding_box(), terms.bounding_box()
    overlap = not (bb["y"] + bb["height"] <= tb["y"] or tb["y"] + tb["height"] <= bb["y"])
    if not overlap:
        ok("banner does not overlap terms text")
    else:
        bad("banner overlaps terms text")

    # Try again dismisses and the demo test card completes end-to-end
    try_again.click()
    page.wait_for_timeout(300)
    if page.get_by_text("Card declined").count() == 0:
        ok("Try again dismisses the banner")
    else:
        bad("banner did not dismiss")
    page.unroute_all()  # let the real mock backend answer the retry
    pay_button(page).click()
    page.wait_for_timeout(2500)
    if "/install/" in page.url:
        ok("retry succeeds → installation screen (test card end-to-end)")
    else:
        bad(f"retry failed: {page.url}")
    ctx.close()

    # ══ NETWORK FAILURE → 'Couldn’t reach payment server' ═══════════
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page.route(re.compile(r".*/api/.*"), lambda r: r.abort())
    goto_japan_checkout(page)
    fill_valid_form(page)
    if not pay_button(page).is_disabled():
        ok("network-fail form: Pay enabled (validation is client-side)")
    else:
        bad("Pay disabled on valid form")
    pay_button(page).click()
    page.wait_for_timeout(2500)
    if page.get_by_text("Couldn’t reach payment server").count():
        ok("network failure → 'Couldn’t reach payment server'")
    else:
        bad("network failure reason missing")
    if page.get_by_role("button", name="Try again").count():
        ok("network failure also offers Try again")
    else:
        bad("Try again missing on network failure")
    ctx.close()

    # ══ iOS STANDALONE (installed PWA) + Apple Pay SDK available ═════
    IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
              "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")
    STANDALONE = ("window.matchMedia = (q) => q.includes('display-mode: standalone')"
                  " ? { matches: true, addEventListener() {}, removeEventListener() {} }"
                  " : window.matchMedia(q)")
    # full ApplePaySession mock: reports supported, auto-authorizes the sheet
    APPLE_PAY_SDK = """
      window.ApplePaySession = class {
        static canMakePayments() { return true }
        static get STATUS_SUCCESS() { return 1 }
        constructor(version, request) { this.request = request }
        begin() {
          setTimeout(() => {
            this.onvalidatemerchant && this.onvalidatemerchant({ validationURL: 'https://example.test' })
            setTimeout(() => {
              this.onpaymentauthorized && this.onpaymentauthorized({ payment: { token: { paymentData: {} } } })
            }, 10)
          }, 10)
        }
        completeMerchantValidation() {}
        completePayment(result) { this.completed = result }
      }
    """
    ctx = browser.new_context(user_agent=IOS_UA, viewport={"width": 390, "height": 844})
    ctx.add_init_script(STANDALONE)
    ctx.add_init_script(APPLE_PAY_SDK)
    page = ctx.new_page()
    goto_japan_checkout(page)
    page.wait_for_timeout(400)

    if page.get_by_role("button", name="Apple Pay", exact=True).count() == 1:
        ok("iOS PWA: Apple Pay row visible")
    else:
        bad("iOS PWA: Apple Pay row missing")
    if page.get_by_role("button", name="Google Pay").count() == 0:
        ok("iOS PWA: Google Pay row hidden")
    else:
        bad("iOS PWA: Google Pay row should be hidden on iOS")
    if page.get_by_text("Demo mode: add Stripe test key in config").count() == 0:
        ok("iOS PWA: no dev banner in production build")
    else:
        bad("dev banner shown in production build")

    # default selection = the available wallet; CTA reflects it
    if "with Apple Pay" in pay_button(page).inner_text():
        ok("iOS PWA: default wallet selected, CTA 'with Apple Pay'")
    else:
        bad(f"iOS PWA CTA wrong: {pay_button(page).inner_text()}")
    # selecting Card collapses wallet and expands fields
    page.get_by_role("button", name="Credit or debit card").click()
    if "with Card" in pay_button(page).inner_text():
        ok("iOS PWA: CTA updates to 'with Card'")
    else:
        bad("iOS PWA: CTA did not update to Card")
    # wallet pay completes end-to-end through the mocked sheet
    page.locator("#email").fill("traveller@example.com")
    page.get_by_role("button", name="Apple Pay", exact=True).click()
    if "with Apple Pay" in pay_button(page).inner_text():
        ok("iOS PWA: re-selecting wallet updates CTA")
    else:
        bad("iOS PWA: wallet re-select did not update CTA")
    if pay_button(page).is_disabled():
        ok("iOS PWA: wallet Pay disabled until email+terms (card fields not required)")
    else:
        bad("iOS PWA: wallet Pay enabled before email/terms")
    page.locator('input[type="checkbox"]').first.check()
    pay_button(page).click()
    page.wait_for_timeout(2500)
    if "/install/" in page.url:
        ok("iOS PWA: Apple Pay sheet → confirm-order → installation screen")
    else:
        bad(f"iOS PWA: wallet pay did not complete: {page.url}")

    # wallet failure → unavailable banner, method selection preserved
    page.go_back()
    page.wait_for_timeout(600)
    ctx2 = browser.new_context(user_agent=IOS_UA, viewport={"width": 390, "height": 844})
    ctx2.add_init_script(STANDALONE)
    ctx2.add_init_script("""
      window.ApplePaySession = class {
        static canMakePayments() { return true }
        constructor() {}
        begin() { setTimeout(() => this.oncancel && this.oncancel(), 10) }
        completeMerchantValidation() {}
        completePayment() {}
      }
    """)
    page2 = ctx2.new_page()
    goto_japan_checkout(page2)
    page2.wait_for_timeout(400)
    page2.locator("#email").fill("traveller@example.com")
    page2.locator('input[type="checkbox"]').first.check()
    pay_button(page2).click()
    page2.wait_for_timeout(2000)
    if page2.get_by_text("Apple Pay unavailable on this device").count():
        ok("iOS PWA: sheet failure → 'Apple Pay unavailable' banner")
    else:
        bad("iOS PWA: sheet failure reason missing")
    if "with Apple Pay" in pay_button(page2).inner_text():
        ok("iOS PWA: method selection preserved after failure")
    else:
        bad("iOS PWA: method selection lost after failure")
    ctx2.close()
    ctx.close()

    # ══ ANDROID STANDALONE + Google Pay SDK available ══════════════════
    ANDROID_UA = ("Mozilla/5.0 (Linux; Android 13; Pixel 7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36")
    GOOGLE_PAY_SDK = """
      window.PaymentRequest = class {
        constructor(methods, details) { this.methods = methods; this.details = details }
        canMakePayment() { return Promise.resolve(true) }
        show() { return Promise.resolve({ complete: async () => {} }) }
      }
    """
    ctx = browser.new_context(user_agent=ANDROID_UA, viewport={"width": 390, "height": 844})
    ctx.add_init_script(STANDALONE)
    ctx.add_init_script(GOOGLE_PAY_SDK)
    page = ctx.new_page()
    goto_japan_checkout(page)
    page.wait_for_timeout(400)
    if page.get_by_role("button", name="Google Pay", exact=True).count() == 1:
        ok("Android PWA: Google Pay row visible")
    else:
        bad("Android PWA: Google Pay row missing")
    if page.get_by_role("button", name="Apple Pay").count() == 0:
        ok("Android PWA: Apple Pay row hidden")
    else:
        bad("Android PWA: Apple Pay row should be hidden on Android")
    if "with Google Pay" in pay_button(page).inner_text():
        ok("Android PWA: default wallet selected, CTA 'with Google Pay'")
    else:
        bad(f"Android PWA CTA wrong: {pay_button(page).inner_text()}")
    page.locator("#email").fill("traveller@example.com")
    page.locator('input[type="checkbox"]').first.check()
    pay_button(page).click()
    page.wait_for_timeout(2500)
    if "/install/" in page.url:
        ok("Android PWA: Google Pay sheet → confirm-order → installation screen")
    else:
        bad(f"Android PWA: wallet pay did not complete: {page.url}")
    ctx.close()

    # ══ iOS STANDALONE with NO Apple Pay on device → row hidden, Card default ═
    ctx = browser.new_context(user_agent=IOS_UA, viewport={"width": 390, "height": 844})
    ctx.add_init_script(STANDALONE)
    ctx.add_init_script("window.ApplePaySession = { canMakePayments: () => false }")
    page = ctx.new_page()
    goto_japan_checkout(page)
    page.wait_for_timeout(400)
    if page.get_by_role("button", name="Apple Pay").count() == 0:
        ok("iOS no-Apple-Pay-device: row hidden (never show a wallet that will fail)")
    else:
        bad("iOS no-Apple-Pay-device: row should be hidden")
    if "with Card" in pay_button(page).inner_text():
        ok("iOS no-Apple-Pay-device: defaults to Card")
    else:
        bad("iOS no-Apple-Pay-device: did not default to Card")
    ctx.close()

    # ══ DEV SERVER (:3000): config banner appears when key missing ═══
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page.route(re.compile(r".*/api/confirm-order$"), lambda r: r.fulfill(
        status=402, content_type="application/json",
        body=json.dumps({"error": "payment_failed_no_charge"})))
    page.goto("http://127.0.0.1:3000/", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_placeholder(re.compile("Search|Where")).first.fill("Japan")
    page.wait_for_timeout(300)
    page.get_by_text("Japan", exact=True).first.click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name=re.compile(r"^5 GB")).first.click()
    page.get_by_role("button", name=re.compile(r"Continue · 5GB \$8\.99")).click()
    page.wait_for_timeout(600)
    if page.get_by_text("Demo mode: add Stripe test key in config").count():
        ok("dev server: 'Demo mode: add Stripe test key in config' banner shown")
    else:
        bad("dev server: config banner missing")
    fill_valid_form(page)
    pay_button(page).click()
    page.wait_for_timeout(2500)
    if page.get_by_text("Card declined").count():
        ok("dev server: declined → 'Card declined' reason shown")
    else:
        bad("dev server: declined reason missing")
    ctx.close()

    browser.close()

print()
if errors:
    print(f"FAILED ({len(errors)})")
    raise SystemExit(1)
print("ALL PASSED")
