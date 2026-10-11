// In-app bell playback via expo-av — used in foreground to play the bell
// AND duck other media (Spotify/YT Music) while it rings.
//
// Background bell playback no longer goes through here. Notifee handles the
// background path via setAlarmClock + channel sound. See src/bell.js.
//
// Earlier revisions tried a "silent audio hold" trick to keep JS alive in
// the background. That doesn't work on Android: expo-av has only DoNotMix
// and DuckOthers — there's no MixWithOthers equivalent — so any silent
// hold would either pause or duck Spotify for the entire rest period.
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { log as glog } from './logger';

export const BELL_MAX_MS = 3000;

export const PASSIVE_MODE = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
  interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
  shouldDuckAndroid: false,
  interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  playThroughEarpieceAndroid: false,
};

export const BELL_DUCK_MODE = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: true,
  interruptionModeIOS: InterruptionModeIOS.DuckOthers,
  shouldDuckAndroid: true,
  interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  playThroughEarpieceAndroid: false,
};

// decideRestEndAction:
//   alreadyRang: did notifee already deliver the bell while JS was suspended?
//   appActive:   is the app foregrounded right now?
// → 'suppress' | 'in-app' | 'defer'
//   suppress = OS already rang it, just clear the drawer
//   in-app   = play via expo-av (ducks Spotify), cancel the pending notif
//   defer    = backgrounded with no fire-yet — let notifee fire it
export function decideRestEndAction(alreadyRang, appActive) {
  if (alreadyRang) return 'suppress';
  if (appActive) return 'in-app';
  return 'defer';
}

let bellSoundRef = null;
let bellStopTimer = null;
let bellCleaned = true;
let focusAcquiredAt = 0;

export function _resetStateForTests() {
  bellSoundRef = null;
  bellStopTimer = null;
  bellCleaned = true;
}
export function _isPlayingBell() { return bellSoundRef !== null; }

export async function playBell(bellAsset) {
  // Idempotent: if a bell is already playing, a second concurrent call is a
  // no-op. Protects against the race where a JS tick and a notifee delivery
  // event both try to play in the same window.
  if (!bellCleaned || bellSoundRef !== null) {
    glog('play-bell', 'already playing, skip duplicate');
    return;
  }
  bellCleaned = false;
  try {
    await Audio.setAudioModeAsync(BELL_DUCK_MODE);
    focusAcquiredAt = Date.now();
    glog('play-bell', 'audio mode set', { mode: 'BELL_DUCK' });
    const t0 = Date.now();
    const { sound } = await Audio.Sound.createAsync(
      bellAsset,
      { volume: 0.6, shouldPlay: true }
    );
    bellSoundRef = sound;
    glog('play-bell', 'sound created+playing', { load_ms: Date.now() - t0 });

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status && status.didJustFinish) cleanupBell('didJustFinish');
    });
    bellStopTimer = setTimeout(() => cleanupBell('3s-cap'), BELL_MAX_MS);
  } catch (e) {
    glog('play-bell', 'error', String(e));
    await resetToPassive();
  }
}

async function cleanupBell(reason) {
  if (bellCleaned) return;
  bellCleaned = true;
  // focus_held_ms: if the process dies holding focus, other players (YT
  // Music) can be left paused with no resume signal — this timestamps the
  // window so a post-mortem can tell whether we died mid-hold.
  glog('play-bell', 'cleanup', {
    reason,
    focus_held_ms: focusAcquiredAt ? Date.now() - focusAcquiredAt : null,
  });
  if (bellStopTimer) { clearTimeout(bellStopTimer); bellStopTimer = null; }
  const s = bellSoundRef;
  bellSoundRef = null;
  if (s) {
    try { await s.stopAsync(); } catch (_) {}
    try { await s.unloadAsync(); } catch (_) {}
  }
  await resetToPassive();
}

export async function resetToPassive() {
  try {
    await Audio.setAudioModeAsync(PASSIVE_MODE);
    glog('audio', 'reset to passive (focus released)');
  } catch (e) {
    glog('audio', 'reset error', String(e));
  }
}
