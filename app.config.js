/**
 * Expo / EAS build config for the native Jum e-SIM app (iOS + Android).
 *
 * WhatsApp deep-linking requirements (see README → "WhatsApp deep-link
 * config") — WITHOUT these, Linking.canOpenURL('whatsapp://…') ALWAYS
 * returns false and taps never open the app directly:
 *
 *   iOS:     LSApplicationQueriesSchemes must include "whatsapp"
 *            (set below via ios.infoPlist — EAS merges it into Info.plist)
 *   Android: AndroidManifest.xml needs
 *            <queries><package android:name="com.whatsapp"/></queries>
 *            for Android 11+ package visibility (applied by the config
 *            plugin referenced below).
 */
export default {
  expo: {
    name: 'Jum e-SIM',
    slug: 'jum-esim',
    scheme: 'jumesim',
    ios: {
      bundleIdentifier: 'com.jumesim.app',
      infoPlist: {
        // REQUIRED for whatsapp:// deep links (canOpenURL queries scheme)
        LSApplicationQueriesSchemes: ['whatsapp'],
      },
    },
    android: {
      package: 'com.jumesim.app',
    },
    plugins: ['./plugins/with-whatsapp-queries.cjs'],
  },
}
