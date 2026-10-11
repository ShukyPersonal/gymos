// Tests for picking Day A/B. The schedule is lifting Monday + Thursday with a
// surf class on Friday: the legs-first day must land on Thursday.
const td = require('../trainingDay');

// September 2026: the 14th is a Monday.
const at = (day, hour = 8) => new Date(2026, 8, day, hour, 0, 0);
const session = (day, extra = {}) => ({ date: at(day).toISOString(), duration_min: 40, sets: [], ...extra });
const set = (exercise_id, weight, reps, skipped = false) => ({ exercise_id, weight, reps, skipped });

describe('weekStart', () => {
  test('weeks start on Monday at local midnight', () => {
    const monday = new Date(2026, 8, 14).getTime();
    expect(td.weekStart(at(14)).getTime()).toBe(monday);
    expect(td.weekStart(at(17)).getTime()).toBe(monday);
    expect(td.weekStart(at(20, 23)).getTime()).toBe(monday);
    expect(td.weekStart(at(21, 0)).getTime()).toBe(new Date(2026, 8, 21).getTime());
  });
});

describe('defaultDayForDate', () => {
  test('Monday to Wednesday is Day A, Thursday to Sunday is Day B', () => {
    expect([14, 15, 16].map(d => td.defaultDayForDate(at(d)))).toEqual(['A', 'A', 'A']);
    expect([17, 18, 19, 20].map(d => td.defaultDayForDate(at(d)))).toEqual(['B', 'B', 'B', 'B']);
  });
});

describe('pickTrainingDay', () => {
  test('the first workout of the week follows the weekday', () => {
    expect(td.pickTrainingDay([], at(14))).toBe('A');
    expect(td.pickTrainingDay([], at(17))).toBe('B');
  });

  test('Monday Day A, then Thursday is Day B', () => {
    expect(td.pickTrainingDay([session(14, { day: 'A' })], at(17))).toBe('B');
  });

  test('a skipped Monday still gives Day B on Thursday', () => {
    expect(td.pickTrainingDay([session(10, { day: 'B' })], at(17))).toBe('B');
  });

  test("last week's sessions don't count", () => {
    expect(td.pickTrainingDay([session(13, { day: 'B' })], at(14))).toBe('A');
  });

  test('a second workout in the same week gets the other day', () => {
    expect(td.pickTrainingDay([session(14, { day: 'A' })], at(16))).toBe('B');
    expect(td.pickTrainingDay([session(17, { day: 'B' })], at(20))).toBe('A');
  });

  test('a day chosen with the switch counts as the day trained', () => {
    expect(td.pickTrainingDay([session(14, { day: 'B' })], at(17))).toBe('A');
  });

  test('sessions from before Day A/B infer their day from the weekday', () => {
    expect(td.pickTrainingDay([session(14)], at(17))).toBe('B');
  });
});

describe('lastValuesForDay', () => {
  const history = [
    session(7, { sets: [set('incline_bench_press', 28, 10), set('walking_lunges', 10, 14)] }),
    session(14, { day: 'A', sets: [set('incline_bench_press', 30, 8)] }),
    session(17, { day: 'B', sets: [set('incline_bench_press', 26, 9), set('incline_bench_press', 26, 8)] }),
  ];

  test("uses the day's own most recent set", () => {
    expect(td.lastValuesForDay(history, 'A').incline_bench_press).toEqual({ weight: 30, reps: 8 });
    expect(td.lastValuesForDay(history, 'B').incline_bench_press).toEqual({ weight: 26, reps: 8 });
  });

  test("falls back to any session for exercises the day hasn't logged", () => {
    expect(td.lastValuesForDay(history, 'B').walking_lunges).toEqual({ weight: 10, reps: 14 });
  });

  test('ignores skipped sets', () => {
    const h = [session(14, { day: 'A', sets: [set('hammer_curls', 16, 10), set('hammer_curls', null, null, true)] })];
    expect(td.lastValuesForDay(h, 'A').hammer_curls).toEqual({ weight: 16, reps: 10 });
  });
});

describe('historyForDay', () => {
  const a = session(14, { day: 'A', sets: [set('assisted_pullups', 14, 10)] });
  const b = session(17, { day: 'B', sets: [set('walking_lunges', 10, 14)] });

  test("the day's own sessions once it has logged the exercise", () => {
    expect(td.historyForDay([a, b], 'B', 'walking_lunges')).toEqual([b]);
  });

  test('all sessions until then', () => {
    expect(td.historyForDay([a, b], 'B', 'assisted_pullups')).toEqual([a, b]);
  });
});
