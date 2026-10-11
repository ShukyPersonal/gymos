// On launch, log why the previous process died (from Android's historical
// exit records), deduped via a last-seen timestamp so each death is logged
// exactly once.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRecentExitReasons } from '../modules/exit-info';
import { log as glog } from './logger';

const LAST_SEEN_KEY = 'gymos_last_exit_seen';

export async function logPreviousExits() {
  try {
    const exits = getRecentExitReasons(5);
    if (!exits.length) return;
    const seenRaw = await AsyncStorage.getItem(LAST_SEEN_KEY);
    const lastSeen = seenRaw ? parseInt(seenRaw, 10) : 0;
    const fresh = exits.filter(e => e.timestamp > lastSeen);
    for (const e of fresh) {
      glog('exit-info', e.reason, {
        at: new Date(e.timestamp).toISOString(),
        description: String(e.description || '').slice(0, 300),
        importance: e.importance,
        status: e.status,
      });
    }
    if (fresh.length) {
      const newest = Math.max(...fresh.map(e => e.timestamp));
      await AsyncStorage.setItem(LAST_SEEN_KEY, String(newest));
    }
  } catch (e) {
    glog('exit-info', 'read error', String(e));
  }
}
