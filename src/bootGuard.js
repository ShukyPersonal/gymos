// Boot guard — self-recovery from a bad OTA bundle.
//
// On 2026-07-30 an OTA hung the app on "Loading…" for three days; recovery
// needed a manual rollback. This makes the app rescue itself:
//
//   markBootStarted()  — called at launch, BEFORE the risky startup work
//   markBootSucceeded() — called once a real screen renders
//
// If N launches start without any reaching a screen, the bundle is bad and
// we roll back to the embedded (APK) bundle, which is known-good by
// definition. Uses its own AsyncStorage key so it can't be corrupted by the
// app state it's protecting.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { log as glog } from './logger';

const KEY = 'gymos_boot_guard';
export const MAX_FAILED_BOOTS = 3;

async function read() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : { failedBoots: 0, updateId: null };
  } catch {
    return { failedBoots: 0, updateId: null };
  }
}

async function write(state) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
}

// Returns { shouldRollback, failedBoots }.
export async function markBootStarted(currentUpdateId) {
  const prev = await read();
  // A different bundle than the one that was failing → start its count fresh.
  const failedBoots = prev.updateId === currentUpdateId ? (prev.failedBoots || 0) + 1 : 1;
  await write({ failedBoots, updateId: currentUpdateId });
  const shouldRollback = failedBoots >= MAX_FAILED_BOOTS;
  glog('boot-guard', 'boot started', { attempt: failedBoots, updateId: currentUpdateId, shouldRollback });
  return { shouldRollback, failedBoots };
}

export async function markBootSucceeded(currentUpdateId) {
  const prev = await read();
  if (prev.failedBoots > 1) {
    glog('boot-guard', 'recovered after failed boots', { failedBoots: prev.failedBoots });
  }
  await write({ failedBoots: 0, updateId: currentUpdateId });
}

// Drop back to the bundle baked into the APK. Embedded is known-good, so this
// always yields a working app even if every OTA on the branch is broken.
export async function rollbackToEmbedded() {
  glog('boot-guard', 'ROLLING BACK to embedded bundle after repeated failed boots');
  try {
    await write({ failedBoots: 0, updateId: 'embedded' });
    if (typeof Updates.clearUpdateCacheExperimentalAsync === 'function') {
      await Updates.clearUpdateCacheExperimentalAsync();
    }
    await Updates.reloadAsync();
    return true;
  } catch (e) {
    glog('boot-guard', 'rollback failed', String(e));
    return false;
  }
}

export async function _resetForTests() {
  await AsyncStorage.removeItem(KEY);
}
