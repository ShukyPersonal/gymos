// JS wrapper for the ExitInfo native module. Fails soft everywhere: on iOS,
// on Android < 11, and in Jest the module simply isn't there.
let nativeModule = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  nativeModule = requireNativeModule('ExitInfo');
} catch (_) {}

export function getRecentExitReasons(maxCount = 5) {
  if (!nativeModule) return [];
  try {
    return nativeModule.getRecentExitReasons(maxCount) || [];
  } catch (_) {
    return [];
  }
}
