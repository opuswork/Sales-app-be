/** 날짜 유틸 — 모두 YYYY-MM-DD 문자열, 서버 로컬(KST 가정) 기준 */
const pad = (n: number) => String(n).padStart(2, '0');

export function fmtD(dt: Date): string {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function todayStr(): string {
  // 서버 TZ 가 UTC(Render)여도 한국 날짜가 나오도록 보정
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return fmtD(kst);
}

export function parseD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const dt = parseD(s);
  dt.setDate(dt.getDate() + n);
  return fmtD(dt);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseD(b).getTime() - parseD(a).getTime()) / 86400000);
}

export function weekStartOf(s: string): string {
  const dt = parseD(s);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() - ((dow + 6) % 7));
  return fmtD(dt);
}

export function nextDow(s: string, dow: number): string {
  const dt = parseD(s);
  const diff = (dow - dt.getDay() + 7) % 7;
  dt.setDate(dt.getDate() + (diff === 0 ? 7 : diff));
  return fmtD(dt);
}

export function isDateStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
