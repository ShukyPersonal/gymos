// Expo config plugin — declares notifee's foreground service as `specialUse`.
//
// WHY THIS EXISTS (2026-08-02):
// `/android` is gitignored, so EAS Build re-runs `expo prebuild` and
// regenerates AndroidManifest.xml from app.json. Every hand-edit to
// android/app/src/main/AndroidManifest.xml was silently discarded on every
// cloud build — including the foreground-service type. The shipped APKs
// therefore fell back to notifee's default SHORT_SERVICE, which Android
// hard-limits to ~3 minutes and then ANR-kills the process. That was the
// real cause of the repeated mid-workout deaths.
//
// Anything that must exist in the native manifest MUST go through a config
// plugin like this one, never through a manual file edit.
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const SERVICE_NAME = 'app.notifee.core.ForegroundService';
const FGS_TYPE = 'specialUse';
const SUBTYPE =
  'Keeps the workout rest timer and end-of-rest bell accurate while a session is in progress.';

module.exports = function withForegroundServiceType(config) {
  return withAndroidManifest(config, cfg => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const manifest = cfg.modResults.manifest;

    // `tools:` namespace is required for tools:replace to be legal.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    app.service = app.service || [];

    // Our own workout-notification service (modules/gymos-widget). It calls
    // startForeground(..., FOREGROUND_SERVICE_TYPE_SPECIAL_USE) itself, but
    // the manifest must still declare the type or Android rejects the start.
    const OWN_SERVICE = 'expo.modules.gymoswidget.WorkoutService';
    let own = app.service.find(s => s.$?.['android:name'] === OWN_SERVICE);
    if (!own) {
      own = { $: { 'android:name': OWN_SERVICE } };
      app.service.push(own);
    }
    own.$['android:exported'] = 'false';
    own.$['android:foregroundServiceType'] = FGS_TYPE;
    own.property = [{
      $: {
        'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
        'android:value': SUBTYPE,
      },
    }];

    let svc = app.service.find(s => s.$?.['android:name'] === SERVICE_NAME);
    if (!svc) {
      svc = { $: { 'android:name': SERVICE_NAME } };
      app.service.push(svc);
    }

    // notifee's own manifest already declares this service, so we must
    // explicitly replace its foregroundServiceType during manifest merge.
    svc.$['android:foregroundServiceType'] = FGS_TYPE;
    svc.$['tools:replace'] = 'android:foregroundServiceType';

    // Android 14+ requires a subtype description for specialUse.
    svc.property = svc.property || [];
    const existing = svc.property.find(
      p => p.$?.['android:name'] === 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE'
    );
    if (existing) {
      existing.$['android:value'] = SUBTYPE;
    } else {
      svc.property.push({
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value': SUBTYPE,
        },
      });
    }

    return cfg;
  });
};
