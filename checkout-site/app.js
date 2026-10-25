/* jumesim.com/checkout — e-sim.io style guest checkout.
 *
 * Single page: summary → email (guest-first) → Stripe Payment Element
 * (Apple Pay / Google Pay / Link / Card) → terms → Pay. Payment →
 * verified idempotent webhook → eSIM Go order → Firestore → success page
 * shows QR + LPA instantly. No account required; guests can convert
 * after the money with a password nudge.
 *
 * Prices are NEVER read from the URL — the server validates planId
 * against pricing.json (single source of truth).
 */
'use strict'

/* ── configuration (public values only) ─────────────────────────────── */

var FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBF7UTmg59xaW5zCFSyd6vTZ1uVvCRR8jc',
  authDomain: 'jum-esim.firebaseapp.com',
  projectId: 'jum-esim',
  storageBucket: 'jum-esim.appspot.com',
  messagingSenderId: '517505138153',
  appId: '1:517505138153:web:249fd8b8151bc0a699db7a',
}
var API_BASE = '' // same-origin /api/checkout/* on jumesim.com
var STRIPE_PUBLISHABLE_KEY =
  'pk_live_51QExampleReplaceWithRealKey' // publishable — safe to ship; overridden by the server session below

/* ── analytics (fire-and-forget; server may 404 — never blocks) ─────── */

function track(event, data) {
  try {
    fetch(API_BASE + '/api/checkout/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: event, data: data || {}, at: Date.now() }),
    }).catch(function () {})
  } catch (e) { /* noop */ }
  console.log('[analytics]', event, data || {})
}

/* ── tiny DOM helpers ───────────────────────────────────────────────── */

function $(id) { return document.getElementById(id) }
function show(id) { $(id).hidden = false }
function hide(id) { $(id).hidden = true }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}
function money(usd) { return '$' + Number(usd).toFixed(2) }

function showError(title, body) {
  hide('step-form'); hide('step-processing'); hide('step-success'); hide('step-refunded')
  $('error-title').textContent = title
  $('error-body').textContent = body || ''
  show('step-error')
}

/* ── query params ───────────────────────────────────────────────────── */

var params = new URLSearchParams(location.search)
var planId = params.get('planId')
var topUpFor = params.get('topup')
var emailPrefill = params.get('email') || ''
var uidParam = params.get('uid') || '' // app link-out carries the Firebase uid

/* ── FX display (converted per locale; Stripe always charges USD) ───── */

function detectCurrency() {
  try {
    var cur = new Intl.NumberFormat().resolvedOptions().locale
    var region = cur.split('-')[1]
    var map = { DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', IE: 'EUR',
      AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR', TR: 'TRY', JP: 'JPY', KR: 'KRW',
      GB: 'GBP', TH: 'THB', ID: 'IDR', VN: 'VND', IN: 'INR', BR: 'BRL', MX: 'MXN' }
    if (map[region]) return map[region]
    var locale = navigator.language || 'en-US'
    var parts = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' })
      .formatToParts(1)
    var sym = parts.filter(function (p) { return p.type === 'currency' })[0]
    return sym && sym.value !== '$' ? null : 'USD'
  } catch (e) { return 'USD' }
}

function renderFx(usd) {
  var cur = detectCurrency()
  if (!cur || cur === 'USD') { $('plan-fx').textContent = ''; return }
  fetch(API_BASE + '/api/fx?to=' + cur)
    .then(function (r) { return r.json() })
    .then(function (fx) {
      if (!fx.rate) return
      var local = usd * fx.rate
      var formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(local)
      $('plan-fx').textContent = '≈ ' + formatted + ' · charged in USD'
    })
    .catch(function () { /* display stays USD — honest */ })
}

/* ── plan resolution (server is the price authority) ────────────────── */

