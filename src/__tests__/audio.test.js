// Unit tests for the in-app bell-playback module. Background scheduling now
// lives in src/bell.js (notifee) — see bell.test.js. This file only covers
// the foreground expo-av path.
jest.mock('expo-av', () => {
  const InterruptionModeIOS = { MixWithOthers: 0, DoNotMix: 1, DuckOthers: 2 };
  const InterruptionModeAndroid = { DoNotMix: 1, DuckOthers: 2 };
  const createdSounds = [];
  const Sound = {
    createAsync: jest.fn(async () => {
      const sound = {
        statusCb: null,
        stopAsync: jest.fn(async () => {}),
        unloadAsync: jest.fn(async () => {}),
        setOnPlaybackStatusUpdate(cb) { this.statusCb = cb; },
        _fireFinished() { this.statusCb && this.statusCb({ didJustFinish: true }); },
      };
      createdSounds.push(sound);
      return { sound };
    }),
  };
  return {
    Audio: { setAudioModeAsync: jest.fn(async () => {}), Sound },
    InterruptionModeIOS, InterruptionModeAndroid,
    __createdSounds: createdSounds,
  };
});

jest.mock('../logger', () => ({ log: jest.fn(), warn: jest.fn() }));

const { Audio, __createdSounds } = require('expo-av');
const audio = require('../audio');

beforeEach(() => {
  jest.useFakeTimers();
  Audio.setAudioModeAsync.mockClear();
  Audio.Sound.createAsync.mockClear();
  __createdSounds.length = 0;
  audio._resetStateForTests();
});
afterEach(() => { jest.useRealTimers(); });

describe('decideRestEndAction', () => {
  test('suppress when notifee already rang', () => {
    expect(audio.decideRestEndAction(true, true)).toBe('suppress');
    expect(audio.decideRestEndAction(true, false)).toBe('suppress');
  });
  test('in-app when foreground and not yet rang', () => {
    expect(audio.decideRestEndAction(false, true)).toBe('in-app');
  });
  test('defer when backgrounded and not yet rang', () => {
    expect(audio.decideRestEndAction(false, false)).toBe('defer');
  });
});

describe('audio modes', () => {
  test('PASSIVE_MODE releases focus on Android', () => {
    expect(audio.PASSIVE_MODE).toMatchObject({
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      interruptionModeAndroid: 1, // DoNotMix
    });
  });
  test('BELL_DUCK_MODE requests transient ducking', () => {
    expect(audio.BELL_DUCK_MODE).toMatchObject({
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: 2, // DuckOthers
    });
  });
});

describe('playBell', () => {
  test('sets BELL_DUCK_MODE, then plays the bell', async () => {
    await audio.playBell('bell-asset');
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith(audio.BELL_DUCK_MODE);
    expect(Audio.Sound.createAsync).toHaveBeenCalledWith(
      'bell-asset', { volume: 0.6, shouldPlay: true }
    );
    expect(audio._isPlayingBell()).toBe(true);
  });

  test('didJustFinish triggers cleanup and resets to passive mode', async () => {
    await audio.playBell('bell-asset');
    const bell = __createdSounds[0];
    bell._fireFinished();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(bell.stopAsync).toHaveBeenCalled();
    expect(bell.unloadAsync).toHaveBeenCalled();
    expect(audio._isPlayingBell()).toBe(false);
    expect(Audio.setAudioModeAsync).toHaveBeenLastCalledWith(audio.PASSIVE_MODE);
  });

  test('3s cap forces cleanup even if didJustFinish never fires', async () => {
    await audio.playBell('bell-asset');
    const bell = __createdSounds[0];
    jest.advanceTimersByTime(audio.BELL_MAX_MS);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(bell.stopAsync).toHaveBeenCalled();
    expect(audio._isPlayingBell()).toBe(false);
    expect(Audio.setAudioModeAsync).toHaveBeenLastCalledWith(audio.PASSIVE_MODE);
  });

  test('didJustFinish and 3s cap together only clean up once', async () => {
    await audio.playBell('bell-asset');
    const bell = __createdSounds[0];
    bell._fireFinished();
    await Promise.resolve();
    jest.advanceTimersByTime(audio.BELL_MAX_MS);
    await Promise.resolve(); await Promise.resolve();
    expect(bell.stopAsync).toHaveBeenCalledTimes(1);
    expect(bell.unloadAsync).toHaveBeenCalledTimes(1);
  });

  test('concurrent playBell call is a no-op (idempotent) — protects against tick + notifee race', async () => {
    await audio.playBell('bell-asset');
    expect(audio._isPlayingBell()).toBe(true);
    const createCalls = Audio.Sound.createAsync.mock.calls.length;

    // Second call while first is still in flight should not create a new sound
    await audio.playBell('bell-asset');
    expect(Audio.Sound.createAsync.mock.calls.length).toBe(createCalls);

    // Finish the first bell — clean state for next test
    __createdSounds[0]._fireFinished();
    await Promise.resolve(); await Promise.resolve();
  });

  test('three back-to-back bells each leave audio mode passive', async () => {
    for (let i = 0; i < 3; i++) {
      await audio.playBell('bell-asset');
      const bell = __createdSounds[__createdSounds.length - 1];
      bell._fireFinished();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    expect(audio._isPlayingBell()).toBe(false);
    expect(Audio.setAudioModeAsync).toHaveBeenLastCalledWith(audio.PASSIVE_MODE);
  });
});

describe('resetToPassive', () => {
  test('requests PASSIVE_MODE', async () => {
    await audio.resetToPassive();
    expect(Audio.setAudioModeAsync).toHaveBeenLastCalledWith(audio.PASSIVE_MODE);
  });
});
