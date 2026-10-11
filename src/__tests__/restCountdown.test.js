// The notification shows TWO countdowns: the big number in the title (ours)
// and the small chronometer beside "Gymos" (Android's). They must agree.
//
// Android's Chronometer truncates via integer division, so the app must FLOOR
// too — rounding made the title read one second ahead (reported 2026-08-22).
// The bell must also fire on the real deadline, not on the displayed second,
// or it rings early (every lateBy_ms in the logs was negative).

// Mirrors the computation in App.js's rest tick.
function displayedSeconds(remainingMs) {
  return Math.max(0, Math.floor(remainingMs / 1000));
}
function shouldFireBell(remainingMs) {
  return remainingMs <= 0;
}
// What Android's chronometer shows for the same instant.
function androidChronometer(remainingMs) {
  return Math.max(0, Math.trunc(remainingMs / 1000));
}

describe('title countdown matches Android chronometer', () => {
  test('agree across a full 45s rest, sampled every 100ms', () => {
    const mismatches = [];
    for (let ms = 45000; ms >= 0; ms -= 100) {
      if (displayedSeconds(ms) !== androidChronometer(ms)) mismatches.push(ms);
    }
    expect(mismatches).toEqual([]);
  });

  test('the old rounding behaviour WOULD have mismatched (guards the fix)', () => {
    const rounded = ms => Math.max(0, Math.round(ms / 1000));
    // 44.6s left: round → 45, Android → 44. This is the reported bug.
    expect(rounded(44600)).toBe(45);
    expect(androidChronometer(44600)).toBe(44);
    expect(displayedSeconds(44600)).toBe(44); // fixed
  });

  test('exact boundaries line up', () => {
    for (const s of [45, 30, 10, 5, 1]) {
      expect(displayedSeconds(s * 1000)).toBe(s);
      expect(androidChronometer(s * 1000)).toBe(s);
    }
  });

  test('never displays a negative number', () => {
    for (const ms of [-1, -500, -5000]) {
      expect(displayedSeconds(ms)).toBe(0);
    }
  });
});

describe('bell fires on the real deadline, not the displayed second', () => {
  test('does not fire while time remains, even under a second', () => {
    for (const ms of [1000, 500, 400, 100, 1]) {
      expect(shouldFireBell(ms)).toBe(false);
    }
  });

  test('fires at zero and after', () => {
    for (const ms of [0, -1, -250]) {
      expect(shouldFireBell(ms)).toBe(true);
    }
  });

  test('old behaviour fired early — regression guard', () => {
    // Previously: `Math.round(ms/1000) <= 0` was true at 400ms remaining,
    // ringing the bell 0.4s before the rest actually ended.
    const oldWouldFire = ms => Math.max(0, Math.round(ms / 1000)) <= 0;
    expect(oldWouldFire(400)).toBe(true);   // early — the bug
    expect(shouldFireBell(400)).toBe(false); // fixed
  });

  test('display reaching 0 does not by itself ring the bell', () => {
    // At 900ms remaining the title already reads 0, but the bell must wait.
    expect(displayedSeconds(900)).toBe(0);
    expect(shouldFireBell(900)).toBe(false);
  });
});
