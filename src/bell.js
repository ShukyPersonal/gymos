// Notifee-based bell scheduling.
//
// expo-notifications' TIME_INTERVAL trigger funnels through Android's
// setExactAndAllowWhileIdle, which has per-app quotas and gets downgraded
// to inexact alarms after a few uses in a 9-min window. That's why the bell
// would drop or fire 20-60s late during a workout (the logs showed it).
//
// Notifee's TIMESTAMP trigger with AlarmType.SET_ALARM_CLOCK uses Android's
// setAlarmClock under the hood, which Doze cannot defer — the OS treats it
// as a user-visible alarm. Bell fires on time in background, screen-locked,
// regardless of battery optimization.
import notifee, {
  TriggerType, AndroidImportance, AlarmType, AndroidVisibility,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { log as glog } from './logger';

// v2: silent channel — we play the actual sound via expo-av (in foreground
// from the JS tick, in background from notifee's headless handler) so it
// routes through the media audio stream with DuckOthers. Android channel
// configs are immutable after creation, so we need a new ID to switch.
export const BELL_CHANNEL_ID = 'rest-bell-alarm-v2';
const LEGACY_BELL_CHANNEL_IDS = ['rest-bell-alarm'];
const BELL_NOTIFICATION_ID_PREFIX = 'rest-bell-';

// Track every scheduled bell ID so we can cancel them all — fixes the ghost
// notification bug where a rapid second logSet overwrote the previous ref.
let pendingBellIds = new Set();

export async function setupBellChannel() {
  if (Platform.OS !== 'android') return;
  try {
    // Drop the old sound-bearing channel — the new path routes audio via
    // expo-av instead of through the notification stream.
    for (const id of LEGACY_BELL_CHANNEL_IDS) {
      try { await notifee.deleteChannel(id); } catch (_) {}
    }
    await notifee.createChannel({
      id: BELL_CHANNEL_ID,
      name: 'Rest end bell',
      importance: AndroidImportance.HIGH,
      sound: undefined, // silent — expo-av plays the actual sound
      vibration: true,
      vibrationPattern: [250, 250],
      visibility: AndroidVisibility.PUBLIC,
    });
    glog('bell-channel', 'notifee channel created (silent)', { id: BELL_CHANNEL_ID });
  } catch (e) {
    glog('bell-channel', 'create error', String(e));
  }
}

export async function scheduleRestEndBell(restSecs) {
  const ms = Math.max(1000, Math.round(restSecs * 1000));
  const fireAt = Date.now() + ms;
  const id = BELL_NOTIFICATION_ID_PREFIX + fireAt;
  try {
    await notifee.createTriggerNotification(
      {
        id,
        title: 'Rest done!',
        body: 'Time to crush the next set 💪',
        android: {
          channelId: BELL_CHANNEL_ID,
          pressAction: { id: 'default' },
          smallIcon: 'ic_launcher',
          autoCancel: true,
          // No sound here — expo-av plays it via the background event
          // handler so it routes through media stream + ducks Spotify.
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: fireAt,
        alarmManager: {
          allowWhileIdle: true,
          type: AlarmType.SET_ALARM_CLOCK,
        },
      }
    );
    pendingBellIds.add(id);
    glog('schedule-bell', 'scheduled (notifee)', {
      id,
      in_seconds: Math.round(ms / 1000),
      expected_fire: new Date(fireAt).toISOString(),
      pending_count: pendingBellIds.size,
    });
    return id;
  } catch (e) {
    glog('schedule-bell', 'error (notifee)', String(e));
    return null;
  }
}

// Cancel EVERY pending bell, not just the latest.
export async function cancelAllPendingBells() {
  const ids = [...pendingBellIds];
  pendingBellIds.clear();
  if (ids.length === 0) {
    glog('cancel-bell', 'nothing to cancel');
    return;
  }
  for (const id of ids) {
    try { await notifee.cancelTriggerNotification(id); } catch (_) {}
  }
  glog('cancel-bell', 'cancelled (notifee)', { ids, count: ids.length });
}

export async function isBellInDrawer() {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    return displayed.some(d => d.notification?.android?.channelId === BELL_CHANNEL_ID);
  } catch (_) {
    return false;
  }
}

export async function dismissBellFromDrawer() {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    let n = 0;
    for (const d of displayed) {
      if (d.notification?.android?.channelId === BELL_CHANNEL_ID) {
        await notifee.cancelDisplayedNotification(d.id);
        n++;
      }
    }
    if (n) glog('bell-dismiss', 'cleared bell from drawer', { count: n });
  } catch (e) {
    glog('bell-dismiss', 'error', String(e));
  }
}

// Called from the notification-received listener so we know a fired bell
// is no longer a pending schedule we should try to cancel.
export function markBellFired(id) {
  if (id && pendingBellIds.has(id)) {
    pendingBellIds.delete(id);
  }
}

export function isOurBellId(id) {
  return typeof id === 'string' && id.startsWith(BELL_NOTIFICATION_ID_PREFIX);
}

// Test helpers
export function _getPendingBellIds() { return new Set(pendingBellIds); }
export function _resetForTests() { pendingBellIds = new Set(); }
