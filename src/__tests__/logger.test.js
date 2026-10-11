// Tests for crash-recovery upload of dangling log sessions.
const asyncStore = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k) => (k in asyncStore ? asyncStore[k] : null)),
  setItem: jest.fn(async (k, v) => { asyncStore[k] = v; }),
  removeItem: jest.fn(async (k) => { delete asyncStore[k]; }),
}));

global.fetch = jest.fn();

const logger = require('../logger');
const KEY = 'gymos_session_logs';

const cleanSession = {
  id: '111',
  startedAt: '2026-07-23T05:39:00Z',
  endedAt: '2026-07-23T06:16:00Z',
  entries: [
    { ts: '08:39:00', tag: 'session', message: 'startSession' },
    { ts: '09:16:00', tag: 'logger', message: 'log session ended' },
  ],
};

const crashedSession = {
  id: '222',
  startedAt: '2026-07-26T11:30:00Z',
  endedAt: '2026-07-26T11:58:00Z',
  entries: [
    { ts: '14:30:00', tag: 'session', message: 'startSession' },
    { ts: '14:57:00', tag: 'rest-start', message: 'rest period started' },
    // no 'log session ended' — app crashed
  ],
};

beforeEach(() => {
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
  global.fetch.mockReset();
  global.fetch.mockResolvedValue({ ok: true });
});

describe('syncDanglingSessions', () => {
  test('uploads only sessions without a clean end marker', async () => {
    asyncStore[KEY] = JSON.stringify([cleanSession, crashedSession]);
    const r = await logger.syncDanglingSessions();
    expect(r.uploaded).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sessionId).toBe('222');
  });

  test('marks uploaded + clean sessions so a second run is a no-op', async () => {
    asyncStore[KEY] = JSON.stringify([cleanSession, crashedSession]);
    await logger.syncDanglingSessions();
    global.fetch.mockClear();
    const r2 = await logger.syncDanglingSessions();
    expect(r2.uploaded).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('failed upload is retried on next run (not marked synced)', async () => {
    asyncStore[KEY] = JSON.stringify([crashedSession]);
    global.fetch.mockResolvedValueOnce({ ok: false });
    const r1 = await logger.syncDanglingSessions();
    expect(r1.uploaded).toBe(0);

    global.fetch.mockResolvedValueOnce({ ok: true });
    const r2 = await logger.syncDanglingSessions();
    expect(r2.uploaded).toBe(1);
  });

  test('no persisted sessions → no-op', async () => {
    const r = await logger.syncDanglingSessions();
    expect(r.uploaded).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('flushLaunchDiagnostics', () => {
  test('uploads launch-time entries when no workout session is active', async () => {
    logger.log('exit-info', 'ANR', { at: '2026-07-28T05:47:00Z' });
    logger.log('init', 'context', { os: 36 });

    const r = await logger.flushLaunchDiagnostics();
    expect(r.uploaded).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sessionId).toMatch(/^launch-/);
    expect(body.entries.some(e => e.tag === 'exit-info')).toBe(true);
    expect(body.entries.some(e => e.tag === 'init')).toBe(true);
  });

  test('entries are preserved so they still prefix the first workout session', async () => {
    logger.log('exit-info', 'ANR');
    await logger.flushLaunchDiagnostics();
    global.fetch.mockClear();

    await logger.startLogSession();
    await logger.endLogSession();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.entries.some(e => e.tag === 'exit-info')).toBe(true);
  });

  test('no-op when a workout session is already active', async () => {
    await logger.startLogSession();
    global.fetch.mockClear();
    const r = await logger.flushLaunchDiagnostics();
    expect(r).toEqual({ uploaded: false, reason: 'session_active' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
