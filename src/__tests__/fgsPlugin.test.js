// Regression guard for the 2026-08-02 root cause.
//
// `/android` is gitignored, so EAS Build re-runs `expo prebuild` and
// regenerates AndroidManifest.xml from app.json — silently discarding any
// hand-edit to the native manifest. For months the shipped APKs therefore
// had NO foreground-service type and fell back to notifee's SHORT_SERVICE,
// which Android ANR-kills after ~3 minutes.
//
// These tests pin the config plugin that puts the type back, and (critically)
// pin the fact that it is REGISTERED in app.json — a plugin that exists but
// isn't wired up is exactly as useless as the manual edit was.
const path = require('path');
const withForegroundServiceType = require('../../plugins/withForegroundServiceType');
const appJson = require('../../app.json');

const SERVICE = 'app.notifee.core.ForegroundService';

// Minimal stand-in for the manifest object the plugin mutates.
function makeConfig(existingServices = []) {
  return {
    modResults: {
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        application: [{ $: {}, service: existingServices }],
      },
    },
  };
}

// The real plugin goes through withAndroidManifest; invoke its mod directly.
jest.mock('@expo/config-plugins', () => ({
  withAndroidManifest: (config, fn) => fn(config),
  AndroidConfig: {
    Manifest: {
      getMainApplicationOrThrow: cfg => cfg.manifest.application[0],
    },
  },
}));

function runPlugin(existingServices) {
  const cfg = makeConfig(existingServices);
  const out = withForegroundServiceType(cfg);
  const app = out.modResults.manifest.application[0];
  return {
    manifest: out.modResults.manifest,
    service: app.service.find(s => s.$['android:name'] === SERVICE),
    serviceCount: app.service.filter(s => s.$['android:name'] === SERVICE).length,
  };
}

describe('withForegroundServiceType plugin', () => {
  test('declares specialUse on notifee’s foreground service', () => {
    const { service } = runPlugin([]);
    expect(service).toBeDefined();
    expect(service.$['android:foregroundServiceType']).toBe('specialUse');
  });

  test('sets tools:replace so it overrides notifee’s own declaration', () => {
    const { service, manifest } = runPlugin([]);
    expect(service.$['tools:replace']).toBe('android:foregroundServiceType');
    // tools: namespace must be declared or the merge fails to build
    expect(manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  test('adds the specialUse subtype property required by Android 14+', () => {
    const { service } = runPlugin([]);
    const prop = service.property.find(
      p => p.$['android:name'] === 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE'
    );
    expect(prop).toBeDefined();
    expect(prop.$['android:value'].length).toBeGreaterThan(10);
  });

  test('is idempotent — running twice does not duplicate service or property', () => {
    const cfg = makeConfig([]);
    withForegroundServiceType(cfg);
    const out = withForegroundServiceType(cfg);
    const app = out.modResults.manifest.application[0];
    const svcs = app.service.filter(s => s.$['android:name'] === SERVICE);
    expect(svcs).toHaveLength(1);
    expect(svcs[0].property).toHaveLength(1);
  });

  test('upgrades an existing service entry rather than adding a second', () => {
    const { serviceCount, service } = runPlugin([
      { $: { 'android:name': SERVICE, 'android:exported': 'false' } },
    ]);
    expect(serviceCount).toBe(1);
    expect(service.$['android:exported']).toBe('false'); // preserved
    expect(service.$['android:foregroundServiceType']).toBe('specialUse');
  });
});

describe('app.json wiring', () => {
  // The whole incident was a native change that never reached the build.
  test('the plugin is registered in app.json (or it never runs on EAS)', () => {
    const names = appJson.expo.plugins.map(p => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('./plugins/withForegroundServiceType');
  });

  test('the plugin file the config points at actually exists', () => {
    const fs = require('fs');
    const p = path.join(__dirname, '../../plugins/withForegroundServiceType.js');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('FOREGROUND_SERVICE_SPECIAL_USE permission is declared in app.json', () => {
    expect(appJson.expo.android.permissions).toContain(
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE'
    );
  });
});
