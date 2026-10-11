// Tests for the Sheets-restore path used after a reinstall.
const asyncStore = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k) => (k in asyncStore ? asyncStore[k] : null)),
  setItem: jest.fn(async (k, v) => { asyncStore[k] = v; }),
  removeItem: jest.fn(async (k) => { delete asyncStore[k]; }),
}));

global.fetch = jest.fn();

const storage = require('../storage');

beforeEach(() => {
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
  global.fetch.mockReset();
});

const sampleSessions = [
  {
    date: '2026-06-25T12:00:00.000Z',
    duration_min: 0,
    sets: [{ exercise_id: 'incline_bench_press', set_num: 1, weight: 28, reps: 8, target_reps: 8, skipped: false }],
  },
  {
    date: '2026-06-27T12:00:00.000Z',
    duration_min: 0,
    sets: [{ exercise_id: 'lateral_raises', set_num: 1, weight: 10, reps: 12, target_reps: 12, skipped: false }],
  },
];

function mockFetchOk(body) {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => body });
}

describe('fetchHistoryFromSheets', () => {
  test('returns sessions array on a healthy response', async () => {
    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    const got = await storage.fetchHistoryFromSheets();
    expect(got).toEqual(sampleSessions);
  });

  test('returns null on HTTP error', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await storage.fetchHistoryFromSheets(1)).toBeNull();
  });

  test('returns null on non-ok status payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'error' }) });
    expect(await storage.fetchHistoryFromSheets(1)).toBeNull();
  });

  test('returns null on network throw', async () => {
    global.fetch.mockRejectedValue(new Error('network'));
    expect(await storage.fetchHistoryFromSheets(1)).toBeNull();
  });

  test('tolerates missing sessions field', async () => {
    mockFetchOk({ status: 'ok' });
    expect(await storage.fetchHistoryFromSheets()).toEqual([]);
  });
});

describe('restoreHistoryIfEmpty (merge)', () => {
  test('fresh install: pulls everything from Sheets', async () => {
    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    const r = await storage.restoreHistoryIfEmpty();
    expect(r).toEqual({ restored: 2, reason: 'merged', local: 2 });
    expect(JSON.parse(asyncStore['gym_history'])).toEqual(sampleSessions);
    expect(JSON.parse(asyncStore['gym_synced_dates']).sort()).toEqual([
      '2026-06-25T12:00:00.000Z',
      '2026-06-27T12:00:00.000Z',
    ]);
  });

  test('partial local: merges missing remote sessions by day', async () => {
    // Local already has 2026-06-27 (an exact-second ISO from a real workout)
    const localSession = {
      date: '2026-06-27T08:15:30.123Z',
      duration_min: 42,
      sets: [{ exercise_id: 'incline_bench_press', set_num: 1, weight: 28, reps: 8 }],
    };
    asyncStore['gym_history'] = JSON.stringify([localSession]);

    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    const r = await storage.restoreHistoryIfEmpty();

    // Only the 2026-06-25 session is missing; 2026-06-27 is matched by day
    expect(r).toEqual({ restored: 1, reason: 'merged', local: 2 });
    const merged = JSON.parse(asyncStore['gym_history']);
    expect(merged).toHaveLength(2);
    expect(merged[0].date).toBe('2026-06-25T12:00:00.000Z');
    // Local session preserved as-is (not overwritten by the remote 2026-06-27)
    expect(merged[1]).toEqual(localSession);
  });

  test('in sync: no-op when remote has nothing local doesn’t', async () => {
    asyncStore['gym_history'] = JSON.stringify([
      { date: '2026-06-25T08:00:00Z', sets: [] },
      { date: '2026-06-27T08:00:00Z', sets: [] },
    ]);
    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    const r = await storage.restoreHistoryIfEmpty();
    expect(r).toEqual({ restored: 0, reason: 'in_sync', local: 2, remote: 2 });
    // history unchanged
    expect(JSON.parse(asyncStore['gym_history'])).toHaveLength(2);
  });

  test('idempotent: running twice in a row is safe', async () => {
    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    const first = await storage.restoreHistoryIfEmpty();
    expect(first.restored).toBe(2);

    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    const second = await storage.restoreHistoryIfEmpty();
    expect(second).toEqual({ restored: 0, reason: 'in_sync', local: 2, remote: 2 });
  });

  test('preserves existing synced_dates rather than clobbering them', async () => {
    asyncStore['gym_synced_dates'] = JSON.stringify(['2026-06-27T08:15:30.123Z']);
    asyncStore['gym_history'] = JSON.stringify([
      { date: '2026-06-27T08:15:30.123Z', sets: [] },
    ]);
    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    await storage.restoreHistoryIfEmpty();
    const synced = JSON.parse(asyncStore['gym_synced_dates']);
    expect(synced).toContain('2026-06-27T08:15:30.123Z'); // existing preserved
    expect(synced).toContain('2026-06-25T12:00:00.000Z'); // new added
  });

  test('reports fetch_failed and leaves storage untouched', async () => {
    asyncStore['gym_history'] = JSON.stringify([{ date: '2026-06-27T08:00:00Z', sets: [] }]);
    global.fetch.mockRejectedValue(new Error('network'));
    const r = await storage.restoreHistoryIfEmpty();
    expect(r).toEqual({ restored: 0, reason: 'fetch_failed', local: 1 });
    expect(JSON.parse(asyncStore['gym_history'])).toHaveLength(1);
  });

  test('reports no_remote when Sheets is empty', async () => {
    mockFetchOk({ status: 'ok', sessions: [] });
    const r = await storage.restoreHistoryIfEmpty();
    expect(r).toEqual({ restored: 0, reason: 'no_remote', local: 0 });
  });

  test('merged sessions are not re-uploaded by syncToSheets', async () => {
    mockFetchOk({ status: 'ok', sessions: sampleSessions });
    await storage.restoreHistoryIfEmpty();
    const history = JSON.parse(asyncStore['gym_history']);
    const r = await storage.syncToSheets(history);
    expect(r).toEqual({ status: 'already_synced' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchHistoryFromSheets retries (Apps Script cold start)', () => {
  test('recovers when the first attempts fail', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok', sessions: sampleSessions }) });
    const got = await storage.fetchHistoryFromSheets(3);
    expect(got).toEqual(sampleSessions);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 20000);
});

describe('training day is saved and synced', () => {
  test('finishSession keeps the day on the history entry', async () => {
    const s = await storage.finishSession({ started_at: '2026-09-17T05:00:00.000Z', day: 'B', sets: [] });
    expect(s.day).toBe('B');
    expect(JSON.parse(asyncStore['gym_history'])[0].day).toBe('B');
  });

  test('a workout without a day stores null', async () => {
    const s = await storage.finishSession({ started_at: '2026-09-10T05:00:00.000Z', sets: [] });
    expect(s.day).toBeNull();
  });

  test('syncToSheets sends the day as a ninth column, blank when unknown', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    const set = { exercise_id: 'walking_lunges', set_num: 1, weight: 10, reps: 14, target_reps: 10, skipped: false };
    await storage.syncToSheets([
      { date: '2026-09-10T05:00:00.000Z', sets: [set] },
      { date: '2026-09-17T05:00:00.000Z', day: 'B', sets: [set] },
    ]);
    const { rows } = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(rows.map(r => r.length)).toEqual([9, 9]);
    expect(rows.map(r => r[8])).toEqual(['', 'B']);
  });
});
