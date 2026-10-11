import { registerRootComponent } from 'expo';
import notifee, { EventType } from '@notifee/react-native';

import App from './App';
import { playBell } from './src/audio';
import { isOurBellId, markBellFired, dismissBellFromDrawer } from './src/bell';
import { WIDGET_ACTION_IDS } from './src/sessionWidget';
import { emitWidgetAction } from './src/widgetActions';
import { log as glog } from './src/logger';

// The workout widget notification runs as a foreground service (see
// src/sessionWidget.js) so the process counts as foreground for Android's
// audio policy — without this, media playback started from the background
// handler below is silently muted on Android 12+. The returned promise
// intentionally never resolves; notifee.stopForegroundService() ends it.
notifee.registerForegroundService(() => {
  // This callback runs exactly when Android actually starts the service —
  // logging here separates "we asked" from "the OS delivered".
  glog('fgs', 'service started by OS');
  return new Promise(() => {});
});

// When notifee delivers our bell while the app is backgrounded (or killed),
// this handler runs in a headless JS task. We play the actual bell sound
// here via expo-av — that routes through Android's media stream with
// DuckOthers so the bell is at media volume and Spotify ducks for it.
//
// The notifee bell channel itself is silent (sound: undefined) — src/bell.js.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const id = detail?.notification?.id;
  if (type === EventType.DELIVERED && isOurBellId(id)) {
    markBellFired(id);
    glog('bell-fired', 'notifee delivered in background', { id });
    try {
      await playBell(require('./assets/boxing_bell.mp3'));
      // Keep the notification visible while the bell rings (lock-screen cue),
      // then clear it so bells don't pile up in the drawer.
      await new Promise(r => setTimeout(r, 3500));
      await dismissBellFromDrawer();
    } catch (e) {
      glog('bell-fired', 'bg playBell error', String(e));
    }
  } else if (type === EventType.ACTION_PRESS) {
    const actionId = detail?.pressAction?.id;
    if (actionId && WIDGET_ACTION_IDS.includes(actionId)) {
      glog('notif-action', 'bg action press', { actionId });
      emitWidgetAction(actionId);
    }
  }
});

registerRootComponent(App);
