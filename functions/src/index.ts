/**
 * Jum e-SIM — Cloud Functions for the EXISTING Firebase project (Module 17).
 *
 * Deploy:
 *   cd functions && npm install && firebase deploy --only functions
 *
 * Prerequisites (Firebase console of the existing project):
 *   1. Authentication → Sign-in method → enable "Email/Password"
 *   2. Extensions → install "Trigger Email" (firestore-send-email),
 *      pointing at the `users-welcome` collection, SendGrid API key in env
 *      (free tier: 100 emails/day)
 *   3. Authentication → Templates → "Email address verification" → brand it
 *
 * onAuthCreate fires on EVERY new Auth user (anonymous too) — welcome mail
 * only goes out for email accounts. The client ALSO enqueues the same docs
 * (best-effort, retry-once) so the flow works before this function is
 * deployed; the extension dedupes nothing but a duplicate welcome mail is
 * harmless — delete the client fallback once this is live.
 */
import { onAuthCreate } from 'firebase-functions/v2/identity'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineString } from 'firebase-functions/params'

initializeApp()

const ownerEmail = defineString('OWNER_EMAIL', { default: 'support@jumesim.com' })

export const sendWelcomeEmail = onAuthCreate(async (event) => {
  const user = event.data
  if (!user?.email) return // anonymous sessions get no mail

  const db = getFirestore()
  const stamp = new Date().toISOString()

  // Welcome email — SendGrid template "welcome", extension config maps
  // template.name → the SendGrid template id.
  await db.collection('users-welcome').doc(`welcome-${user.uid}`).set({
    to: user.email,
    template: { name: 'welcome', data: { email: user.email } },
    createdAt: FieldValue.serverTimestamp(),
    source: 'onAuthCreate',
  })

  // Owner alert — growth in real time
  await db.collection('users-welcome').doc(`owner-${user.uid}`).set({
    to: ownerEmail.value(),
    subject: `New signup: ${user.email}`,
    text: `New signup: ${user.email} at ${stamp}`,
    createdAt: FieldValue.serverTimestamp(),
    source: 'onAuthCreate',
  })
})
