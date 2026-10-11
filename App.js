import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Animated, StatusBar, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator, Image, Dimensions, AppState,
} from 'react-native';

const SCREEN = Dimensions.get('window');
// With targetSdk 35+ Android enforces edge-to-edge: StatusBar.currentHeight
// reports 0 and initialWindowMetrics is null without a mounted provider (the
// July 26/28 clock-overlap bug). Real insets come from the hook, which needs
// SafeAreaProvider at the root — see the App export.
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
function useTopInset() {
  const insets = useSafeAreaInsets();
  return Math.max(insets.top, StatusBar.currentHeight || 0, 24);
}
import * as Updates from 'expo-updates';
import * as Haptics from 'expo-haptics';
// expo-av plays the bell in-app. During rest we hold a silent audio loop so
// the JS thread stays alive in the background — see src/audio.js.
import {
  playBell as playBellViaAudio, resetToPassive, decideRestEndAction,
} from './src/audio';
import {
  setupBellChannel, scheduleRestEndBell, cancelAllPendingBells,
  dismissBellFromDrawer, isBellInDrawer, markBellFired, isOurBellId,
  BELL_CHANNEL_ID,
} from './src/bell';
import notifee, { EventType as NotifeeEventType } from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import {
  setupWidgetChannel, showRestWidget, showGoWidget, dismissSessionWidget,
  ACTION_SKIP_REST, ACTION_LOG_SAME, WIDGET_ACTION_IDS,
} from './src/sessionWidget';
import { setWidgetActionListener } from './src/widgetActions';
import * as NativeWidget from './modules/gymos-widget';
import { log as glog, startLogSession, endLogSession, syncDanglingSessions, flushLaunchDiagnostics } from './src/logger';
import { logPreviousExits } from './src/exitForensics';
import { markBootStarted, markBootSucceeded, rollbackToEmbedded } from './src/bootGuard';

