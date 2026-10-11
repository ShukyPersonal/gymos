import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'gym_history';
const STATE_KEY = 'gym_state';
const SYNCED_KEY = 'gym_synced_dates';
const LAST_SYNC_KEY = 'gym_last_sync';

export const RETRY_BACKOFF_MS = 1500;
export const SHEETS_WEBHOOK = process.env.EXPO_PUBLIC_SHEETS_WEBHOOK || '';

export async function loadHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveHistory(history) {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export async function loadState() {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveState(state) {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export async function clearState() {
  await AsyncStorage.removeItem(STATE_KEY);
}

export async function finishSession(state) {
  const history = await loadHistory();
  const duration_min = Math.round((Date.now() - new Date(state.started_at).getTime()) / 60000);
  const session = { date: state.started_at, day: state.day ?? null, duration_min, sets: state.sets };
  history.push(session);
  await saveHistory(history);
  await clearState();
  return session;
}

// One-shot restore from Sheets when local history is empty (e.g. after a
// reinstall — AsyncStorage is wiped on uninstall). Pulls the Workouts tab
// via the same Apps Script webhook (doGet handler), groups by date, and
// marks the restored sessions as already-synced so they're not re-uploaded.
// The Apps Script backing this is slow to cold-start (10-45s observed) and
// intermittently 404s while waking. Retry rather than giving up — a failed
// restore on a fresh install silently loses the whole training history.
export async function fetchHistoryFromSheets(attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(SHEETS_WEBHOOK, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        if (data && data.status === 'ok') {
          return Array.isArray(data.sessions) ? data.sessions : [];
        }
      }
    } catch (_) {}
    if (i < attempts - 1) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS * (i + 1)));
  }
  return null;
}

// Merge missing sessions from Sheets into local history. Compares by day
// (YYYY-MM-DD) since the local timestamp is exact-second but the restored
// timestamp is normalized to noon UTC. Idempotent — safe to run on every
// launch.
function dayKey(isoDate) {
  return new Date(isoDate).toISOString().slice(0, 10);
}

export async function restoreHistoryIfEmpty() {
  const local = await loadHistory();
  const remote = await fetchHistoryFromSheets();
  if (remote == null) return { restored: 0, reason: 'fetch_failed', local: local.length };
  if (remote.length === 0) return { restored: 0, reason: 'no_remote', local: local.length };

  const localDays = new Set(local.map(s => dayKey(s.date)));
  const missing = remote.filter(s => !localDays.has(dayKey(s.date)));

  if (missing.length === 0) {
    return { restored: 0, reason: 'in_sync', local: local.length, remote: remote.length };
  }

  const merged = [...missing, ...local].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  await saveHistory(merged);

  // Treat the restored sessions as already-synced so syncToSheets doesn't
  // try to re-upload them as duplicates. Preserve any existing synced dates.
  const existingSyncedRaw = await AsyncStorage.getItem(SYNCED_KEY);
  const syncedSet = new Set(existingSyncedRaw ? JSON.parse(existingSyncedRaw) : []);
  for (const s of missing) syncedSet.add(s.date);
  await AsyncStorage.setItem(SYNCED_KEY, JSON.stringify([...syncedSet]));

  return { restored: missing.length, reason: 'merged', local: merged.length };
}

export async function loadLastSyncTime() {
  try {
    const raw = await AsyncStorage.getItem(LAST_SYNC_KEY);
    return raw ? new Date(raw) : null;
  } catch {
    return null;
  }
}

export async function syncToSheets(history) {
  const syncedRaw = await AsyncStorage.getItem(SYNCED_KEY);
  const synced = syncedRaw ? JSON.parse(syncedRaw) : [];

  const newSessions = history.filter(s => !synced.includes(s.date));
  if (newSessions.length === 0) return { status: 'already_synced' };

  const rows = [];
  for (const session of newSessions) {
    const date = new Date(session.date).toLocaleDateString('en-GB');
    for (const set of session.sets) {
      rows.push([
        date,
        set.exercise_id,
        set.set_num,
        set.weight ?? '',
        set.reps ?? '',
        set.target_reps ?? '',
        set.reps >= set.target_reps ? 'Yes' : 'No',
        set.skipped ? 'Yes' : 'No',
        // Column I: training day. The Apps Script appends rows as given and
        // doGet only reads columns A–H, so no script change is needed.
        session.day ?? '',
      ]);
    }
  }

  const response = await fetch(SHEETS_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const newSynced = [...synced, ...newSessions.map(s => s.date)];
  await AsyncStorage.setItem(SYNCED_KEY, JSON.stringify(newSynced));
  await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  return { status: 'ok', count: newSessions.length };
}
