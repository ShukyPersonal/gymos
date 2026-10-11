// Tests for isFinalSet — decides whether the widget's "Log same" press must
// open the app (final set → Summary screen) or stay in the notification.
// Getting this wrong either strands the user on the Summary they can't reach,
// or yanks them into the app on every press.
const prog = require('../progression');
const program = require('../../program.json');

const blocks = program.blocks;
const lastBlockIdx = blocks.length - 1;
const lastBlock = blocks[lastBlockIdx];
const lastExIdx = lastBlock.exercises.length - 1;
const lastExercise = lastBlock.exercises[lastExIdx];

function state(block_idx, exercise_idx, set_num) {
  return { block_idx, exercise_idx, set_num, sets: [], started_at: '2026-01-01T00:00:00Z' };
}

describe('isFinalSet', () => {
  test('true on the very last set of the last exercise of the last block', () => {
    const s = state(lastBlockIdx, lastExIdx, lastExercise.sets);
    expect(prog.isFinalSet(s)).toBe(true);
    // sanity: advancing from here really does complete the program
    expect(prog.isComplete(prog.advance(s))).toBe(true);
  });

  test('false one set before the end', () => {
    if (lastExercise.sets < 2) return; // program too short to test
    expect(prog.isFinalSet(state(lastBlockIdx, lastExIdx, lastExercise.sets - 1))).toBe(false);
  });

  test('false at the very first set', () => {
    expect(prog.isFinalSet(state(0, 0, 1))).toBe(false);
  });

  test('false midway through every block except the true final position', () => {
    let trues = 0;
    blocks.forEach((b, bi) => {
      b.exercises.forEach((ex, ei) => {
        for (let sn = 1; sn <= ex.sets; sn++) {
          if (prog.isFinalSet(state(bi, ei, sn))) trues++;
        }
      });
    });
    // exactly one position in the whole program should be the final set
    expect(trues).toBe(1);
  });

  test('false for an already-complete state (no crash)', () => {
    expect(prog.isFinalSet({ block_idx: blocks.length, exercise_idx: 0, set_num: 1, sets: [] })).toBe(false);
  });

  test('false for null/undefined state', () => {
    expect(prog.isFinalSet(null)).toBe(false);
    expect(prog.isFinalSet(undefined)).toBe(false);
  });

  test('does not mutate the state it inspects', () => {
    const s = state(lastBlockIdx, lastExIdx, lastExercise.sets);
    const snapshot = JSON.stringify(s);
    prog.isFinalSet(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