var FLAG_BY_ISO = { DE: '🇩🇪', GB: '🇬🇧', US: '🇺🇸', JP: '🇯🇵', TH: '🇹🇭', ID: '🇮🇩', FR: '🇫🇷',
  ES: '🇪🇸', IT: '🇮🇹', NL: '🇳🇱', PT: '🇵🇹', TR: '🇹🇷', KR: '🇰🇷', IN: '🇮🇳', BR: '🇧🇷',
  MX: '🇲🇽', VN: '🇻🇳', AT: '🇦🇹', BE: '🇧🇪', CH: '🇨🇭', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰',
  FI: '🇫🇮', PL: '🇵🇱', IE: '🇮🇪', GR: '🇬🇷', CZ: '🇨🇿', HU: '🇭🇺', RO: '🇷🇴',
  EU: '🇪🇺', APAC: '🌏', GLOBAL: '🌐' }

function flagFor(plan) {
  var id = (plan.id || '').toUpperCase()
  for (var iso in FLAG_BY_ISO) { if (id.indexOf(iso + '-') === 0 || id.indexOf('-' + iso) !== -1) return FLAG_BY_ISO[iso] }
  if (id.indexOf('EUROPE') !== -1 || id.indexOf('EU-') !== -1) return '🇪🇺'
  if (id.indexOf('ASIA') !== -1) return '🌏'
  if (id.indexOf('GLOBAL') !== -1) return '🌐'
  return '🌐'
}

function resolvePlan(id) {
  return fetch(API_BASE + '/api/checkout/plan?planId=' + encodeURIComponent(id))
    .then(function (r) {
      if (!r.ok) throw new Error('plan_http_' + r.status)
      return r.json()
    })
}

function renderPlan(plan) {
  $('plan-flag').textContent = flagFor(plan)
  $('plan-name').textContent = plan.name
  $('plan-sub').textContent = plan.subtitle + (topUpFor ? ' · top-up' : '')
  $('plan-price').textContent = money(plan.priceUSD)
  renderFx(plan.priceUSD)
}

/** coverage gate — the active provider can't fulfil this plan (yet).
 *  Show "Coming soon", NEVER a price, never a payment form. */
function renderComingSoon(plan) {
  $('plan-flag').textContent = flagFor(plan)
  $('plan-name').textContent = plan.name
  $('plan-sub').textContent = plan.subtitle
  $('plan-price').textContent = ''
  $('plan-fx').textContent = ''
  $('coming-soon-sub').textContent =
    plan.name + ' is on the way. No charge until it launches — pick an available plan below.'
  // hide every money/buy section; keep the summary + trust row only
  var form = $('step-form')
  Array.prototype.forEach.call(form.querySelectorAll('.card, .trust'), function (el) {
    if (el.id !== 'coming-soon' && !el.contains($('coming-soon')) && el.querySelector('#coming-soon') === null) {
      if (el.id !== 'plan-box' && !el.classList.contains('summary')) el.style.display = 'none'
    }
  })
  // picker of available plans
  fetch(API_BASE + '/api/checkout/plan')
    .then(function (r) { return r.json() })
    .then(function (body) {
      var wrap = $('coming-soon-picker')
      wrap.innerHTML = ''
      ;(body.plans || []).slice(0, 6).forEach(function (p) {
        var b = document.createElement('button')
        b.className = 'plan-opt'
        b.innerHTML = '<span>' + esc(p.name) + '<br><small style="color:#9A9A9E">' +
          esc(p.subtitle) + '</small></span><span class="p">' + (p.priceUSD === null ? '—' : money(p.priceUSD)) + '</span>'
        b.onclick = function () {
          var u = new URL(location.href)
          u.searchParams.set('planId', p.id)
          location.href = u.toString()
        }
        wrap.appendChild(b)
      })
    })
    .catch(function () { /* leave the notice */ })
  show('coming-soon')
}

function showPicker(candidates) {
  var wrap = $('plan-picker')
  wrap.innerHTML = ''
  candidates.slice(0, 12).forEach(function (p) {
    var b = document.createElement('button')
    b.className = 'plan-opt'
    b.innerHTML = '<span>' + esc(p.name) + '<br><small style="color:#9A9A9E">' +
      esc(p.subtitle) + '</small></span><span class="p">' + money(p.priceUSD) + '</span>'
    b.onclick = function () { choosePlan(p.id) }
    wrap.appendChild(b)
  })
  show('plan-picker')
  show('step-form')
}

