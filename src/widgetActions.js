// Tiny bridge for widget action presses. Notifee delivers ACTION_PRESS via
// onBackgroundEvent (registered in index.js, before React mounts) when the
// app was backgrounded — this module carries the action into App.js once its
// listener is up, instead of dropping it.
let pendingAction = null;
let listener = null;

export function emitWidgetAction(actionId) {
  if (listener) listener(actionId);
  else pendingAction = actionId;
}

export function setWidgetActionListener(fn) {
  listener = fn;
  if (fn && pendingAction) {
    const a = pendingAction;
    pendingAction = null;
    fn(a);
  }
}
