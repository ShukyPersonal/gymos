// Tagged session logger with persistence.
//
// On every log call we:
//   1. console.log (so `adb logcat | grep gymos` still works while connected)
//   2. push into an in-memory buffer for the current session
//   3. schedule a debounced write to AsyncStorage
//
// We keep the last MAX_SESSIONS sessions worth of logs persisted, so the user can
// share them with us after-the-fact when something looks wrong.

import AsyncStorage from '@react-native-async-storage/async-storage';

// Kills happen while backgrounded — flush the buffer immediately on
// backgrounding so the pre-death state always reaches AsyncStorage instead
// of dying in the 2s debounce window.
try {
  const { AppState } = require('react-native');
  AppState?.addEventListener?.('change', st => {
    if (st === 'background') flushNow();
  });
} catch (_) {}

export function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!currentSessionId) return;
  lastFlushPromise = lastFlushPromise.then(() => flushCurrent());
}

const STORAGE_KEY = 'gymos_session_logs';
// Crash-heavy workouts spawn a new log session per process restart — keep
// enough that recovery still finds them all.
const MAX_SESSIONS = 10;
const FLUSH_DEBOUNCE_MS = 2000;

let inMemoryEntries = [];
let currentSessionId = null;
let flushTimer = null;
let lastFlushPromise = Promise.resolve();

function timestamp() {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0') + '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

function scheduleFlush() {
  if (flushTimer || !currentSessionId) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    lastFlushPromise = lastFlushPromise.then(() => flushCurrent());
  }, FLUSH_DEBOUNCE_MS);
}

async function flushCurrent() {
  if (!currentSessionId) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    let sessions = raw ? JSON.parse(raw) : [];
    const idx = sessions.findIndex(s => s.id === currentSessionId);
    const session = {
      id: currentSessionId,
      startedAt: new Date(parseInt(currentSessionId, 10)).toISOString(),
      endedAt: new Date().toISOString(),
      entries: [...inMemoryEntries],
    };
    if (idx >= 0) sessions[idx] = session;
    else sessions.push(session);
    while (sessions.length > MAX_SESSIONS) sessions.shift();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (_) {}
}

export async function startLogSession() {
  // Force-finalize any session left dangling (e.g. previous crash)
  if (currentSessionId && inMemoryEntries.length > 0) {
    await flushCurrent();
  }
  currentSessionId = String(Date.now());
  // NOTE: we DON'T clear inMemoryEntries here. Pre-session entries (init events
  // like channel-setup readbacks) get carried into the new session as a prefix,
  // so they're visible in the persisted logs.
  log('logger', 'log session started', { id: currentSessionId, pre_session_entries: inMemoryEntries.length });
}

export const LOGS_WEBHOOK = process.env.EXPO_PUBLIC_LOGS_WEBHOOK || '';

async function syncSessionToSheets(session) {
  if (!LOGS_WEBHOOK) return false;
  try {
    const res = await fetch(LOGS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        sessionStart: session.startedAt,
        sessionEnd: session.endedAt,
        entries: session.entries,
      }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// Upload persisted sessions that never reached the Sheet because the app
// crashed/ANR'd before endLogSession could run. A cleanly-ended session
// always contains a final 'log session ended' entry — sessions without it
// are dangling. Call on app launch (fire-and-forget).
export async function syncDanglingSessions() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { uploaded: 0 };
    const sessions = JSON.parse(raw);
    let uploaded = 0;
    for (const s of sessions) {
      if (s.id === currentSessionId) continue;
      if (s.recoverySynced) continue;
      const endedCleanly = s.entries?.some(
        e => e.tag === 'logger' && e.message === 'log session ended'
      );
      if (endedCleanly) {
        // Already uploaded by endLogSession — just mark so we skip it next time
        s.recoverySynced = true;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        continue;
      }
      const lastEntry = s.entries?.[s.entries.length - 1];
      log('exit-info', 'prev process last seen', {
        sessionId: s.id,
        lastEntryTs: lastEntry?.ts,
        lastEntryTag: lastEntry?.tag,
      });
      const ok = await syncSessionToSheets({ ...s, recovered: true });
      if (ok) {
        s.recoverySynced = true;
        uploaded++;
        // Persist the mark IMMEDIATELY — an app reload mid-loop (e.g. an OTA
        // applying) must not forget which sessions were already uploaded, or
        // the next launch re-uploads them as duplicates.
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      }
    }
    if (uploaded) log('logger', 'recovered dangling sessions to sheet', { uploaded });
    return { uploaded };
  } catch (e) {
    log('logger', 'syncDanglingSessions error', String(e));
    return { uploaded: 0 };
  }
}

// Launch-time diagnostics (exit reasons, context stamp) are collected before
// any workout starts — and without an active log session they'd never be
// persisted or uploaded (scheduleFlush no-ops with no session id). Upload
// them directly so opening the app is enough to surface them.
// Entries are NOT cleared: they still carry into the first workout session.
export async function flushLaunchDiagnostics() {
  if (currentSessionId) return { uploaded: false, reason: 'session_active' };
  if (inMemoryEntries.length === 0) return { uploaded: false, reason: 'empty' };
  const now = new Date().toISOString();
  const ok = await syncSessionToSheets({
    id: 'launch-' + Date.now(),
    startedAt: now,
    endedAt: now,
    entries: [...inMemoryEntries],
  });
  return { uploaded: ok, entries: inMemoryEntries.length };
}

export async function endLogSession() {
  if (!currentSessionId) return;
  log('logger', 'log session ended');
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await flushCurrent();
  const sessionData = {
    id: currentSessionId,
    startedAt: new Date(parseInt(currentSessionId, 10)).toISOString(),
    endedAt: new Date().toISOString(),
    entries: [...inMemoryEntries],
  };
  currentSessionId = null;
  inMemoryEntries = [];
  // Fire-and-forget upload to logs sheet
  syncSessionToSheets(sessionData);
}

export function log(tag, message, data) {
  const entry = { ts: timestamp(), tag, message };
  if (data !== undefined) entry.data = data;
  inMemoryEntries.push(entry);
  // eslint-disable-next-line no-console
  console.log(`[gymos:${tag}][${entry.ts}]`, message, data ?? '');
  scheduleFlush();
}

export function warn(tag, ...args) { log(tag, args.join(' ')); }

export async function getAllLogSessions() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearAllLogs() {
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

// Format all sessions as a single text blob for sharing
export async function formatLogsForShare() {
  const sessions = await getAllLogSessions();
  if (sessions.length === 0) return 'No log sessions stored.';
  return sessions.map(s => {
    const header = `=== Session ${s.startedAt} → ${s.endedAt} (${s.entries.length} entries) ===`;
    const lines = s.entries.map(e => {
      const dataStr = e.data !== undefined ? ' ' + JSON.stringify(e.data) : '';
      return `[${e.ts}][${e.tag}] ${e.message}${dataStr}`;
    });
    return [header, ...lines].join('\n');
  }).join('\n\n');
}
