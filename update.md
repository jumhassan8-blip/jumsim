# How to update jumesim.com

The live site is served straight from the GitHub repo's `dist/` folder.
After each change you make here, push a fresh build like this:

1. **Download the project** — All files → download the zip → unzip it
   on your computer.
2. **Build** — from the unzipped project folder run `npm install` (first
   time only) then `npm run build`. When it finishes, the `dist/` folder
   holds the complete, self-contained static site.
3. **Upload to GitHub** — open your GitHub repo → **Add file** →
   **Upload files** → drag the *contents* of the `dist/` folder into the
   upload area (so `index.html` lands at the repo root, with `assets/`,
   `checkout/`, `pricing.json`, `sw.js`, `privacy/`, `terms/`, `refund/`
   alongside it) → **Commit changes**.
4. **Go live** — wait about 1 minute for GitHub Pages to publish, then
   hard-refresh https://jumesim.com with **Cmd+Shift+R** (Ctrl+Shift+R
   on Windows) to bust your cache.

That's it — the new build is live. If something looks wrong, the repo's
commit history is your rollback: re-upload the previous `dist/` contents.

### After deploying — verify (2 minutes)

1. DevTools → **Network tab** → hard-refresh the homepage AND
   `/checkout/`: **every request must be 200 — zero 404s.** A white
   unstyled page means some files didn't upload; re-upload the missing
   ones.
2. Upload ONLY the `dist/` contents — no zips, no project source files,
   and **never any `.env*` file** (secrets). The web uploader also has a
   silent file cap: if the page renders broken, re-upload with
   **GitHub Desktop** (clone → replace with the full tree → commit →
   push) — that is the proven complete-push pipe.
3. Apple Pay: before enabling the button, replace
   `.well-known/apple-developer-merchantid-domain-association` with the
   real Stripe-generated file (README → "Apple Pay domain verification")
   for both `jumesim.com` and `www.jumesim.com`.
