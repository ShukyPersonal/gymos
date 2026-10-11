// Tests for the foreground-service workout widget.
jest.mock('@notifee/react-native', () => {
  const displayed = [];
  return {
    __esModule: true,
    default: {
      createChannel: jest.fn(async (cfg) => cfg.id),
      displayNotification: jest.fn(async (n) => { displayed.push(n); return n.id; }),
      cancelNotification: jest.fn(async () => {}),
      stopForegroundService: jest.fn(async () => {}),
    },
    AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
    AndroidForegroundServiceType: {
      FOREGROUND_SERVICE_TYPE_SHORT_SERVICE: 2048,
      FOREGROUND_SERVICE_TYPE_SPECIAL_USE: 1073741824,
    },
    __displayed: displayed,
  };
});
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { currentState: 'active' },
}));
jest.mock('../logger', () => ({ log: jest.fn() }));

const notifeeMod = require('@notifee/react-native');
const notifee = notifeeMod.default;
const { AppState } = require('react-native');
const widget = require('../sessionWidget');

beforeEach(() => {
  notifee.createChannel.mockClear();
  notifee.displayNotification.mockClear();
  notifee.cancelNotification.mockClear();
  notifee.stopForegroundService.mockClear();
  notifeeMod.__displayed.length = 0;
  AppState.currentState = 'active';
  widget._resetWidgetStateForTests();
});

describe('setupWidgetChannel', () => {
  test('creates LOW-importance silent channel', async () => {
    await widget.setupWidgetChannel();
    expect(notifee.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: widget.WIDGET_CHANNEL_ID, importance: 2 })
    );
  });
});

describe('showRestWidget / showGoWidget — foreground service', () => {
  test('rest widget runs as foreground service with skip action', async () => {
    await widget.showRestWidget({
      restEndTimeMs: Date.now() + 45000, totalSecs: 45,
      nextExerciseName: 'Pull-ups', lastWeight: 14, lastReps: 10,
    });
    const n = notifeeMod.__displayed[0];
    expect(n.android).toMatchObject({
      channelId: widget.WIDGET_CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
    });
    expect(n.android.actions.map(a => a.pressAction.id)).toEqual([widget.ACTION_SKIP_REST]);
  });

  test('go widget runs as foreground service with log-same + open-edit actions', async () => {
    await widget.showGoWidget({
      exerciseName: 'Bench', setNum: 2, totalSets: 3, lastWeight: 28, lastReps: 8,
    });
    const n = notifeeMod.__displayed[0];
    expect(n.android.asForegroundService).toBe(true);
    expect(n.android.actions.map(a => a.pressAction.id)).toEqual([
      widget.ACTION_LOG_SAME, widget.ACTION_OPEN_EDIT,
    ]);
  });

  test('re-display uses the same notification id (updates in place)', async () => {
    await widget.showGoWidget({ exerciseName: 'A', setNum: 1, totalSets: 3 });
    await widget.showRestWidget({ restEndTimeMs: Date.now(), totalSecs: 30, nextExerciseName: 'B' });
    expect(notifeeMod.__displayed[0].id).toBe(notifeeMod.__displayed[1].id);
  });
});

describe('quick actions act without opening the app', () => {
  // Verified behaviourally on API 36 (2026-08-13): with `launchActivity`
  // omitted, pressing "Log same" while backgrounded logged the set and
  // flipped the widget to Rest while ResumedActivity stayed on the
  // launcher — the app never surfaced. Re-adding launchActivity to these
  // two buttons would drag the user into the app mid-workout.
  test('“Log same” omits launchActivity', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    const a = notifeeMod.__displayed[0].android.actions.find(
      x => x.pressAction.id === widget.ACTION_LOG_SAME
    );
    expect(a.pressAction.launchActivity).toBeUndefined();
  });

  test('“Skip rest” omits launchActivity', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now(), totalSecs: 45, nextExerciseName: 'X' });
    const a = notifeeMod.__displayed[0].android.actions.find(
      x => x.pressAction.id === widget.ACTION_SKIP_REST
    );
    expect(a.pressAction.launchActivity).toBeUndefined();
  });

  test('“Open to edit” keeps launchActivity — opening the app is its purpose', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    const a = notifeeMod.__displayed[0].android.actions.find(
      x => x.pressAction.id === widget.ACTION_OPEN_EDIT
    );
    expect(a.pressAction.launchActivity).toBe('default');
  });

  test('tapping the notification body still opens the app', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(notifeeMod.__displayed[0].android.pressAction).toEqual(
      expect.objectContaining({ id: 'default', launchActivity: 'default' })
    );
  });
});

