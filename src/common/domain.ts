import { GRADES, RANKS, REGION_GROUP, STAGES } from './constants';
import { daysBetween, todayStr } from './dates';

export type ZoneLike = { id: string; ownerId: string | null };
export type AccountLike = {
  id: string;
  name: string;
  zoneId: string | null;
  grade: string;
  stage: string;
  ownerMode: string;
  ownerId: string | null;
  lastVisit: string;
  nextAction?: string;
  nextDate?: string;
};

/** 거래처 담당: 고정 담당이면 그 사람, 아니면 구역 담당 */
export function ownerOf(a: AccountLike, zones: Map<string, ZoneLike>): string {
  if (a.ownerMode === 'fixed' && a.ownerId) return a.ownerId;
  const z = a.zoneId ? zones.get(a.zoneId) : undefined;
  return z?.ownerId ?? '';
}

export function overdueDays(a: AccountLike, today = todayStr()): number {
  const g = GRADES[a.grade] ?? GRADES.B;
  if (!a.lastVisit) return 999;
  return daysBetween(a.lastVisit, today) - g.visit;
}

export function stageIndex(stage: string) {
  return STAGES.indexOf(stage as (typeof STAGES)[number]);
}

export function isContracted(stage: string) {
  return stageIndex(stage) >= 4;
}

export function expLevel(y: number): number {
  y = Number(y) || 0;
  return y < 2 ? 1 : y < 4 ? 2 : y < 7 ? 3 : y < 11 ? 4 : 5;
}

export function rankScore(rank: string) {
  return RANKS[rank] ?? 0.5;
}

export function distScore(base: string, sido: string): number {
  if (!base || !sido) return 0.5;
  if (sido === '전국·온라인') return 0.8;
  if (base === sido) return 1;
  if (REGION_GROUP[base] === REGION_GROUP[sido]) return 0.65;
  return 0.2;
}

/** 업체명 정규화 (중복 검사) */
export function normName(n: string): string {
  return String(n || '')
    .toLowerCase()
    .replace(/\s|\(.*?\)|주식회사|\(주\)|㈜/g, '');
}

export function nameMatches(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y || x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}

export function zoneMap<T extends ZoneLike>(zones: T[]) {
  return new Map<string, T>(zones.map((z) => [z.id, z]));
}
