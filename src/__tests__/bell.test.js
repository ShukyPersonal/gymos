// Tests for the notifee-based bell scheduler.
jest.mock('@notifee/react-native', () => {
  const triggerCalls = [];
  const cancelCalls = [];
  let displayed = [];
  return {
    __esModule: true,
    default: {
      createChannel: jest.fn(async (cfg) => cfg.id),
      deleteChannel: jest.fn(async () => {}),
      createTriggerNotification: jest.fn(async (notif, trigger) => {
        triggerCalls.push({ notif, trigger });
        return notif.id;
      }),
      cancelTriggerNotification: jest.fn(async (id) => { cancelCalls.push(id); }),
      cancelDisplayedNotification: jest.fn(async (id) => {
        displayed = displayed.filter(d => d.id !== id);
      }),
      getDisplayedNotifications: jest.fn(async () => displayed),
      onForegroundEvent: jest.fn(() => () => {}),
      onBackgroundEvent: jest.fn(),
    },
    TriggerType: { TIMESTAMP: 0 },
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    AlarmType: { SET_ALARM_CLOCK: 1, SET_EXACT_AND_ALLOW_WHILE_IDLE: 2 },
    AndroidVisibility: { PUBLIC: 1 },
    EventType: { DELIVERED: 3 },
    __triggerCalls: triggerCalls,
    __cancelCalls: cancelCalls,
    __setDisplayed(list) { displayed = list; },
    __getDisplayed: () => displayed,
  };
});

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../logger', () => ({ log: jest.fn(), warn: jest.fn() }));

const notifeeMod = require('@notifee/react-native');
const notifee = notifeeMod.default;
const bell = require('../bell');

beforeEach(() => {
  notifee.createChannel.mockClear();
  notifee.createTriggerNotification.mockClear();
  notifee.cancelTriggerNotification.mockClear();
  notifee.cancelDisplayedNotification.mockClear();
  notifeeMod.__triggerCalls.length = 0;
  notifeeMod.__cancelCalls.length = 0;
  notifeeMod.__setDisplayed([]);
  bell._resetForTests();
});

describe('setupBellChannel', () => {
  test('creates HIGH-importance SILENT channel — sound is played by expo-av instead', async () => {
    await bell.setupBellChannel();
    expect(notifee.createChannel).toHaveBeenCalledTimes(1);
    const arg = notifee.createChannel.mock.calls[0][0];
    expect(arg).toMatchObject({
      id: bell.BELL_CHANNEL_ID,
      importance: 4, // HIGH
      vibration: true,
    });
    expect(arg.sound).toBeUndefined();
  });
});

describe('scheduleRestEndBell', () => {
  test('schedules with TIMESTAMP trigger + SET_ALARM_CLOCK to bypass Doze', async () => {
    const id = await bell.scheduleRestEndBell(45);
    expect(id).toMatch(/^rest-bell-/);
    expect(notifeeMod.__triggerCalls).toHaveLength(1);
    const { notif, trigger } = notifeeMod.__triggerCalls[0];
    expect(notif.android.channelId).toBe(bell.BELL_CHANNEL_ID);
    expect(notif.android.sound).toBeUndefined(); // silent — expo-av plays it
    expect(trigger.type).toBe(0); // TIMESTAMP
    expect(trigger.alarmManager).toEqual({
      allowWhileIdle: true,
      type: 1, // SET_ALARM_CLOCK
    });
    // Fires roughly 45s in the future
    expect(trigger.timestamp).toBeGreaterThan(Date.now());
    expect(trigger.timestamp).toBeLessThanOrEqual(Date.now() + 45_000 + 100);
  });

  test('tracks the scheduled id so it can be cancelled later', async () => {
    const id = await bell.scheduleRestEndBell(30);
    expect(bell._getPendingBellIds().has(id)).toBe(true);
  });
});

describe('cancelAllPendingBells', () => {
  test('cancels every pending id, not just the latest (fixes ghost-notif bug)', async () => {
    const id1 = await bell.scheduleRestEndBell(45);
    const id2 = await bell.scheduleRestEndBell(30);
    expect(bell._getPendingBellIds().size).toBe(2);

    await bell.cancelAllPendingBells();

    expect(notifeeMod.__cancelCalls.sort()).toEqual([id1, id2].sort());
    expect(bell._getPendingBellIds().size).toBe(0);
  });

  test('no-op when nothing pending', async () => {
    await bell.cancelAllPendingBells();
    expect(notifee.cancelTriggerNotification).not.toHaveBeenCalled();
  });
});

describe('isBellInDrawer / dismissBellFromDrawer', () => {
  test('isBellInDrawer detects our channel only', async () => {
    notifeeMod.__setDisplayed([
      { id: 'other', notification: { android: { channelId: 'session-widget' } } },
    ]);
    expect(await bell.isBellInDrawer()).toBe(false);
    notifeeMod.__setDisplayed([
      { id: 'other', notification: { android: { channelId: 'session-widget' } } },
      { id: 'rest-bell-x', notification: { android: { channelId: bell.BELL_CHANNEL_ID } } },
    ]);
    expect(await bell.isBellInDrawer()).toBe(true);
  });

  test('dismissBellFromDrawer cancels only our channel entries', async () => {
    notifeeMod.__setDisplayed([
      { id: 'widget', notification: { android: { channelId: 'session-widget' } } },
      { id: 'rest-bell-x', notification: { android: { channelId: bell.BELL_CHANNEL_ID } } },
      { id: 'rest-bell-y', notification: { android: { channelId: bell.BELL_CHANNEL_ID } } },
    ]);
    await bell.dismissBellFromDrawer();
    expect(notifee.cancelDisplayedNotification).toHaveBeenCalledTimes(2);
    expect(notifee.cancelDisplayedNotification).toHaveBeenCalledWith('rest-bell-x');
    expect(notifee.cancelDisplayedNotification).toHaveBeenCalledWith('rest-bell-y');
    expect(notifee.cancelDisplayedNotification).not.toHaveBeenCalledWith('widget');
  });
});

describe('markBellFired / isOurBellId', () => {
  test('markBellFired drops the id from the pending set', async () => {
    const id = await bell.scheduleRestEndBell(45);
    expect(bell._getPendingBellIds().has(id)).toBe(true);
    bell.markBellFired(id);
    expect(bell._getPendingBellIds().has(id)).toBe(false);
  });

  test('isOurBellId recognises our prefix', () => {
    expect(bell.isOurBellId('rest-bell-1234')).toBe(true);
    expect(bell.isOurBellId('gymos-session')).toBe(false);
    expect(bell.isOurBellId(null)).toBe(false);
  });
});