describe('dismissSessionWidget', () => {
  test('stops the foreground service and cancels the notification', async () => {
    await widget.dismissSessionWidget();
    expect(notifee.stopForegroundService).toHaveBeenCalled();
    expect(notifee.cancelNotification).toHaveBeenCalled();
  });

  test('a display in flight during dismiss cleans itself up (no zombie widget)', async () => {
    // Make displayNotification hang until we release it
    let releaseDisplay;
    notifee.displayNotification.mockImplementationOnce(
      () => new Promise(resolve => { releaseDisplay = resolve; })
    );

    const showPromise = widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    await widget.dismissSessionWidget();
    const stopsAfterDismiss = notifee.stopForegroundService.mock.calls.length;
    const cancelsAfterDismiss = notifee.cancelNotification.mock.calls.length;

    // Late display resolves AFTER the dismiss — must tear itself down
    releaseDisplay();
    await showPromise;

    expect(notifee.stopForegroundService.mock.calls.length).toBe(stopsAfterDismiss + 1);
    expect(notifee.cancelNotification.mock.calls.length).toBe(cancelsAfterDismiss + 1);
  });

  test('a display completing before dismiss does not self-clean', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
    expect(notifee.cancelNotification).not.toHaveBeenCalled();
  });
});

describe('foreground service type', () => {
  // Regression guard for the July 28/30 mid-workout kills: notifee defaults
  // to SHORT_SERVICE (2048), which Android ANR-kills after ~3 minutes.
  // 2026-08-02: setting foregroundServiceTypes: [SPECIAL_USE] shipped as an
  // OTA and left the app stuck on "Loading…" for three days. It is deliberately
  // NOT set until a fix is verified by ./scripts/boot-smoke.sh on API 36+.
  // This test fails if someone re-adds it without that verification.
  test('does not set foregroundServiceTypes (unverified on API 36+)', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    await widget.showRestWidget({ restEndTimeMs: Date.now(), totalSecs: 45, nextExerciseName: 'X' });
    expect(notifeeMod.__displayed).toHaveLength(2);
    for (const n of notifeeMod.__displayed) {
      expect(n.android.foregroundServiceTypes).toBeUndefined();
    }
  });
});

describe('FGS start-from-background guard (ANR hardening)', () => {
  test('skips display when backgrounded and service not running', async () => {
    AppState.currentState = 'background';
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  test('allows backgrounded display when service is confirmed running', async () => {
    // Foreground display starts the service
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
    // Now backgrounded — service alive → update allowed
    AppState.currentState = 'background';
    await widget.showRestWidget({ restEndTimeMs: Date.now(), totalSecs: 30, nextExerciseName: 'X' });
    expect(notifee.displayNotification).toHaveBeenCalledTimes(2);
  });

  test('after dismiss, backgrounded display is skipped again', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    await widget.dismissSessionWidget();
    AppState.currentState = 'background';
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 2, totalSets: 3 });
    expect(notifee.displayNotification).toHaveBeenCalledTimes(1); // only the first
  });
});

describe('rest countdown (live chronometer)', () => {
  // Android renders the countdown itself from `timestamp`; if these fields
  // are dropped the widget silently reverts to a static "until HH:MM".
  test('rest widget asks Android for a DOWN chronometer ending at rest end', async () => {
    const end = Date.now() + 45000;
    await widget.showRestWidget({ restEndTimeMs: end, totalSecs: 45, nextExerciseName: 'Pull-ups' });
    const a = notifeeMod.__displayed[0].android;
    expect(a.showChronometer).toBe(true);
    expect(a.chronometerDirection).toBe('down');
    expect(a.timestamp).toBe(end);
  });

  test('chronometer fields sit under `android`, not at the top level', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now() + 1000, totalSecs: 45, nextExerciseName: 'X' });
    const n = notifeeMod.__displayed[0];
    expect(n.showChronometer).toBeUndefined();
    expect(n.timestamp).toBeUndefined();
    expect(n.android.showChronometer).toBe(true);
  });

  test('foreground-service config survives alongside the chronometer', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now() + 1000, totalSecs: 45, nextExerciseName: 'X' });
    const a = notifeeMod.__displayed[0].android;
    expect(a.asForegroundService).toBe(true);
    expect(a.ongoing).toBe(true);
    expect(a.channelId).toBe(widget.WIDGET_CHANNEL_ID);
  });

  test('go widget has no chronometer (only rest counts down)', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(notifeeMod.__displayed[0].android.showChronometer).toBeUndefined();
  });
});