function choosePlan(id) {
  planId = id
  var u = new URL(location.href)
  u.searchParams.set('planId', id)
  history.replaceState(null, '', u.toString())
  hide('plan-picker')
  bootPlan()
}

/* ── Firebase (compat CDN, loaded in <head>) ────────────────────────── */

var auth = null
var db = null
var uid = uidParam || null
var sessionEmail = ''

function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG)
    auth = firebase.auth()
    db = firebase.firestore()
    auth.onAuthStateChanged(function (user) {
      if (user) {
        uid = uid || user.uid
        sessionEmail = user.email || ''
        if (user.email) {
          $('email').value = user.email
          $('auth-hint').textContent = 'Signed in as ' + user.email + ' — this eSIM will also appear in your app.'
          show('auth-hint')
          $('make-account').checked = true
          $('make-account').disabled = true
        }
      }
    })
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {})
  } catch (e) {
    console.warn('[checkout] firebase init failed (pure guest mode):', e)
  }
}

function ensureUid() {
  if (uid) return Promise.resolve(uid)
  if (!auth) return Promise.resolve(null)
  if (!$('make-account').checked) return Promise.resolve(null) // guest: no account created
  return Promise.race([
    auth.signInAnonymously().then(function (cred) { uid = cred.user.uid; return uid }).catch(function () { return null }),
    new Promise(function (resolve) { setTimeout(function () { resolve(null) }, 5000) }),
  ])
}

/* ── Stripe Payment Element (Apple Pay / Google Pay / Link / Card) ──── */

var stripe = null
var elements = null
var paymentComplete = false

function updateCtaState() {
  $('pay-btn').disabled = !(paymentComplete && $('terms').checked)
}

function initStripe(clientSecret, plan) {
  stripe = Stripe(STRIPE_PUBLISHABLE_KEY)
  elements = stripe.elements({
    clientSecret: clientSecret,
    appearance: {
      theme: 'night',
      variables: { colorPrimary: '#D7FF3F', colorBackground: '#1C1C1E', borderRadius: '12px' },
    },
  })
  // The Payment Element renders Apple Pay / Google Pay / Link / Card tiles
  // automatically — wallets appear only where the device supports them.
  var el = elements.create('payment', {
    layout: 'tabs',
    defaultValues: { billingDetails: { email: $('email').value.trim() || emailPrefill || undefined } },
    wallets: { applePay: 'auto', googlePay: 'auto' },
  })
  el.mount('#payment-element')
  el.on('change', function (e) {
    if (e.value && e.value.type) track('method_selected', { method: e.value.type })
    paymentComplete = !!e.complete
    updateCtaState()
  })
  $('pay-label').textContent = 'Pay ' + money(plan.priceUSD)
  updateCtaState()
  track('web_checkout_started', { planId: plan.id })
}

$('terms').addEventListener('change', function () { updateCtaState() })

$('pay-btn').addEventListener('click', function () {
  var email = $('email').value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $('form-error').textContent = 'Enter a valid email — your eSIM install QR is delivered there.'
    show('form-error')
    $('email').focus()
    return
  }
  if (!$('terms').checked) {
    $('form-error').textContent = 'Please accept the Terms to continue.'
    show('form-error')
    return
  }
  hide('form-error')
  $('pay-btn').disabled = true
  $('pay-label').textContent = 'Processing…'
  track('guest_vs_account', { guest: !$('make-account').checked, planId: planId })

  ensureUid().then(function (resolvedUid) {
    return stripe.confirmPayment({
      elements: elements,
      confirmParams: {
        receipt_email: email,
        return_url: location.href,
        payment_method_data: { billing_details: { email: email } },
      },
      redirect: 'if_required',
    }).then(function (result) {
      if (result.error) {
        $('pay-btn').disabled = false
        $('pay-label').textContent = 'Try again'
        $('form-error').textContent = result.error.message || 'Payment failed — you were not charged.'
        show('form-error')
        track('web_payment_failed', { planId: planId })
        return
      }
      var method = result.paymentIntent && result.paymentIntent.payment_method_types
        ? result.paymentIntent.payment_method_types.join(',') : 'unknown'
      track('web_payment_success', { planId: planId, method: method })
      waitForOrder()
    })
  })
})

