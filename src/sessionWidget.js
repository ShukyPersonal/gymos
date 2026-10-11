// Persistent workout notification — now a notifee FOREGROUND SERVICE.
//
// Why: Android 12+ silently mutes media-stream playback started by an app in
// the background. Holding a foreground service for the duration of the
// workout makes the process "foreground" for audio policy, so the bell that
// src/audio.js plays from notifee's background handler is actually audible
// (and its DuckOthers focus request is honored → Spotify ducks).
//
// The service starts when the first widget is shown (workout start, app in
// foreground — satisfies Android 14 FGS-launch rules) and stops when the
// widget is dismissed (session end / leaving the workout screen).
import notifee, { AndroidImportance } from '@notifee/react-native';
import { Platform, AppState } from 'react-native';
import { log as glog } from './logger';
import * as NativeWidget from '../modules/gymos-widget';

// Prefer our own native notification: its buttons use BROADCAST intents, so
// pressing one does NOT collapse the notification shade. notifee's buttons go
// through an activity trampoline, which always does. Falls back to notifee if
// the native module isn't in the build (e.g. an OTA onto an older APK).
const useNative = () => NativeWidget.isAvailable();

// Single ID — re-displaying with the same ID updates in place (no flicker)
const NOTIF_ID = 'gymos-session';

// Guards against a show call that is in flight when the session ends: if a
// dismiss happens mid-display, the late display would restart the foreground
// service and the widget would linger forever. Each dismiss bumps the
// generation; a show that finishes under a stale generation cleans itself up.
let widgetGeneration = 0;

// True after a successful foreground-service display, false after dismiss.
// Guards the Android FGS contract: startForegroundService() from a
// backgrounded app whose service died throws / ANRs on Android 14+. When
// backgrounded and the service isn't confirmed alive, we skip the cosmetic
// widget refresh instead of risking it.
let serviceRunning = false;

// The rest notification re-posts once a second to keep the countdown live.
// Logging each of those would add ~900 entries per workout and bury the
// diagnostics, so we log only the first display of each rest period.
let lastLoggedRestEnd = null;
export const WIDGET_CHANNEL_ID = 'session-widget-v2';

export const ACTION_SKIP_REST = 'skip-rest';
export const ACTION_LOG_SAME = 'log-same';
export const ACTION_OPEN_EDIT = 'open-edit';
export const WIDGET_ACTION_IDS = [ACTION_SKIP_REST, ACTION_LOG_SAME, ACTION_OPEN_EDIT];

// Create the (silent, low-importance) widget channel. Call once on mount.
export async function setupWidgetChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.createChannel({
      id: WIDGET_CHANNEL_ID,
      name: 'Workout widget',
      importance: AndroidImportance.LOW,
      badge: false,
    });
    glog('widget', 'notifee widget channel created', { id: WIDGET_CHANNEL_ID });
  } catch (e) {
    glog('widget', 'channel error', String(e));
  }
}

function baseAndroid(actions) {
  return {
    channelId: WIDGET_CHANNEL_ID,
    asForegroundService: true,
    // NOTE — `foregroundServiceTypes` is deliberately NOT set.
    // Tested on API 36 (2026-08-02): passing [SPECIAL_USE] does NOT crash or
    // hang, but it is also IGNORED — Android logs "Foreground service start
    // for UID ... does not have any types", i.e. notifee 9.1.8's native side
    // drops the field even though its JS validator accepts it. So it is a
    // no-op here and cannot fix the SHORT_SERVICE 3-minute limit.
    // Fixing that properly needs a notifee upgrade (or a custom FGS), and
    // MUST be verified with ./scripts/boot-smoke.sh on API 36+ before shipping.
    ongoing: true,
    onlyAlertOnce: true,
    autoCancel: false,
    smallIcon: 'ic_launcher',
    pressAction: { id: 'default', launchActivity: 'default' },
    actions,
  };
}