describe('final set opens the app', () => {
  test('non-final "Log same" stays in the drawer', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3, isFinalSet: false });
    const a = notifeeMod.__displayed[0].android.actions.find(x => x.pressAction.id === widget.ACTION_LOG_SAME);
    expect(a.pressAction.launchActivity).toBeUndefined();
    expect(a.title).toBe('Log same ✓');
  });

  test('final set launches the app so Summary is reachable', async () => {
    await widget.showGoWidget({ exerciseName: 'Lunges', setNum: 3, totalSets: 3, isFinalSet: true });
    const a = notifeeMod.__displayed[0].android.actions.find(x => x.pressAction.id === widget.ACTION_LOG_SAME);
    expect(a.pressAction.launchActivity).toBe('default');
    expect(a.title).toBe('Log & finish ✓');
  });

  test('defaults to non-final when the flag is omitted', async () => {
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    const a = notifeeMod.__displayed[0].android.actions.find(x => x.pressAction.id === widget.ACTION_LOG_SAME);
    expect(a.pressAction.launchActivity).toBeUndefined();
  });

  test('"Open to edit" always launches, final or not', async () => {
    for (const f of [true, false]) {
      notifeeMod.__displayed.length = 0;
      await widget.showGoWidget({ exerciseName: 'X', setNum: 1, totalSets: 3, isFinalSet: f });
      const a = notifeeMod.__displayed[0].android.actions.find(x => x.pressAction.id === widget.ACTION_OPEN_EDIT);
      expect(a.pressAction.launchActivity).toBe('default');
    }
  });
});

describe('countdown in the title (per-second re-post)', () => {
  const glog = require('../logger').log;

  test('title carries the big number, body carries next exercise + weights', async () => {
    await widget.showRestWidget({
      restEndTimeMs: Date.now() + 45000, totalSecs: 45,
      nextExerciseName: 'Incline Bench Press 30°', lastWeight: 28, lastReps: 10, secsLeft: 45,
    });
    const n = notifeeMod.__displayed[0];
    expect(n.title).toBe('Rest for 45 seconds');
    expect(n.body).toBe('Next: Incline Bench Press 30°  28kg × 10');
  });

  test('singular at 1 second', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now(), totalSecs: 45, nextExerciseName: 'X', secsLeft: 1 });
    expect(notifeeMod.__displayed[0].title).toBe('Rest for 1 second');
  });

  test('shows a done state at zero rather than "0 seconds"', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now(), totalSecs: 45, nextExerciseName: 'X', secsLeft: 0 });
    expect(notifeeMod.__displayed[0].title).toBe('Rest done — go!');
  });

  test('never renders a negative countdown', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now() - 9000, totalSecs: 45, nextExerciseName: 'X', secsLeft: -9 });
    expect(notifeeMod.__displayed[0].title).toBe('Rest done — go!');
  });

  test('derives the number from restEndTimeMs when secsLeft is omitted', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now() + 30000, totalSecs: 30, nextExerciseName: 'X' });
    expect(notifeeMod.__displayed[0].title).toMatch(/^Rest for (29|30) seconds$/);
  });

  test('body omits weights gracefully when there is no prior set', async () => {
    await widget.showRestWidget({ restEndTimeMs: Date.now() + 1000, totalSecs: 45, nextExerciseName: 'Dragon Flag', secsLeft: 10 });
    expect(notifeeMod.__displayed[0].body).toBe('Next: Dragon Flag');
  });

  test('the small system chronometer is kept alongside the title countdown', async () => {
    const end = Date.now() + 45000;
    await widget.showRestWidget({ restEndTimeMs: end, totalSecs: 45, nextExerciseName: 'X', secsLeft: 45 });
    const a = notifeeMod.__displayed[0].android;
    expect(a.showChronometer).toBe(true);
    expect(a.timestamp).toBe(end);
    expect(a.onlyAlertOnce).toBe(true); // per-second updates must stay silent
  });

  test('logs once per rest period, not once per second', async () => {
    glog.mockClear();
    const end = Date.now() + 45000;
    for (let s = 45; s > 40; s--) {
      await widget.showRestWidget({ restEndTimeMs: end, totalSecs: 45, nextExerciseName: 'X', secsLeft: s });
    }
    const restLogs = glog.mock.calls.filter(c => c[1] === 'showRestWidget');
    expect(restLogs).toHaveLength(1);
    expect(notifeeMod.__displayed).toHaveLength(5); // but all 5 were displayed
  });

  test('a NEW rest period logs again', async () => {
    glog.mockClear();
    await widget.showRestWidget({ restEndTimeMs: 1000, totalSecs: 45, nextExerciseName: 'A', secsLeft: 45 });
    await widget.showRestWidget({ restEndTimeMs: 1000, totalSecs: 45, nextExerciseName: 'A', secsLeft: 44 });
    await widget.showRestWidget({ restEndTimeMs: 2000, totalSecs: 45, nextExerciseName: 'B', secsLeft: 45 });
    const restLogs = glog.mock.calls.filter(c => c[1] === 'showRestWidget');
    expect(restLogs).toHaveLength(2); // one per distinct rest period
  });
});

