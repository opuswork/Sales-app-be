export { addDays, clamp, daysBetween, todayStr, weekStartOf } from '../common/dates';

export function shortD(s: string): string {
  if (!s) return '—';
  const [, m, d] = s.split('-');
  return `${m}/${d}`;
}