// Format wall-clock end time, e.g. 18:43
function formatEndTime(restEndTimeMs) {
  const d = new Date(restEndTimeMs);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// Displays the notification; if a dismiss raced us mid-flight, immediately
// tears the late display back down instead of leaving a zombie widget.
async function displayWidget(payload, logMsg, logData, quiet = false) {
  if (AppState.currentState !== 'active' && !serviceRunning) {
    glog('widget', 'skipped display (backgrounded, service not running)', logData);
    return;
  }
  const gen = widgetGeneration;
  try {
    if (useNative()) {
      NativeWidget.show({
        title: payload.title,
        body: payload.body,
        chronoUntil: payload.android?.timestamp ?? 0,
        buttons: (payload.android?.actions || []).map(a => ({
          id: a.pressAction.id,
          title: a.title,
          launchApp: a.pressAction.launchActivity === 'default',
        })),
      });
    } else {
      await notifee.displayNotification(payload);
    }
    if (gen !== widgetGeneration) {
      if (useNative()) NativeWidget.dismiss();
      else { await notifee.stopForegroundService(); await notifee.cancelNotification(NOTIF_ID); }
      serviceRunning = false;
      glog('widget', 'late display after dismiss — cleaned up', logData);
      return;
    }
    serviceRunning = true;
    if (!quiet) glog('widget', logMsg, logData);
  } catch (e) {
    glog('widget', `${logMsg} error`, String(e));
  }
}

export async function showRestWidget({ restEndTimeMs, totalSecs, nextExerciseName, lastWeight, lastReps, secsLeft }) {
  const endStr = formatEndTime(restEndTimeMs);
  // Big, readable countdown in the TITLE. Android's chronometer can only
  // render in the small timestamp slot, so the large number requires
  // re-posting the notification each second (driven by the rest tick).
  const n = secsLeft == null
    ? Math.max(0, Math.round((restEndTimeMs - Date.now()) / 1000))
    : Math.max(0, secsLeft);
  const title = n > 0
    ? `Rest for ${n} second${n === 1 ? '' : 's'}`
    : 'Rest done — go!';
  const weightStr = lastWeight != null && lastReps != null
    ? `  ${lastWeight}kg × ${lastReps}`
    : '';
  await displayWidget({
    id: NOTIF_ID,
    title,
    body: `Next: ${nextExerciseName}${weightStr}`,
    // Quick actions omit `launchActivity` so they act WITHOUT opening the
    // app: the press is delivered to notifee's background event handler
    // (index.js) → widgetActions bridge → App.js handler.
    android: {
      ...baseAndroid([
        { title: 'Skip rest →', pressAction: { id: ACTION_SKIP_REST } },
      ]),
      // Small system-rendered countdown beside the app name. Android ticks
      // this one itself; the big number in the title is ours, re-posted per
      // second. `onlyAlertOnce` (see baseAndroid) keeps the updates silent.
      showChronometer: true,
      chronometerDirection: 'down',
      timestamp: restEndTimeMs,
    },
  }, 'showRestWidget', { until: endStr, nextExerciseName, secsLeft: n },
     lastLoggedRestEnd === restEndTimeMs);
  lastLoggedRestEnd = restEndTimeMs;
}

export async function showGoWidget({ exerciseName, setNum, totalSets, lastWeight, lastReps, isBodyweight, isFinalSet = false }) {
  let lastStr = '';
  if (isBodyweight && lastReps != null) lastStr = `Last: ${lastReps} reps`;
  else if (lastWeight != null && lastReps != null) lastStr = `Last: ${lastWeight}kg × ${lastReps}`;
  // The final set ends the workout on the Summary screen, which only exists
  // in the app — so that one press DOES launch it. Every other press stays
  // in the notification drawer.
  const logSameAction = isFinalSet
    ? { title: 'Log & finish ✓', pressAction: { id: ACTION_LOG_SAME, launchActivity: 'default' } }
    : { title: 'Log same ✓', pressAction: { id: ACTION_LOG_SAME } };
  await displayWidget({
    id: NOTIF_ID,
    title: `${exerciseName} · Set ${setNum}/${totalSets}`,
    body: lastStr || 'Tap to log set',
    android: baseAndroid([
      logSameAction,
      { title: 'Open to edit', pressAction: { id: ACTION_OPEN_EDIT, launchActivity: 'default' } },
    ]),
  }, 'showGoWidget', { exerciseName, setNum, totalSets, isFinalSet });
}

export async function dismissSessionWidget() {
  widgetGeneration++;
  serviceRunning = false;
  try {
    if (useNative()) {
      NativeWidget.dismiss();
    } else {
      await notifee.stopForegroundService();
      await notifee.cancelNotification(NOTIF_ID);
    }
    glog('widget', 'dismissed (FGS stopped)', { native: useNative() });
  } catch (e) {
    glog('widget', 'dismiss error', String(e));
  }
}

export function _resetWidgetStateForTests() {
  widgetGeneration = 0;
  serviceRunning = false;
  lastLoggedRestEnd = null;
}
