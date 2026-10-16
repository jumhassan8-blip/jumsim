from playwright.sync_api import sync_playwright

#!/usr/bin/env python3
"""Show/hide password toggles — acceptance (login, sign-up, confirm)."""

URL = "http://127.0.0.1:4173/auth"
errors = []

def ok(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        errors.append(label)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    page = browser.new_page()
    page.goto(URL)

    pw = page.locator("#auth-password")
    pw.fill("secret-login-pw")

    btn = page.get_by_role("button", name="Show password")
    ok(btn.get_attribute("type") == "button", "login toggle is type=button")
    ok(pw.get_attribute("type") == "password", "login field starts as password")

    pw.focus()
    btn.click()
    ok(pw.get_attribute("type") == "text", "tap eye → characters visible (type=text)")
    ok(page.get_by_role("button", name="Hide password").count() == 1, "aria-label flips to Hide password")
    ok(page.evaluate("document.activeElement && document.activeElement.id") == "auth-password",
       "toggle did not steal focus from the input")

    btn2 = page.get_by_role("button", name="Hide password")
    btn2.click()
    ok(pw.get_attribute("type") == "password", "tap again → re-hidden")
    ok(str(page.url).startswith(URL), "form not submitted by the toggle")

    # ── sign-up mode: independent toggles on password + confirm ───────
    page.get_by_role("button", name="Create an account").first.click()
    pw1 = page.locator("#auth-password")
    pw2 = page.locator("#auth-confirm")
    pw1.fill("first-field-pw")
    pw2.fill("second-field-pw")

    page.get_by_role("button", name="Show password").first.click()
    ok(pw1.get_attribute("type") == "text", "sign-up: password field visible")
    ok(pw2.get_attribute("type") == "password", "sign-up: confirm stays hidden (independent)")

    page.get_by_role("button", name="Show password").first.click()
    ok(pw2.get_attribute("type") == "text", "sign-up: confirm visible after its own toggle")
    ok(pw1.get_attribute("type") == "text", "sign-up: password unaffected by confirm toggle")

    page.get_by_role("button", name="Hide password").nth(0).click()
    ok(pw1.get_attribute("type") == "password", "sign-up: password re-hides")
    ok(pw2.get_attribute("type") == "text", "sign-up: confirm still visible")

    browser.close()

print()
if errors:
    print(f"{len(errors)} FAILURES")
    raise SystemExit(1)
print("ALL PASS")
