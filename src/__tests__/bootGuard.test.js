// Regression guard for the 2026-07-30 incident: a bad OTA hung the app on
// "Loading…" and only a manual rollback recovered it. These tests pin the
// self-recovery contract.
const store = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async k => (k in store ? store[k] : null)),
  setItem: jest.fn(async (k, v) => { store[k] = v; }),
  removeItem: jest.fn(async k => { delete store[k]; }),
}));
jest.mock('expo-updates', () => ({
  updateId: 'bad-bundle',
  reloadAsync: jest.fn(async () => {}),
  clearUpdateCacheExperimentalAsync: jest.fn(async () => {}),
}));
jest.mock('../logger', () => ({ log: jest.fn() }));

const Updates = require('expo-updates');
const guard = require('../bootGuard');

beforeEach(async () => {
  for (const k of Object.keys(store)) delete store[k];
  Updates.reloadAsync.mockClear();
});

describe('bootGuard', () => {
  test('a successful boot keeps the failure count at zero', async () => {
    for (let i = 0; i < 5; i++) {
      const { shouldRollback } = await guard.markBootStarted('good');
      expect(shouldRollback).toBe(false);
      await guard.markBootSucceeded('good');
    }
  });

  test('rolls back only after MAX_FAILED_BOOTS starts with no success', async () => {
    let r;
    for (let i = 1; i < guard.MAX_FAILED_BOOTS; i++) {
      r = await guard.markBootStarted('bad-bundle');
      expect(r.shouldRollback).toBe(false); // still giving it a chance
    }
    r = await guard.markBootStarted('bad-bundle');
    expect(r.shouldRollback).toBe(true);
    expect(r.failedBoots).toBe(guard.MAX_FAILED_BOOTS);
  });

  test('a new bundle resets the count (does not inherit the old one’s failures)', async () => {
    await guard.markBootStarted('bad-bundle');
    await guard.markBootStarted('bad-bundle');
    const r = await guard.markBootStarted('fixed-bundle');
    expect(r.failedBoots).toBe(1);
    expect(r.shouldRollback).toBe(false);
  });

  test('an intermittent failure does not trigger rollback', async () => {
    await guard.markBootStarted('flaky');          // fail
    await guard.markBootStarted('flaky');          // fail
    await guard.markBootSucceeded('flaky');        // recovers
    const r = await guard.markBootStarted('flaky');
    expect(r.shouldRollback).toBe(false);
  });

  test('rollbackToEmbedded reloads and clears the counter', async () => {
    await guard.markBootStarted('bad-bundle');
    const ok = await guard.rollbackToEmbedded();
    expect(ok).toBe(true);
    expect(Updates.reloadAsync).toHaveBeenCalled();
    const after = await guard.markBootStarted('embedded');
    expect(after.failedBoots).toBe(1); // fresh start on embedded
  });

  test('survives unreadable storage without throwing', async () => {
    const AS = require('@react-native-async-storage/async-storage');
    AS.getItem.mockRejectedValueOnce(new Error('disk'));
    await expect(guard.markBootStarted('x')).resolves.toBeDefined();
  });
});
