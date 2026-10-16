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
