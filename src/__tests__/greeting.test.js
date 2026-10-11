// Focused tests for the days-since-last-lift label. The old implementation
// used raw hour-delta + Math.floor, so a workout at yesterday 08:00 read as
// "already lifted today" when opened at today 07:00. Fix uses calendar-day
// diff (midnight-normalized), matching the streak-dot logic in HomeScreen.
const { daysSinceLastLiftLabel } = require('../greeting');

describe('daysSinceLastLiftLabel', () => {
  test('same calendar day (early morning open, workout just past midnight) → today', () => {
    const now = new Date('2026-07-20T07:00:00');
    const last = new Date('2026-07-20T00:30:00');
    expect(daysSinceLastLiftLabel(last, now)).toBe('You already lifted today.');
  });

  test('THE BUG: workout yesterday morning, opened today early morning → "1 day"', () => {
    const now = new Date('2026-07-20T07:00:00');   // today 7am
    const last = new Date('2026-07-19T08:00:00');  // yesterday 8am — <24h ago
    // Old code: Math.floor(23h / 24h) = 0 → "already lifted today" (WRONG)
    // New code: calendar-day diff = 1 → "1 day"
    expect(daysSinceLastLiftLabel(last, now)).toBe('It’s been 1 day since your last lift.');
  });

  test('two calendar days ago', () => {
    const now = new Date('2026-07-20T10:00:00');
    const last = new Date('2026-07-18T20:00:00');
    expect(daysSinceLastLiftLabel(last, now)).toBe('It’s been 2 days since your last lift.');
  });

  test('restored session dated noon UTC in the future (early-morning local open) → clamps to today', () => {
    // Restored sessions get date = 'YYYY-MM-DDT12:00:00.000Z' (noon UTC).
    // For an early-morning local open, that timestamp is in the future.
    const now = new Date('2026-07-20T05:00:00+03:00');
    const last = new Date('2026-07-20T12:00:00.000Z');
    expect(daysSinceLastLiftLabel(last, now)).toBe('You already lifted today.');
  });

  test('workout a week ago', () => {
    const now = new Date('2026-07-20T10:00:00');
    const last = new Date('2026-07-13T10:00:00');
    expect(daysSinceLastLiftLabel(last, now)).toBe('It’s been 7 days since your last lift.');
  });

  test('accepts ISO string input, not just Date', () => {
    const now = new Date('2026-07-20T10:00:00');
    expect(daysSinceLastLiftLabel('2026-07-19T08:00:00', now))
      .toBe('It’s been 1 day since your last lift.');
  });
});
