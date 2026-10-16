/**
 * Expo config plugin: adds Android 11+ package visibility for WhatsApp so
 * Linking.canOpenURL('whatsapp://…') can see the app on Android 12+.
 *
 * Applied automatically by EAS because app.config.js lists this plugin in
 * `plugins`. The resulting AndroidManifest.xml gains:
 *
 *   <queries>
 *     <package android:name="com.whatsapp" />
 *   </queries>
 *
 * as a direct child of <manifest>. (@expo/config-plugins ships with the
 * expo package at native build time.)
 */
const { withAndroidManifest } = require('@expo/config-plugins')

module.exports = function withWhatsappQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    manifest.queries = manifest.queries || []
    const already = manifest.queries.some(
      (q) =>
        Array.isArray(q.package) &&
        q.package.some((p) => p.$?.['android:name'] === 'com.whatsapp'),
    )
    if (!already) {
      manifest.queries.push({ package: [{ $: { 'android:name': 'com.whatsapp' } }] })
    }
    return cfg
  })
}
