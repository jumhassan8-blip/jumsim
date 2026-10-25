import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { initFx } from './lib/fx'

// Module 15 — localization: language (auto-detect + override, RTL) and
// local-currency display (server daily rates, client render-only).
initI18n()
void initFx()

// Module 6: register the offline service worker (cache-first shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support unavailable — app still works online */
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
