import program from '../program.json';

export function totalProgramSets() {
  let total = 0;
  for (const block of program.blocks) {
    for (const ex of block.exercises) {
      total += ex.sets;
    }
  }
  return total;
}

export function findExercise(id) {
  for (const block of program.blocks) {
    for (const ex of block.exercises) {
      if (ex.id === id) return ex;
    }
  }
  return null;
}

// Training days share the same blocks and set counts; only the order differs.
// A state saved before Day A/B existed has no `day` and falls back to the
// first day.
export function findDay(dayId) {
  return program.days.find(d => d.id === dayId) || program.days[0];
}

export function blocksForDay(dayId) {
  return findDay(dayId).block_order.map(id => program.blocks.find(b => b.id === id));
}

export function suggestNext(exerciseId, history) {
  const ex = findExercise(exerciseId);

  for (let i = history.length - 1; i >= 0; i--) {
    const session = history[i];
    const sets = session.sets.filter(s => s.exercise_id === exerciseId && !s.skipped);
    if (sets.length === 0) continue;

    const lastWeight = sets[0].weight;
    const lastReps = sets.map(s => s.reps);
    const allHitTop = lastReps.every(r => r >= ex.rep_range[1]);

    if (allHitTop && ex.weight_increment > 0) {
      const newWeight = ex.assist_mode
        ? Math.max(0, lastWeight - ex.weight_increment)
        : lastWeight + ex.weight_increment;
      return {
        weight: newWeight,
        target_reps: ex.rep_range[0],
        last_summary: `Last: ${lastWeight}kg × ${lastReps.join(', ')}`,
        is_pr: true,
        note: ex.assist_mode ? `PR! Reducing assist to ${newWeight}kg` : `PR! Adding weight → ${newWeight}kg`,
      };
    } else {
      const targetReps = Math.min(ex.rep_range[1], Math.max(...lastReps) + 1);
      return {
        weight: lastWeight,
        target_reps: targetReps,
        last_summary: `Last: ${lastWeight}kg × ${lastReps.join(', ')}`,
        is_pr: false,
        note: `Target: ${lastWeight}kg, aim for ≥${targetReps} reps`,
      };
    }
  }

  return {
    weight: ex.starting_weight,
    target_reps: ex.rep_range[0],
    last_summary: 'First session — no prior data',
    is_pr: false,
    note: `Start: ${ex.starting_weight}kg, aim for ≥${ex.rep_range[0]} reps`,
  };
}

export function advance(state) {
  const s = { ...state, sets: state.sets };
  const block = blocksForDay(s.day)[s.block_idx];
  if (!block) return s;

  if (block.type === 'superset') {
    for (let i = s.exercise_idx + 1; i < block.exercises.length; i++) {
      if (s.set_num <= block.exercises[i].sets) {
        return { ...s, exercise_idx: i };
      }
    }
    const nextSet = s.set_num + 1;
    for (let i = 0; i < block.exercises.length; i++) {
      if (nextSet <= block.exercises[i].sets) {
        return { ...s, exercise_idx: i, set_num: nextSet };
      }
    }
    return { ...s, block_idx: s.block_idx + 1, exercise_idx: 0, set_num: 1 };
  } else {
    const ex = block.exercises[s.exercise_idx];
    if (s.set_num < ex.sets) {
      return { ...s, set_num: s.set_num + 1 };
    }
    const nextExIdx = s.exercise_idx + 1;
    if (nextExIdx >= block.exercises.length) {
      return { ...s, block_idx: s.block_idx + 1, exercise_idx: 0, set_num: 1 };
    }
    return { ...s, exercise_idx: nextExIdx, set_num: 1 };
  }
}

export function isComplete(state) {
  return state.block_idx >= blocksForDay(state.day).length;
}

export function currentBlock(state) {
  return blocksForDay(state.day)[state.block_idx] || null;
}

export function currentExercise(state) {
  const block = currentBlock(state);
  if (!block) return null;
  return block.exercises[state.exercise_idx] || null;
}

export function getRestSeconds(state) {
  const block = currentBlock(state);
  if (!block) return 60;
  return block.type === 'superset'
    ? (block.rest_between_exercises_sec || 60)
    : (block.rest_between_sets_sec || 90);
}

export function summarizeSession(session) {
  const byEx = {};
  for (const s of session.sets) {
    if (!byEx[s.exercise_id]) byEx[s.exercise_id] = [];
    byEx[s.exercise_id].push(s);
  }

  const exercises = [];
  const prs = [];

  for (const [exId, sets] of Object.entries(byEx)) {
    const ex = findExercise(exId);
    const done = sets.filter(s => !s.skipped);
    const skipped = done.length === 0;
    const repsStr = done.map(s => s.reps).join(', ');
    const weight = done[0]?.weight ?? 0;
    exercises.push({ name: ex.name, weight, repsStr, skipped, setsCount: sets.length, doneSets: done.length });
    if (!skipped && done.length === ex.sets && done.every(s => s.reps >= ex.rep_range[1])) {
      prs.push(ex.name);
    }
  }

  return { exercises, prs, duration_min: session.duration_min, day: session.day ?? null };
}

// Would logging the current set finish the whole program?
// Used by the notification widget: the final "Log same" must open the app so
// the Summary screen is reachable, while every other press stays in the
// notification drawer. `advance` is pure, so we can simulate it safely.
export function isFinalSet(state) {
  if (!state || isComplete(state)) return false;
  return isComplete(advance(state));
}