// Differentiate notifications:
//   • 'gymos-session' (the persistent widget) → show in drawer, no banner, no sound
//   • Rest-end bell → play sound through notification audio stream (won't fight Spotify
//     for media focus, so Spotify just ducks instead of pausing). No banner either —
//     we show the in-app explosion instead.
Notifications.setNotificationHandler({
  handleNotification: async (notif) => {
    const id = notif?.request?.identifier;
    if (id === 'gymos-session') {
      glog('notif-handler', 'widget notif arrived in foreground', { id });
      return {
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }
    glog('notif-handler', 'bell notif arrived in foreground', { id });
    return {
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import ErrorBoundary from './src/ErrorBoundary';
import { loadHistory, loadState, saveState, clearState, finishSession, syncToSheets, loadLastSyncTime, restoreHistoryIfEmpty } from './src/storage';
import {
  currentBlock, currentExercise, advance, isComplete,
  suggestNext, getRestSeconds, summarizeSession, totalProgramSets, isFinalSet, findDay,
} from './src/progression';
import { pickTrainingDay, lastValuesForDay, historyForDay } from './src/trainingDay';
import ParticleTimer from './src/ParticleTimer';
import Explosion from './src/Explosion';
import Speeder from './src/Speeder';
import PlusMinusInput from './src/PlusMinusInput';
import { EXERCISE_ICONS } from './src/exerciseIcons';
import { daysSinceLastLiftLabel } from './src/greeting';
import program from './program.json';

const C = {
  bg: '#FAFAFA', card: '#FFFFFF', primary: '#1A1A1A',
  accent: '#2D7DD2', muted: '#888', border: '#E8E8E8', pr: '#F5A623',
};

const TOTAL_SETS = totalProgramSets();

function AppInner() {
  const topInset = useTopInset();
  const [screen, setScreen] = useState('loading');
  const [history, setHistory] = useState([]);
  const [state, setState] = useState(null);
  const [step, setStep] = useState('WEIGHT');
  const [inputWeight, setInputWeight] = useState('');
  const [inputReps, setInputReps] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [restTotal, setRestTotal] = useState(0);
  const [restSecsLeft, setRestSecsLeft] = useState(0);
  const restEndTimeRef = useRef(null);
  const [summary, setSummary] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [showExplosion, setShowExplosion] = useState(false);
  const prevStateRef = useRef(null);
  const lastSetValuesRef = useRef({});
  const restEndTriggeredRef = useRef(false);
  // Set to true if the OS-delivered bell notification (notifee) fires while
  // the JS thread was suspended — used to avoid a double-ring when JS wakes.
  const bellAlreadyRangRef = useRef(false);
  // Mirror of `step` readable from mount-once listeners
  const stepRef = useRef('WEIGHT');
  stepRef.current = step;
  // Tracks foreground state so the widget effect re-runs on foregrounding —
  // a display skipped by the FGS guard (backgrounded, service dead) must be
  // retried once the app is active, or a resumed workout has no service.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  // Action carried by a launch intent (final-set button). Held until the
  // workout state has actually loaded, otherwise it fires against a null
  // state on cold start and the set is silently dropped.
  const pendingLaunchActionRef = useRef(null);
  // Day A/B for the next workout. Picked from this week's history unless the
  // switch on Home overrides it; an in-progress workout keeps its day in state.
  const [dayOverride, setDayOverride] = useState(null);
  // The active workout's day, for mount-once callbacks (background restore)
  // that can't see the latest `state`.
  const currentDayRef = useRef(null);

  // Ask for notification permission, set up channel + action categories once on launch
  useEffect(() => {
    (async () => {
      try {
        const perm = await Notifications.requestPermissionsAsync();
        glog('init', 'notif permission', perm);
        if (Platform.OS === 'android') {
          // Bell now uses notifee with setAlarmClock; delete the old
          // expo-notifications channels.
          try { await Notifications.deleteNotificationChannelAsync('rest-bell'); } catch (_) {}
          try { await Notifications.deleteNotificationChannelAsync('rest-bell-v2'); } catch (_) {}
          glog('init', 'deleted legacy rest-bell channels');

          // Widget is now a notifee foreground-service notification; drop the
          // old expo-notifications widget channel too.
          try { await Notifications.deleteNotificationChannelAsync('session-widget'); } catch (_) {}

          await setupBellChannel();
          await setupWidgetChannel();

          // List ALL channels so we can see leftover dead channels
          const all = await Notifications.getNotificationChannelsAsync();
          glog('init', 'all channels', all.map(c => ({ id: c.id, name: c.name, importance: c.importance, sound: c.sound, soundUri: c.soundUri })));
        }
      } catch (e) {
        glog('init', 'setup error', String(e));
      }
    })();
  }, []);

  // Notification action handler — kept in a ref so the listener (set up once)
  // always calls the latest closure with up-to-date state
  const widgetActionHandlerRef = useRef(() => {});
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const action = response.actionIdentifier;
      const reqId = response.notification?.request?.identifier;
      glog('notif-action', 'received', { action, notifId: reqId });
      widgetActionHandlerRef.current?.(action);
    });
    const sub2 = Notifications.addNotificationReceivedListener(notif => {
      const id = notif?.request?.identifier;
      glog('notif-received', 'fired', {
        id,
        title: notif?.request?.content?.title,
        sound: notif?.request?.content?.sound,
      });
    });
    // Notifee fires its own foreground events for the bell (separate channel).
    // The channel itself is silent — we play via expo-av so the sound goes
    // through the media stream and ducks Spotify. If the JS tick already
    // started playBell, this call is a safe no-op (idempotent in src/audio).
    const unsubNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      const id = detail?.notification?.id;
      if (type === NotifeeEventType.DELIVERED && isOurBellId(id)) {
        bellAlreadyRangRef.current = true;
        markBellFired(id);
        glog('bell-fired', 'notifee delivered in foreground', { id });
        playBell();
      } else if (type === NotifeeEventType.ACTION_PRESS) {
        const actionId = detail?.pressAction?.id;
        if (actionId && WIDGET_ACTION_IDS.includes(actionId)) {
          glog('notif-action', 'fg action press', { actionId });
          widgetActionHandlerRef.current?.(actionId);
        }
      }
    });
    // A button that opened the app (final set) carries its action on the
    // launch intent. Drain it once the handler is wired, otherwise the press
    // is lost and the user lands on the exercise screen with the set unlogged.
    const pending = NativeWidget.consumeLaunchAction();
    if (pending) {
      glog('notif-action', 'launch action from widget', { actionId: pending });
      pendingLaunchActionRef.current = pending;
    }
    // Native widget buttons (broadcast intents — shade stays open) deliver
    // their presses here.
    const unsubNative = NativeWidget.addActionListener(actionId => {
      if (!actionId) return;
      glog('notif-action', 'native widget action', { actionId });
      widgetActionHandlerRef.current?.(actionId);
    });
    // Widget action presses that arrived via the background handler in
    // index.js (app was backgrounded, button opened the app) land here.
    setWidgetActionListener(actionId => widgetActionHandlerRef.current?.(actionId));
    // Sweep stale bell notifications whenever the app comes back to the
    // foreground — covers rests that ended while the process was dead
    // (crash/ANR), where no tick ever ran to clean the drawer. Only outside
    // REST: during a rest the tick owns drawer handling (a bell in drawer
    // then means THIS rest's bell → suppress logic), and a stale bell that
    // survived into a rest would wrongly silence it.
    const appStateSub = AppState.addEventListener('change', st => {
      setAppActive(st === 'active');
      if (st === 'active' && stepRef.current !== 'REST') {
        isBellInDrawer().then(inDrawer => {
          if (inDrawer) {
            glog('bell-dismiss', 'sweeping stale bell on app resume');
            dismissBellFromDrawer();
          }
        }).catch(() => {});
      }
    });
    return () => { sub.remove(); sub2.remove(); unsubNotifee(); unsubNative(); setWidgetActionListener(null); appStateSub.remove(); };
  }, []);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Startup watchdog — the app must ALWAYS reach a usable screen. If any
  // await in the startup path stalls (slow network, hung native call, bad
  // bundle), render Home anyway rather than stranding the user on
  // "Loading…" forever, as happened 2026-07-30 → 2026-08-02.
  useEffect(() => {
    const t = setTimeout(() => {
      setScreen(prev => {
        if (prev !== 'loading') return prev;
        glog('watchdog', 'startup stalled — forcing home screen');
        return 'home';
      });
    }, 10000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!__DEV__) {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync();
          }
        }
      } catch (_) {}

      // Which build/bundle/OS is this? Stamps every session so "was I on the
      // latest version" is answerable from the Sheet alone.
      glog('init', 'context', {
        os: Platform.Version,
        updateId: Updates.updateId ?? 'embedded',
        updateCreatedAt: Updates.createdAt ? new Date(Updates.createdAt).toISOString() : null,
        runtime: Updates.runtimeVersion ?? null,
      });
      // Boot guard: if this bundle has repeatedly failed to reach a screen,
      // it's bad — fall back to the embedded (APK) bundle rather than
      // stranding the user on "Loading…" (the 2026-07-30 incident).
      try {
        const { shouldRollback } = await markBootStarted(Updates.updateId ?? 'embedded');
        if (shouldRollback && Updates.updateId) {
          const rolled = await rollbackToEmbedded();
          if (rolled) return; // reloading into the embedded bundle
        }
      } catch (e) {
        glog('boot-guard', 'error', String(e));
      }

      // Why did the previous process die? (ANR / signal / freezer / FGS policy)
      // Then upload those launch diagnostics even if no workout is started —
      // otherwise they'd sit in memory until a session begins AND ends.
      logPreviousExits()
        .catch(() => {})
        .then(() => flushLaunchDiagnostics())
        .catch(() => {});
      // Upload any log sessions stranded by a crash (fire-and-forget)
      syncDanglingSessions().catch(() => {});

      let [h, s, lastSync] = await Promise.all([loadHistory(), loadState(), loadLastSyncTime()]);

      // A workout saved before Day A/B existed can't be resumed: its block and
      // exercise indices point into the old program layout. Keep what it logged
      // only if it started in the last 12 hours (interrupted by the update);
      // older ones are abandoned. The emulator carried a month-old test workout
      // that synced into the real Workouts sheet on 2026-09-15.
      if (s && !s.day) {
        const ageHours = (Date.now() - new Date(s.started_at).getTime()) / 3600000;
        if (s.sets?.length && ageHours < 12) {
          h = [...h, await finishSession(s)];
          glog('session', 'saved pre-A/B workout to history', { sets_logged: s.sets.length });
        } else {
          await clearState();
          glog('session', 'discarded pre-A/B workout', { sets_logged: s.sets?.length ?? 0, age_hours: Math.round(ageHours) });
        }
        s = null;
      }

      // Restore history from Sheets. Only BLOCK the launch when local history
      // is empty (fresh install) — otherwise merge in the background so the
      // home screen isn't stuck on a slow Apps Script cold start.
      if (h.length === 0) {
        // Time-boxed: a slow/hanging Apps Script call must never strand the
        // app on the Loading screen. If it doesn't answer in time we render
        // anyway and let the background path fill history in later.
        try {
          const restore = await Promise.race([
            restoreHistoryIfEmpty(),
            new Promise(res => setTimeout(() => res({ restored: 0, reason: "timeout" }), 25000)),
          ]);
          glog('restore', 'attempted (blocking, fresh install)', restore);
          if (restore.restored > 0) h = await loadHistory();
          if (restore.reason === 'timeout') {
            // Keep trying in the background; UI is already unblocked.
            restoreHistoryIfEmpty().then(r => {
              glog('restore', 'late completion after timeout', r);
              if (r.restored > 0) {
                loadHistory().then(fresh => { setHistory(fresh); seedLastValuesFromHistory(fresh, currentDayRef.current); });
              }
            }).catch(() => {});
          }
        } catch (e) {
          glog('restore', 'error', String(e));
        }
      } else {
        restoreHistoryIfEmpty().then(r => {
          glog('restore', 'attempted (background)', r);
          if (r.restored > 0) {
            loadHistory().then(fresh => {
              setHistory(fresh);
              seedLastValuesFromHistory(fresh, currentDayRef.current);
            });
          }
        }).catch(e => glog('restore', 'error', String(e)));
      }
      setHistory(h);
      currentDayRef.current = s && !isComplete(s) ? s.day : null;
      seedLastValuesFromHistory(h, currentDayRef.current);
      setLastSyncTime(lastSync);
      // Retry any sessions that failed to sync (e.g. no signal at the gym)
      syncToSheets(h).then(r => {
        if (r.status === 'ok' || r.status === 'already_synced') setLastSyncTime(new Date());
      }).catch(() => {});
      if (s && !isComplete(s)) {
        // Resuming an in-progress workout (e.g. after a crash). Start a log
        // session for this process lifetime too — otherwise everything after
        // a mid-workout crash is invisible (the July 26 diagnosis gap).
        startLogSession();
        glog('session', 'resumed in-progress workout', { started_at: s.started_at, sets_logged: s.sets?.length });
        setState(s);
        const ex = currentExercise(s);
        const sug = suggestNext(ex.id, historyForDay(h, s.day, ex.id));
        const last = lastSetValuesRef.current[ex.id];
        setSuggestion(sug);
        setInputWeight(last ? String(last.weight) : String(sug.weight));
        setInputReps(last ? String(last.reps) : '');
        setStep('WEIGHT');
        setScreen('workout');
      } else {
        setScreen('home');
      }
      // Reached a real screen — this bundle boots. Clears the failure count.
      markBootSucceeded(Updates.updateId ?? 'embedded').catch(() => {});
    })();
  }, []);

  useEffect(() => {
    if (screen === 'workout') {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
  }, [screen]);

  // Workout forensics: 20s heartbeat (bounds any process death to a 20s
  // window and records the state it died in) + JS-thread stall detector
  // (the precursor signature of ANRs).
  useEffect(() => {
    if (screen !== 'workout') return;
    const hb = setInterval(() => {
      glog('heartbeat', '', {
        appState: AppState.currentState,
        step: stepRef.current,
        secsLeft: stepRef.current === 'REST' && restEndTimeRef.current
          ? Math.floor((restEndTimeRef.current - Date.now()) / 1000)
          : null,
      });
    }, 20000);
    let lastTick = Date.now();
    const stall = setInterval(() => {
      const now = Date.now();
      const drift = now - lastTick - 1000;
      lastTick = now;
      if (drift > 1500) {
        glog('js-stall', 'event loop stalled', {
          stalled_ms: drift,
          step: stepRef.current,
          appState: AppState.currentState,
        });
      }
    }, 1000);
    return () => { clearInterval(hb); clearInterval(stall); };
  }, [screen]);

  async function playBell() {
    glog('play-bell', 'invoked', { appState: AppState.currentState });
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch (_) {}
    await playBellViaAudio(require('./assets/boxing_bell.mp3'));
  }

  // Timestamp-based timer — survives app backgrounding
  useEffect(() => {
    if (step !== 'REST') {
      restEndTriggeredRef.current = false; // reset for the next rest
      return;
    }
    if (restSecsLeft <= 0 && !showExplosion && restEndTriggeredRef.current) {
      setStep('WEIGHT');
      return;
    }

    // Decide whether the OS already rang the bell. Async because we may
    // need to consult the drawer (covers the case where notifee fired in
    // background and our listener didn't run while JS was suspended).
    const checkAlreadyRang = async () => {
      if (bellAlreadyRangRef.current) return true;
      const inDrawer = await isBellInDrawer();
      if (inDrawer) {
        bellAlreadyRangRef.current = true;
        glog('bell-fired', 'detected bell in drawer at tick');
      }
      return bellAlreadyRangRef.current;
    };

    const tick = async () => {
      const remainingMs = restEndTimeRef.current - Date.now();
      // FLOOR, not round: Android's notification chronometer truncates
      // (integer division), so rounding here made the big title number read
      // one second ahead of the small system timer beside "Gymos".
      const secsLeft = Math.max(0, Math.floor(remainingMs / 1000));
      setRestSecsLeft(secsLeft);
      // Fire on the actual deadline rather than on the displayed second.
      // Keying the bell off the rounded value made it ring up to 500ms early
      // (every lateBy_ms in the logs was negative).
      if (remainingMs <= 0 && !restEndTriggeredRef.current) {
        restEndTriggeredRef.current = true;
        const lateBy = Date.now() - restEndTimeRef.current;
        const appActive = AppState.currentState === 'active';
        const alreadyRang = await checkAlreadyRang();
        const action = decideRestEndAction(alreadyRang, appActive);
        glog('rest-end', 'tick detected end', {
          lateBy_ms: lateBy,
          appState: AppState.currentState,
          alreadyRang,
          branch: action,
        });

        if (action === 'suppress') {
          // notifee already rang it — clear the drawer, leave audio alone.
          await cancelAllPendingBells();
          await dismissBellFromDrawer();
        } else if (action === 'in-app') {
          // Foreground: play via expo-av with DuckOthers, cancel pending notifee.
          await cancelAllPendingBells();
          playBell();
        } else {
          // backgrounded with no fire yet — let notifee fire it. Don't cancel.
          glog('rest-end', 'defer to notifee');
        }
        setShowExplosion(true);
      }
    };

    // 250ms so the displayed second flips within ~250ms of the true boundary,
    // keeping it visually in step with Android's own chronometer. The widget
    // only re-posts when the value actually changes, so this costs no extra
    // notification updates.
    const interval = setInterval(tick, 250);
    const sub = AppState.addEventListener('change', async state => {
      glog('appstate', 'change while resting', { newState: state });
      if (state === 'active') {
        if (await isBellInDrawer() && !bellAlreadyRangRef.current) {
          bellAlreadyRangRef.current = true;
          glog('bell-fired', 'detected bell in drawer on app resume');
        }
        tick();
      }
    });
    return () => { clearInterval(interval); sub.remove(); };
  }, [step]);

  function fade(cb) {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    cb();
  }

  // Pre-populate inputs with the last actual values for each exercise, taken
  // from the same training day where possible. Values already logged in the
  // current session take precedence.
  function seedLastValuesFromHistory(h, day) {
    lastSetValuesRef.current = { ...lastValuesForDay(h, day), ...lastSetValuesRef.current };
  }

  function autoSync(updatedHistory) {
    syncToSheets(updatedHistory).then(r => {
      if (r.status === 'ok') setLastSyncTime(new Date());
    }).catch(() => {});
  }

  // Update the persistent session notification whenever workout state changes
  useEffect(() => {
    if (screen !== 'workout' || !state) return;
    const ex = currentExercise(state);
    if (!ex) return;
    const last = lastSetValuesRef.current[ex.id];
    if (step === 'WEIGHT') {
      showGoWidget({
        exerciseName: ex.name,
        setNum: state.set_num,
        totalSets: ex.sets,
        lastWeight: last?.weight,
        lastReps: last?.reps,
        isBodyweight: ex.bodyweight === true,
        isFinalSet: isFinalSet(state),
      });
    } else if (step === 'REST') {
      showRestWidget({
        restEndTimeMs: restEndTimeRef.current,
        totalSecs: restTotal,
        nextExerciseName: ex.name,
        lastWeight: last?.weight,
        lastReps: last?.reps,
        secsLeft: restSecsLeft,
      });
    }
    // `restSecsLeft` is in the deps so the rest notification re-posts once a
    // second, keeping the big countdown in the title live. It only changes
    // during REST, so the GO widget is unaffected.
  }, [screen, step, state, restTotal, appActive, restSecsLeft]);

  // Dismiss the widget whenever we leave the workout screen
  useEffect(() => {
    if (screen !== 'workout') {
      dismissSessionWidget();
      cancelAllPendingBells();
      resetToPassive();
    }
  }, [screen]);

  // Drain a launch-intent action once the workout is actually loaded.
  useEffect(() => {
    if (!pendingLaunchActionRef.current) return;
    if (screen !== 'workout' || !state || step !== 'WEIGHT') return;
    const action = pendingLaunchActionRef.current;
    pendingLaunchActionRef.current = null;
    glog('notif-action', 'applying launch action', { action });
    widgetActionHandlerRef.current?.(action);
  }, [screen, state, step]);

  // Notification action handlers — recreated each render so they capture latest state
  widgetActionHandlerRef.current = (action) => {
    if (action === ACTION_SKIP_REST) {
      if (step === 'REST') {
        cancelAllPendingBells();
        restEndTriggeredRef.current = true;
        setRestSecsLeft(0);
        setStep('WEIGHT');
      }
    } else if (action === ACTION_LOG_SAME) {
      if (step === 'WEIGHT' && state) {
        const r = parseInt(inputReps);
        if (!isNaN(r) && r > 0) logSet();
      }
    }
  };

  async function startSession() {
    const day = dayOverride ?? pickTrainingDay(history, new Date());
    await startLogSession();
    glog('session', 'startSession', { day });
    const fresh = {
      started_at: new Date().toISOString(),
      day,
      block_idx: 0, exercise_idx: 0, set_num: 1, sets: [],
    };
    await saveState(fresh);
    setDayOverride(null);
    currentDayRef.current = day;
    // Reset rather than merge: values left in memory from an earlier workout
    // may come from the other day, where each lift sits elsewhere in the session.
    lastSetValuesRef.current = lastValuesForDay(history, day);
    setState(fresh);
    const ex = currentExercise(fresh);
    const sug = suggestNext(ex.id, historyForDay(history, day, ex.id));
    const last = lastSetValuesRef.current[ex.id];
    setSuggestion(sug);
    setInputWeight(last ? String(last.weight) : String(sug.weight));
    setInputReps(last ? String(last.reps) : '');
    setStep('WEIGHT');
    setScreen('workout');
  }


  async function undoLastSet() {
    if (!prevStateRef.current) return;
    const prev = prevStateRef.current;
    prevStateRef.current = null;
    setCanUndo(false);
    await saveState(prev);
    setState(prev);
    const ex = currentExercise(prev);
    const sug = suggestNext(ex.id, historyForDay(history, prev.day, ex.id));
    const last = lastSetValuesRef.current[ex.id];
    setSuggestion(sug);
    setInputWeight(last ? String(last.weight) : String(sug.weight));
    setInputReps(last ? String(last.reps) : '');
    setStep('WEIGHT');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function logSet() {
    const r = parseInt(inputReps);
    if (isNaN(r) || r <= 0) return;
    const w = parseFloat(inputWeight);
    const weight = isNaN(w) ? suggestion.weight : w;

    prevStateRef.current = state;
    setCanUndo(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const ex = currentExercise(state);
    // Remember what was just logged for this exercise
    lastSetValuesRef.current = { ...lastSetValuesRef.current, [ex.id]: { weight, reps: r } };
    const updatedSets = [...state.sets, {
      exercise_id: ex.id, set_num: state.set_num, weight, reps: r,
      target_reps: suggestion.target_reps,
      timestamp: new Date().toISOString(), skipped: false,
    }];
    const newState = advance({ ...state, sets: updatedSets });

    if (isComplete(newState)) {
      glog('session', 'completed via logSet');
      const session = await finishSession(newState);
      const updatedHistory = [...history, session];
      setHistory(updatedHistory);
      autoSync(updatedHistory);
      setSummary(summarizeSession(session));
      setScreen('summary');
      endLogSession();
      return;
    }

    await saveState(newState);
    setState(newState);

    const nextEx = currentExercise(newState);
    const nextSug = suggestNext(nextEx.id, historyForDay(history, state.day, nextEx.id));
    const lastVals = lastSetValuesRef.current[nextEx.id];
    setSuggestion(nextSug);
    setInputWeight(lastVals ? String(lastVals.weight) : String(nextSug.weight));
    setInputReps(lastVals ? String(lastVals.reps) : '');

    const secs = getRestSeconds(state);
    restEndTimeRef.current = Date.now() + secs * 1000;
    glog('rest-start', 'rest period started', { secs, ends_at: new Date(restEndTimeRef.current).toISOString() });
    setRestTotal(secs);
    setRestSecsLeft(secs);
    bellAlreadyRangRef.current = false;
    // Cancel any pending bells before scheduling a new one. Fixes the ghost
    // notification bug: a rapid second logSet used to leave the previous
    // schedule orphaned, firing later mid-exercise. Also clear any stale
    // delivered bell from the drawer so this rest's alreadyRang detection
    // can't be fooled by a leftover notification.
    await cancelAllPendingBells();
    dismissBellFromDrawer();
    scheduleRestEndBell(secs);
    fade(() => setStep('REST'));
  }

  async function skipExercise() {
    const ex = currentExercise(state);
    const block = currentBlock(state);

    const makeSkip = (exId, setNum) => ({
      exercise_id: exId, set_num: setNum,
      weight: null, reps: null, target_reps: null,
      timestamp: new Date().toISOString(), skipped: true,
    });

    let s;
    if (block.type === 'superset') {
      const newSets = [...state.sets, makeSkip(ex.id, state.set_num)];
      s = advance({ ...state, sets: newSets });
      s = { ...s, sets: newSets };
    } else {
      let sets = [...state.sets];
      let cursor = { ...state };
      while (!isComplete(cursor) && currentExercise(cursor)?.id === ex.id) {
        sets = [...sets, makeSkip(cursor.exercise_id ?? ex.id, cursor.set_num)];
        cursor = advance({ ...cursor, sets });
      }
      s = { ...cursor, sets };
    }

    if (isComplete(s)) {
      glog('session', 'completed via skipExercise');
      const session = await finishSession(s);
      const updatedHistory = [...history, session];
      setHistory(updatedHistory);
      autoSync(updatedHistory);
      setSummary(summarizeSession(session));
      setScreen('summary');
      endLogSession();
      return;
    }

    await saveState(s);
    setState(s);
    const nextEx = currentExercise(s);
    const nextSug = suggestNext(nextEx.id, historyForDay(history, state.day, nextEx.id));
    const last = lastSetValuesRef.current[nextEx.id];
    setSuggestion(nextSug);
    setInputWeight(last ? String(last.weight) : String(nextSug.weight));
    setInputReps(last ? String(last.reps) : '');
    setStep('WEIGHT');
  }

  async function endSessionEarly() {
    glog('session', 'endSessionEarly');
    const session = await finishSession(state);
    const updatedHistory = [...history, session];
    setHistory(updatedHistory);
    autoSync(updatedHistory);
    setSummary(summarizeSession(session));
    setScreen('summary');
    endLogSession();
  }

  async function handleSyncToSheets() {
    setSyncing(true);
    try {
      const result = await syncToSheets(history);
      if (result.status === 'already_synced') {
        Alert.alert('Already synced', 'No new sessions to sync.');
      } else {
        setLastSyncTime(new Date());
        Alert.alert('Synced!', `${result.count} session(s) synced to Google Sheets.`);
      }
    } catch (e) {
      Alert.alert('Sync failed', e.message);
    } finally {
      setSyncing(false);
    }
  }

  function doneWithSummary() {
    setState(null);
    setSummary(null);
    setScreen('home');
  }

  if (screen === 'loading') {
    return <View style={styles.center}><Text style={styles.muted}>Loading…</Text></View>;
  }

  if (screen === 'home') {
    const nextDay = dayOverride ?? pickTrainingDay(history, new Date());
    return (
      <HomeScreen
        history={history}
        day={findDay(nextDay)}
        onSwitchDay={() => setDayOverride(nextDay === 'A' ? 'B' : 'A')}
        onStart={startSession}
        onSync={handleSyncToSheets}
        syncing={syncing}
        lastSyncTime={lastSyncTime}
      />
    );
  }

  if (screen === 'summary') {
    return (
      <SummaryScreen
        summary={summary}
        onDone={doneWithSummary}
        onSync={handleSyncToSheets}
        syncing={syncing}
      />
    );
  }

  // ── Workout screen ──
  const ex = currentExercise(state);
  const block = currentBlock(state);
  if (!ex || !block) return null;
  const bodyweight = ex.bodyweight === true;
  const completedSets = state.sets.filter(s => !s.skipped).length;
  const progress = Math.min(completedSets / TOTAL_SETS, 1);

  return (
    <View style={[styles.safe, { paddingTop: topInset }]}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} translucent={false} />

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.workoutContainer} keyboardShouldPersistTaps="handled">

          <View style={styles.blockHeader}>
            <Text style={styles.blockLabel}>Day {findDay(state.day).id} · {block.name}</Text>
            <View style={styles.setCounterBadge}>
              <Text style={styles.setCounter}>Set {state.set_num}/{ex.sets}</Text>
            </View>
          </View>

          {block.type === 'superset' && (
            <View style={styles.supersetRow}>
              {block.exercises.map(e => (
                <View key={e.id} style={[styles.supersetPill, e.id === ex.id && styles.supersetPillActive]}>
                  <Text style={[styles.supersetPillText, e.id === ex.id && styles.supersetPillTextActive]} numberOfLines={1}>
                    {e.name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Animated.View style={{ opacity: fadeAnim }}>
            {EXERCISE_ICONS[ex.id] && <Image source={EXERCISE_ICONS[ex.id]} style={styles.exerciseIcon} />}
            <Text style={styles.exerciseName}>{ex.name}</Text>
            {bodyweight && <Text style={styles.bodyweightNote}>Bodyweight exercise</Text>}

            {suggestion && (
              <View style={styles.infoCard}>
                <Text style={styles.infoMuted}>{suggestion.last_summary}</Text>
                <Text style={[styles.infoNote, suggestion.is_pr && { color: C.pr }]}>
                  {suggestion.is_pr ? '🏆 ' : ''}{suggestion.note}
                </Text>
              </View>
            )}

            {step === 'REST' && (
              <ParticleTimer
                totalSecs={restTotal}
                secsLeft={restSecsLeft}
                onSkip={() => { cancelAllPendingBells(); setRestSecsLeft(0); setStep('WEIGHT'); }}
              />
            )}

            {step === 'WEIGHT' && (
              <View style={styles.inputCard}>
                <View style={styles.inputRow}>
                  {!bodyweight && (
                    <View style={styles.inputCol}>
                      <Text style={styles.question}>Weight</Text>
                      <Text style={styles.unit}>kg / dumbbell</Text>
                      <PlusMinusInput
                        value={inputWeight}
                        onChange={setInputWeight}
                        step={ex.weight_increment || 1}
                        placeholder={suggestion ? String(suggestion.weight) : '0'}
                        autoFocus
                        compact
                      />
                    </View>
                  )}
                  <View style={styles.inputCol}>
                    <Text style={styles.question}>Reps</Text>
                    <Text style={styles.unit}>{ex.rep_unit || ' '}</Text>
                    <PlusMinusInput
                      value={inputReps}
                      onChange={setInputReps}
                      step={1}
                      placeholder={suggestion ? String(suggestion.target_reps) : '0'}
                      autoFocus={bodyweight}
                      compact
                    />
                  </View>
                </View>
                <TouchableOpacity style={styles.primaryBtn} onPress={logSet}>
                  <Text style={styles.primaryBtnText}>Log set ✓</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>

          <View style={styles.secondaryRow}>
            <TouchableOpacity onPress={skipExercise} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Skip exercise</Text>
            </TouchableOpacity>
            {canUndo
              ? <TouchableOpacity onPress={undoLastSet} style={[styles.secondaryBtn, styles.undoBtn]}>
                  <Text style={styles.undoBtnText}>↩ Undo set</Text>
                </TouchableOpacity>
              : <TouchableOpacity onPress={endSessionEarly} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>End session</Text>
                </TouchableOpacity>
            }
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
      {showExplosion && (
        <Explosion onDone={() => { setShowExplosion(false); setStep('WEIGHT'); }} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary><AppInner /></ErrorBoundary>
    </SafeAreaProvider>
  );
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
function HomeScreen({ history, day, onSwitchDay, onStart, onSync, syncing, lastSyncTime }) {
  const topInset = useTopInset();
  const last = history.length > 0 ? history[history.length - 1] : null;

  // Time-aware greeting
  const hour = new Date().getHours();
  const greeting =
    hour < 5  ? 'Up late' :
    hour < 12 ? 'Good morning' :
    hour < 18 ? 'Good afternoon' :
    hour < 22 ? 'Good evening' : 'Late night lift';

  // Days since last session (calendar-day diff — matches the dot logic below)
  const subtitle = last
    ? daysSinceLastLiftLabel(last.date, new Date())
    : "Let's get the first one in.";

  // Last 14 days dot pattern
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dotDays = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const hit = history.some(s => {
      const sd = new Date(s.date); sd.setHours(0, 0, 0, 0);
      return sd.getTime() === d.getTime();
    });
    dotDays.push(hit);
  }

  // Pulsing halo behind the Start button
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={[styles.safe, { paddingTop: topInset }]}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} translucent={false} />
      <View style={styles.homeContainer}>

        <View style={styles.homeGreetingBlock}>
          <Text style={styles.homeGreeting}>{greeting}</Text>
          <Text style={styles.homeSubtitle}>{subtitle}</Text>
          <TouchableOpacity style={styles.dayPill} onPress={onSwitchDay} activeOpacity={0.6}>
            <Text style={styles.dayPillText}>Day {day.id} · {day.label}</Text>
            <Text style={styles.dayPillSwitch}>switch</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.startWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.startPulse,
              { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
            ]}
          />
          <TouchableOpacity style={styles.startBtn} onPress={onStart} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>Start Workout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dotsBlock}>
          <View style={styles.dotsRow}>
            {dotDays.map((hit, i) => (
              <View key={i} style={[styles.dot, hit && styles.dotHit]} />
            ))}
          </View>
          <Text style={styles.dotsLabel}>Last 14 days</Text>
        </View>

        <View style={styles.speederWrap}>
          <Speeder />
        </View>

        <TouchableOpacity style={styles.syncBtnSmall} onPress={onSync} disabled={syncing}>
          {syncing
            ? <ActivityIndicator color={C.muted} size="small" />
            : <Text style={styles.syncBtnSmallText}>Sync to Sheets</Text>}
        </TouchableOpacity>
        {lastSyncTime && (
          <Text style={styles.syncStatus}>
            ● Synced {lastSyncTime.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at {lastSyncTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}

      </View>
    </View>
  );
}

// ─── SummaryScreen ─────────────────────────────────────────────────────────────
function SummaryScreen({ summary, onDone, onSync, syncing }) {
  const topInset = useTopInset();
  return (
    <View style={[styles.safe, { paddingTop: topInset }]}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} translucent={false} />
      <ScrollView contentContainerStyle={styles.summaryContainer}>
        <Text style={styles.summaryTitle}>Session Complete</Text>
        <Text style={styles.summaryDuration}>{summary.duration_min} min{summary.day ? ` · Day ${summary.day}` : ''}</Text>

        <View style={styles.summaryCard}>
          {summary.exercises.map((e, i) => (
            <Text key={i} style={styles.summaryRow}>
              {e.skipped ? `• ${e.name}: skipped` : `• ${e.name}: ${e.weight}kg × ${e.repsStr}`}
            </Text>
          ))}
        </View>

        {summary.prs.length > 0 && (
          <View style={[styles.summaryCard, { borderColor: C.pr, borderWidth: 1.5 }]}>
            <Text style={[styles.summaryCardTitle, { color: C.pr }]}>🏆 PRs — add weight next time</Text>
            {summary.prs.map((p, i) => (
              <Text key={i} style={styles.summaryRow}>• {p}</Text>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.syncBtn} onPress={onSync} disabled={syncing}>
          {syncing
            ? <ActivityIndicator color={C.accent} />
            : <Text style={styles.syncBtnText}>Sync to Google Sheets</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.startBtn} onPress={onDone}>
          <Text style={styles.startBtnText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: C.muted, fontSize: 16 },

  progressTrack: { height: 3, backgroundColor: C.border },
  progressFill: { height: 3, backgroundColor: C.accent },

  homeContainer: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },

  homeGreetingBlock: { alignItems: 'center', marginBottom: 56 },
  homeGreeting: { fontSize: 34, fontWeight: '800', color: C.primary, textAlign: 'center', letterSpacing: -0.5 },
  homeSubtitle: { fontSize: 15, color: C.muted, marginTop: 8, textAlign: 'center' },
  dayPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  dayPillText: { fontSize: 14, color: C.primary, fontWeight: '600' },
  dayPillSwitch: { fontSize: 13, color: C.accent, fontWeight: '600' },

  startWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 40 },
  startPulse: {
    position: 'absolute',
    width: 240, height: 80,
    borderRadius: 40,
    backgroundColor: C.primary,
  },
  startBtn: {
    backgroundColor: C.primary, borderRadius: 40,
    paddingVertical: 22, paddingHorizontal: 56,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 240,
  },
  startBtnText: { color: '#FFF', fontSize: 19, fontWeight: '800', letterSpacing: 0.3 },

  dotsBlock: { alignItems: 'center', marginBottom: 32 },
  speederWrap: { alignItems: 'center', marginBottom: 32 },
  dotsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.border },
  dotHit: { backgroundColor: C.accent },
  dotsLabel: { fontSize: 12, color: C.muted, letterSpacing: 0.5 },

  syncBtnSmall: { paddingVertical: 8, paddingHorizontal: 14 },
  syncBtnSmallText: { color: C.muted, fontSize: 13, fontWeight: '500' },
  syncStatus: { fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 2 },

  workoutContainer: { padding: 16, paddingTop: 8, paddingBottom: 16 },
  blockHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  blockLabel: { fontSize: 13, color: C.muted, fontWeight: '500', flex: 1 },
  setCounterBadge: {
    backgroundColor: C.accent + '18', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  setCounter: { fontSize: 13, color: C.accent, fontWeight: '700' },
  supersetRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  supersetPill: {
    flex: 1, borderRadius: 20, borderWidth: 1.5, borderColor: C.border,
    paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', backgroundColor: C.card,
  },
  supersetPillActive: { backgroundColor: C.primary, borderColor: C.primary },
  supersetPillText: { fontSize: 11, color: C.muted, fontWeight: '500', textAlign: 'center' },
  supersetPillTextActive: { color: '#FFF', fontWeight: '700' },
  exerciseIcon: { width: 60, height: 60, alignSelf: 'center', marginBottom: 4, borderRadius: 10 },
  exerciseName: { fontSize: 24, fontWeight: '800', color: C.primary, marginBottom: 4, lineHeight: 28, textAlign: 'center' },
  bodyweightNote: { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 8 },
  infoCard: {
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  infoMuted: { fontSize: 13, color: C.muted, marginBottom: 2 },
  infoNote: { fontSize: 14, color: C.primary, fontWeight: '500' },
  inputCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  question: { fontSize: 16, fontWeight: '600', color: C.primary, marginBottom: 2 },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputCol: { flex: 1 },
  unit: { fontSize: 14, fontWeight: '400', color: C.muted },
  weightConfirm: { fontSize: 14, color: C.muted, marginBottom: 4 },
  primaryBtn: {
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  restCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 24,
    alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: C.border,
  },
  restLabel: { fontSize: 14, color: C.muted, fontWeight: '500', marginBottom: 8 },
  secondaryRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  secondaryBtn: {
    flex: 1, paddingVertical: 11, alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  secondaryBtnText: { color: C.muted, fontSize: 14 },
  undoBtn: { borderColor: C.accent },
  undoBtnText: { color: C.accent, fontSize: 14, fontWeight: '600' },

  summaryContainer: { padding: 24, paddingBottom: 48 },
  summaryTitle: { fontSize: 28, fontWeight: '700', color: C.primary, marginBottom: 4 },
  summaryDuration: { fontSize: 15, color: C.muted, marginBottom: 24 },
  summaryCard: {
    backgroundColor: C.card, borderRadius: 12, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: C.border,
  },
  summaryCardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  summaryRow: { fontSize: 14, color: C.primary, lineHeight: 24 },
});