describe('native widget routing (broadcast actions keep the shade open)', () => {
  // With the native module present the widget MUST go through it: its buttons
  // use broadcast PendingIntents, so pressing one doesn't collapse the
  // notification shade. notifee's buttons are activity trampolines and always
  // do. Verified on API 36 (2026-08-20): shade focus stayed 1 across a press.
  const NativeWidget = require('../../modules/gymos-widget');

  afterEach(() => { jest.restoreAllMocks(); });

  function withNative() {
    jest.spyOn(NativeWidget, 'isAvailable').mockReturnValue(true);
    return jest.spyOn(NativeWidget, 'show').mockReturnValue(true);
  }

  test('routes through the native module instead of notifee', async () => {
    const show = withNative();
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(show).toHaveBeenCalledTimes(1);
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  test('quick action is sent WITHOUT launchApp; "Open to edit" with it', async () => {
    const show = withNative();
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    const buttons = show.mock.calls[0][0].buttons;
    const logSame = buttons.find(b => b.id === widget.ACTION_LOG_SAME);
    const openEdit = buttons.find(b => b.id === widget.ACTION_OPEN_EDIT);
    expect(logSame.launchApp).toBe(false);
    expect(openEdit.launchApp).toBe(true);
  });

  test('final set marks the quick action as launching the app', async () => {
    const show = withNative();
    await widget.showGoWidget({ exerciseName: 'Lunges', setNum: 3, totalSets: 3, isFinalSet: true });
    const logSame = show.mock.calls[0][0].buttons.find(b => b.id === widget.ACTION_LOG_SAME);
    expect(logSame.launchApp).toBe(true);
  });

  test('rest widget passes the countdown target as chronoUntil', async () => {
    const show = withNative();
    const end = Date.now() + 45000;
    await widget.showRestWidget({ restEndTimeMs: end, totalSecs: 45, nextExerciseName: 'X', secsLeft: 45 });
    const cfg = show.mock.calls[0][0];
    expect(cfg.chronoUntil).toBe(end);
    expect(cfg.title).toBe('Rest for 45 seconds');
  });

  test('falls back to notifee when the native module is absent', async () => {
    jest.spyOn(NativeWidget, 'isAvailable').mockReturnValue(false);
    await widget.showGoWidget({ exerciseName: 'Bench', setNum: 1, totalSets: 3 });
    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
  });

  test('dismiss uses the native module when present', async () => {
    jest.spyOn(NativeWidget, 'isAvailable').mockReturnValue(true);
    const dismiss = jest.spyOn(NativeWidget, 'dismiss').mockReturnValue(true);
    await widget.dismissSessionWidget();
    expect(dismiss).toHaveBeenCalled();
    expect(notifee.stopForegroundService).not.toHaveBeenCalled();
  });
});
