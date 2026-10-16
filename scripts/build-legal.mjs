#!/usr/bin/env node
/**
 * Static legal pages — renders src/legal/*.md (+ legal-values.json tokens)
 * to standalone dark-theme HTML in public/{privacy,terms,refund}/index.html,
 * so the SAME deployment serves jumesim.com/privacy, /terms and /refund
 * with zero server rewrites (static hosting friendly).
 *
 *   node scripts/build-legal.mjs
 *
 * The output is checked in — run this after editing any src/legal/*.md or
 * legal-values.json. The in-app pages read the same sources at bundle time,
 * so both surfaces can never drift apart.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(root + p, 'utf8')
const values = JSON.parse(read('src/legal/legal-values.json'))

const DOCS = [
  { doc: 'privacy', title: 'Privacy Policy', file: 'src/legal/privacy.md' },
  { doc: 'terms', title: 'Terms of Service', file: 'src/legal/terms.md' },
  { doc: 'refund', title: 'Refund Policy', file: 'src/legal/refund.md' },
]

function substitute(md) {
  return md
    .replaceAll('{{operator}}', values.operator)
    .replaceAll('{{email}}', values.supportEmail)
    .replaceAll('{{retentionYears}}', String(values.retentionYears))
    .replaceAll('{{chatRetentionMonths}}', String(values.chatRetentionMonths))
    .replaceAll('{{refundDays}}', String(values.refundWindowDays))
    .replaceAll('{{refundUrl}}', 'https://jumesim.com/refund')
    .replaceAll('{{country}}', values.governingCountry)
    .replaceAll('{{location}}', values.governingLocation)
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineHtml(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/** markdown subset identical to src/components/Markdown.tsx */
function renderMarkdown(md) {
  const lines = md.split('\n')
  const out = []
  let list = null
  let para = []
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineHtml(para.join(' '))}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${tag}>`)
      list = null
    }
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushPara()
      flushList()
      continue
    }
    if (line.startsWith('### ')) {
      flushPara()
      flushList()
      out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      flushPara()
      flushList()
      out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`)
      continue
    }
    const ordered = /^(\d+)\.\s+/.exec(line)
    if (ordered) {
      flushPara()
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(line.slice(ordered[0].length))
      continue
    }
    if (line.startsWith('- ')) {
      flushPara()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(line.slice(2))
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()
  return out.join('\n')
}

function formatUpdated(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

function page({ title, updated, body, doc }) {
  const others = DOCS.filter((d) => d.doc !== doc)
  const nav = others
    .map((d) => `<a href="https://jumesim.com/${d.doc}">${d.title}</a>`)
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Jum e-SIM</title>
<meta name="description" content="${title} for Jum e-SIM, the global eSIM store." />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23D7FF3F'/%3E%3Ctext x='50' y='68' font-size='58' text-anchor='middle' font-family='Arial' font-weight='bold' fill='%230A0A0A'%3EJ%3C/text%3E%3C/svg%3E" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0A0A0A;
    color: #C7C7CC;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 64px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .brand .logo {
    width: 30px; height: 30px; border-radius: 8px; background: #D7FF3F;
    display: flex; align-items: center; justify-content: center;
    color: #0A0A0A; font-weight: 800; font-size: 17px;
  }
  .brand .name { color: #fff; font-weight: 700; font-size: 15px; }
  .brand .name span { color: #9A9A9E; font-weight: 500; }
  h1 { color: #fff; font-size: 26px; margin: 0 0 6px; }
  .updated {
    color: #9A9A9E; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.06em; margin: 0 0 28px;
  }
  h2 { color: #fff; font-size: 16px; margin: 28px 0 0; }
  h3 { color: #fff; font-size: 14px; margin: 20px 0 0; }
  p { font-size: 14px; margin: 12px 0 0; }
  ul, ol { font-size: 14px; margin: 12px 0 0; padding-left: 22px; }
  li { margin-top: 6px; }
  ul li::marker { color: #D7FF3F; }
  strong { color: #fff; font-weight: 600; }
  a { color: #D7FF3F; }
  footer {
    margin-top: 48px; padding: 18px; background: #1C1C1E; border-radius: 14px;
    font-size: 13px;
  }
  footer nav { display: flex; gap: 18px; margin-top: 6px; }
  footer nav a { font-size: 12px; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <div class="logo">J</div>
    <div class="name">Jum e-SIM <span>· ${title}</span></div>
  </div>
  <h1>${title}</h1>
  <p class="updated">Last updated ${formatUpdated(updated)}</p>
  ${body}
  <footer>
    Questions about this policy? Email
    <a href="mailto:${values.supportEmail}">${values.supportEmail}</a>
    <nav>${nav}</nav>
  </footer>
</main>
</body>
</html>
`
}

for (const { doc, title, file } of DOCS) {
  const html = page({
    title,
    updated: values.updated,
    body: renderMarkdown(substitute(read(file))),
    doc,
  })
  const dir = `${root}public/${doc}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/index.html`, html)
  console.log(`built /${doc}/index.html`)
}
