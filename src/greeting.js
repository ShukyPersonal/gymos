// Compare by calendar day so a workout yesterday morning doesn't read as
// "today" just because <24h have elapsed. Clamps negative deltas (which
// happen when restored sessions carry noon-UTC timestamps that land in the
// future for early-morning local time) to a sensible "0 days" fallback.
export function daysSinceLastLiftLabel(lastDateInput, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const last = new Date(lastDateInput); last.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'You already lifted today.';
  if (days === 1) return 'It’s been 1 day since your last lift.';
  return `It’s been ${days} days since your last lift.`;
}