/* ── post-payment: webhook fulfils → we listen on Firestore ─────────── */

var pollTimer = null

function waitForOrder() {
  show('step-processing')
  hide('step-form')
  var deadline = Date.now() + 60000
  var settled = false

  function settleWith(doc) {
    if (settled) return
    settled = true
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    renderSuccess(doc)
  }

  function fetchLatest() {
    if (settled) return
    if (Date.now() > deadline) {
      settled = true
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      showError('Payment confirmed',
        'Your payment succeeded. Your eSIM install QR is on its way to your email — it usually lands within a minute. Order ref: ' + (planId || ''))
      return
    }
    var base = uid
      ? 'users/' + encodeURIComponent(uid) + '/orders'
      : 'guestOrders/' + encodeURIComponent(($('email').value.trim() || emailPrefill).toLowerCase().replace(/[^a-z0-9]/g, '_')) + '/orders'
    db.collection(base)
      .where('planId', '==', planId)
      .orderBy('createdAt', 'desc').limit(1)
      .get()
      .then(function (snap) {
        if (settled || snap.empty) return
        var doc = snap.docs[0].data()
        if (doc.status === 'failed_refunded') { settled = true; showRefunded(); return }
        if (doc.status === 'active' || doc.qrUrl || doc.lpaString) settleWith(doc)
      })
      .catch(function () { /* transient — next poll retries */ })
  }

  if (!db) {
    setTimeout(function () {
      if (!settled) showError('Payment confirmed',
        'Your payment succeeded. Your eSIM install QR is on its way to your email.')
    }, 2000)
    return
  }
  fetchLatest()
  pollTimer = setInterval(fetchLatest, 2000)
}

function showRefunded() {
  hide('step-processing'); hide('step-form')
  show('step-refunded')
}

/* ── success page (instant delivery) ────────────────────────────────── */

var lastOrder = null

function renderSuccess(order) {
  lastOrder = order
  hide('step-processing')
  show('step-success')
  track('web_order_created', { planId: order.planId || planId, orderId: order.orderId || '' })
  track('delivery_viewed', { planId: order.planId || planId })
  $('success-email').textContent = order.email || $('email').value.trim()
  if (order.qrUrl && window.QRCode) {
    new QRCode($('qr'), { text: order.lpaString || order.qrUrl, width: 220, height: 220 })
  }
  $('lpa').textContent = order.lpaString || ''
  if (order.orderId) {
    var a = $('open-app')
    a.href = 'jumesim://order/' + encodeURIComponent(order.orderId)
    show('open-app')
    $('order-ref').textContent = 'Order ' + order.orderId
  }
  // account nudge: only for guests (checked the box = already have an account path)
  if (!$('make-account').checked && !sessionEmail) show('account-nudge')
}

$('copy-lpa').addEventListener('click', function () {
  var text = $('lpa').textContent
  if (!text) return
  var done = function () { $('copy-lpa').textContent = 'Copied ✓'; setTimeout(function () { $('copy-lpa').textContent = 'Copy code' }, 2000) }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done) })
  else legacyCopy(text, done)
})

function legacyCopy(text, done) {
  try {
    var ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); ta.remove(); done()
  } catch (e) { /* leave the code visible for manual copy */ }
}

$('email-instructions').addEventListener('click', function () {
  if (!lastOrder) return
  track('install_instructions_emailed', { orderId: lastOrder.orderId || '' })
  fetch(API_BASE + '/api/checkout/email-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: lastOrder.email || $('email').value.trim(), order: lastOrder }),
  }).then(function () {
    $('email-instructions').textContent = '✓ Sent — check your inbox'
  }).catch(function () {
    $('email-instructions').textContent = 'Could not send — email us at support@jumesim.com'
  })
})

/* show/hide password toggle on the nudge field: type="password" ↔ "text",
   aria-pressed flips, icon stays gray → lime while visible. type="button"
   keeps it out of form submission; preventDefault keeps input focus. */
$('nudge-toggle').addEventListener('pointerdown', function (e) { e.preventDefault() })
$('nudge-toggle').addEventListener('click', function () {
  var input = $('nudge-password')
  var btn = $('nudge-toggle')
  var show = input.type === 'password'
  input.type = show ? 'text' : 'password'
  btn.setAttribute('aria-pressed', show ? 'true' : 'false')
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
  btn.title = show ? 'Hide password' : 'Show password'
})

