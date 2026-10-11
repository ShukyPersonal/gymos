// Which training day (A or B) the next workout is, and whose numbers each day
// pre-fills from.
//
// Schedule: lifting Monday + Thursday, surf class Friday. Paddling loads the
// lats, triceps and the back of the shoulders, so the upper-body-first day (A)
// belongs early in the week and the legs-first day (B) right before Friday.

// Monday 00:00 local time of the week containing `date`.
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Monday–Wednesday → A, Thursday–Sunday → B. Keyed off the weekday rather than
// "first session of the week" so a skipped Monday doesn't make Thursday the
// upper-body day right before surfing.
export function defaultDayForDate(date) {
  return (new Date(date).getDay() + 6) % 7 < 3 ? 'A' : 'B';
}

// Sessions saved before Day A/B existed have no `day`; infer it from the weekday.
export function dayOfSession(session) {
  return session.day || defaultDayForDate(session.date);
}

// The week's first session follows the weekday; a later session in the same
// week gets the other day.
export function pickTrainingDay(history, now = new Date()) {
  const start = weekStart(now).getTime();
  const end = now.getTime();
  const thisWeek = history
    .filter(s => {
      const t = new Date(s.date).getTime();
      return t >= start && t <= end;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (thisWeek.length === 0) return defaultDayForDate(now);
  return dayOfSession(thisWeek[thisWeek.length - 1]) === 'A' ? 'B' : 'A';
}

// Most recent non-skipped set per exercise. The same lift is weaker when it
// comes later in the session, so the day's own sessions win. Only sessions
// saved with that day count as its own (older ones all used the Day A order);
// exercises the day hasn't logged yet fall back to any session.
export function lastValuesForDay(history, day) {
  return { ...latestSets(history), ...latestSets(history.filter(s => s.day === day)) };
}

function latestSets(sessions) {
  const seen = {};
  for (let i = sessions.length - 1; i >= 0; i--) {
    const sets = sessions[i].sets || [];
    for (let j = sets.length - 1; j >= 0; j--) {
      const s = sets[j];
      if (s.skipped || seen[s.exercise_id]) continue;
      seen[s.exercise_id] = { weight: s.weight, reps: s.reps };
    }
  }
  return seen;
}

// History for suggestNext: the day's own sessions once that day has logged the
// exercise, otherwise everything.
export function historyForDay(history, day, exerciseId) {
  const same = history.filter(s => s.day === day);
  const logged = same.some(s => (s.sets || []).some(x => x.exercise_id === exerciseId && !x.skipped));
  return logged ? same : history;
}
