// JS wrapper for the native workout notification.
//
// Exists so the quick-action buttons can use BROADCAST PendingIntents — those
// do not collapse the notification shade, whereas notifee's action buttons go
// through an activity trampoline and always do. See WorkoutService.kt.
//
// Fails soft everywhere: on iOS, in Jest, and in any build where the native
// module isn't present, `isAvailable()` returns false and the caller falls
// back to the notifee implementation.
let native = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  native = requireNativeModule('GymosWidget');
} catch (_) {}

export function isAvailable() {
  return native != null;
}

// config: { title, body, buttons: [{ id, title, launchApp? }], chronoUntil? }
export function show(config) {
  if (!native) return false;
  try {
    return native.show(config);
  } catch (_) {
    return false;
  }
}

export function dismiss() {
  if (!native) return false;
  try {
    return native.dismiss();
  } catch (_) {
    return false;
  }
}

// Pulls the action carried by a cold-start launch intent (the final-set
// button opens the app rather than broadcasting). Returns null if there
// wasn't one. Consumed once — a second call returns null.
export function consumeLaunchAction() {
  if (!native) return null;
  try {
    return native.consumeLaunchAction() || null;
  } catch (_) {
    return null;
  }
}

// Returns an unsubscribe function.
export function addActionListener(handler) {
  if (!native) return () => {};
  try {
    const sub = native.addListener('onWidgetAction', e => handler(e?.actionId));
    return () => { try { sub.remove(); } catch (_) {} };
  } catch (_) {
    return () => {};
  }
}