/* post-purchase account nudge: guest → account AFTER the money */
$('nudge-create').addEventListener('click', function () {
  var pw = $('nudge-password').value
  var email = lastOrder && lastOrder.email ? lastOrder.email : $('email').value.trim()
  var msg = $('nudge-msg')
  if (pw.length < 8) {
    msg.textContent = 'Password needs at least 8 characters.'
    show('nudge-msg')
    return
  }
  fetch(API_BASE + '/api/checkout/convert-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: pw, orderId: lastOrder ? lastOrder.orderId : '' }),
  }).then(function (r) { return r.json() }).then(function (body) {
    if (body.ok) {
      msg.textContent = 'Account created — sign in to the app with this email to see your eSIM.'
    } else {
      msg.textContent = body.error === 'email_in_use'
        ? 'That email already has an account — sign in on the app and use “Restore purchases”.'
        : 'Could not create the account right now — your eSIM is safe in your email.'
    }
    show('nudge-msg')
  }).catch(function () {
    msg.textContent = 'Network hiccup — your eSIM is safe in your email either way.'
    show('nudge-msg')
  })
})

/* ── boot ───────────────────────────────────────────────────────────── */

function bootPlan() {
  show('step-form')
  if (!planId) {
    fetch(API_BASE + '/api/checkout/plan')
      .then(function (r) { return r.json() })
      .then(function (body) { showPicker(body.plans || []) })
      .catch(function () {
        showError('Checkout is temporarily unavailable',
          'We could not load plans. Please try again in a few minutes or contact support.')
      })
    return
  }
  resolvePlan(planId)
    .then(function (body) {
      var plan = body.plan
      if (!plan) throw new Error('plan_missing')
      if (body.coverage === 'coming_soon') {
        renderComingSoon(plan)
        track('checkout_viewed', { planId: plan.id, coverage: 'coming_soon' })
        return { __comingSoon: true } // stop the chain — no payment session
      }
      renderPlan(plan)
      track('checkout_viewed', { planId: plan.id, source: topUpFor ? 'topup' : 'plan' })
      return ensureUid().then(function (resolvedUid) {
        return fetch(API_BASE + '/api/checkout/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planId: plan.id,
            uid: resolvedUid || uidParam || undefined,
            email: $('email').value.trim() || emailPrefill || undefined,
            topUpFor: topUpFor || undefined,
          }),
        })
      }).then(function (r) {
        if (r.__comingSoon) return r
        if (!r.ok) return r.json().then(function (b) { return { __fail: (b && b.error) || ('http_' + r.status) } })
        return r.json()
      }).then(function (pi) {
        if (pi.__comingSoon) return
        if (pi.__fail) {
          $('pay-label').textContent = 'Payments temporarily unavailable'
          $('form-error').textContent =
            'Online payments are not enabled on this deployment yet. No money can be taken — please try again later or contact support.'
          show('form-error')
          track('web_checkout_unavailable', { planId: plan.id, reason: pi.__fail })
          return
        }
        if (pi.publishableKey) STRIPE_PUBLISHABLE_KEY = pi.publishableKey
        initStripe(pi.clientSecret, plan)
      })
    })
    .catch(function (err) {
      console.error('[checkout] boot failed:', err)
      var msg = String(err)
      var badPlan = msg.indexOf('plan_missing') !== -1 || /plan_http_(400|404|422)/.test(msg)
      if (badPlan) {
        planId = null
        fetch(API_BASE + '/api/checkout/plan')
          .then(function (r) { return r.json() })
          .then(function (body) { showPicker(body.plans || []); show('step-form') })
          .catch(function () {
            showError('Checkout is temporarily unavailable',
              'We could not load plans. Please try again in a few minutes or contact support.')
          })
      } else {
        showError('Checkout is temporarily unavailable',
          'We could not start the payment session. No money has moved. Please try again or contact support.')
      }
    })
}

/* email prefill + boot */
if (emailPrefill) $('email').value = emailPrefill
initFirebase()
bootPlan()
