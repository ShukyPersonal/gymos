// Day A and Day B share blocks and set counts but run them in a different
// order. These pin the exact set sequence each day produces, because the
// workout screen, the notification widget and the final-set button all walk
// it through advance().
const prog = require('../progression');

function walk(day) {
  const seq = [];
  let s = { day, block_idx: 0, exercise_idx: 0, set_num: 1, sets: [] };
  while (!prog.isComplete(s)) {
    seq.push(`${prog.currentExercise(s).id}#${s.set_num}`);
    s = prog.advance(s);
    if (seq.length > 100) throw new Error('advance() did not terminate');
  }
  return seq;
}

const pushPull = [
  'assisted_pullups#1', 'incline_bench_press#1',
  'assisted_pullups#2', 'incline_bench_press#2',
  'assisted_pullups#3', 'incline_bench_press#3',
  'assisted_pullups#4', 'incline_bench_press#4',
  'assisted_pullups#5',
];
const chestShoulders = [
  'lateral_raises#1', 'incline_flyes#1',
  'lateral_raises#2', 'incline_flyes#2',
  'lateral_raises#3', 'incline_flyes#3',
  'lateral_raises#4',
];
const bicepsAbs = [
  'hammer_curls#1', 'dragon_flag#1',
  'hammer_curls#2', 'dragon_flag#2',
  'hammer_curls#3', 'dragon_flag#3',
  'hammer_curls#4',
];
const legs = ['walking_lunges#1', 'walking_lunges#2', 'walking_lunges#3'];

describe('training days', () => {
  test('Day A runs upper body first', () => {
    expect(walk('A')).toEqual([...pushPull, ...chestShoulders, ...bicepsAbs, ...legs]);
  });

  test('Day B runs legs first, chest/back last', () => {
    expect(walk('B')).toEqual([...legs, ...bicepsAbs, ...pushPull, ...chestShoulders]);
  });

  test('both days are 26 sets, matching the progress bar total', () => {
    expect(walk('A')).toHaveLength(26);
    expect(walk('B')).toHaveLength(26);
    expect(prog.totalProgramSets()).toBe(26);
  });

  test('a superset never schedules the same exercise twice in a row', () => {
    for (const day of ['A', 'B']) {
      const ids = walk(day).map(x => x.split('#')[0]);
      for (let i = 1; i < ids.length; i++) {
        // back-to-back sets are only expected in the solo legs block
        if (ids[i] === ids[i - 1]) expect(ids[i]).toBe('walking_lunges');
      }
    }
  });

  test('exactly one final set per day, at the very end', () => {
    for (const day of ['A', 'B']) {
      const finals = [];
      let s = { day, block_idx: 0, exercise_idx: 0, set_num: 1, sets: [] };
      let i = 0;
      while (!prog.isComplete(s)) {
        if (prog.isFinalSet(s)) finals.push(i);
        s = prog.advance(s);
        i++;
      }
      expect(finals).toEqual([i - 1]);
    }
  });

  test("rest after a set comes from that set's block", () => {
    const at = (block_idx, set_num) => ({ day: 'B', block_idx, exercise_idx: 0, set_num, sets: [] });
    expect(prog.getRestSeconds(at(0, 3))).toBe(90); // last lunge set
    expect(prog.getRestSeconds(at(1, 1))).toBe(30); // hammer curls
    expect(prog.getRestSeconds(at(2, 1))).toBe(45); // pull-ups
  });

  test('a state saved before Day A/B falls back to Day A', () => {
    expect(prog.findDay(undefined).id).toBe('A');
    expect(prog.currentExercise({ block_idx: 0, exercise_idx: 0, set_num: 1, sets: [] }).id).toBe('assisted_pullups');
  });

  test('the summary carries the day', () => {
    const summary = prog.summarizeSession({
      day: 'B',
      duration_min: 44,
      sets: [{ exercise_id: 'walking_lunges', set_num: 1, weight: 10, reps: 14, skipped: false }],
    });
    expect(summary.day).toBe('B');
    expect(prog.summarizeSession({ duration_min: 30, sets: [] }).day).toBeNull();
  });
});
