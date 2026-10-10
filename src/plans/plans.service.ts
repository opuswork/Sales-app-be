import { Injectable } from '@nestjs/common';

import { GRADES } from '../common/constants';
import { ownerOf, overdueDays, stageIndex, zoneMap } from '../common/domain';
import { addDays, clamp, daysBetween, shortD, todayStr, weekStartOf } from './plan-dates';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type PlanItem = { day: number; accountId: string; zoneId: string; reason: string };

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async week(weekStart: string, staffId?: string) {
    const ws = weekStartOf(weekStart || todayStr());
    const we = addDays(ws, 6);
    const [plans, visits, events] = await Promise.all([
      this.prisma.plan.findMany({ where: { weekStart: ws, ...(staffId ? { staffId } : {}) } }),
      this.prisma.visit.findMany({
        where: { date: { gte: ws, lte: we }, ...(staffId ? { staffId } : {}) },
        select: { id: true, date: true, accountId: true, staffId: true, type: true },
      }),
      this.prisma.event.findMany({ where: { date: { gte: ws, lte: we } }, orderBy: { date: 'asc' } }),
    ]);
    const accounts = await this.prisma.account.findMany({
      select: { id: true, name: true, grade: true, zoneId: true, zone: { select: { name: true } } },
    });
    const am = new Map(accounts.map((a) => [a.id, a]));
    return {
      weekStart: ws,
      weekEnd: we,
      plans: plans.map((p) => ({
        ...p,
        items: (p.items as PlanItem[]).map((it) => ({
          ...it,
          accountName: am.get(it.accountId)?.name ?? '(삭제됨)',
          grade: am.get(it.accountId)?.grade ?? 'B',
          zoneName: am.get(it.accountId)?.zone?.name ?? '',
          done: visits.some((v) => v.accountId === it.accountId && v.staffId === p.staffId),
        })),
      })),
      visits,
      events,
    };
  }

  /** 담당 거래처의 등급·미방문·단계·차기액션 점수로 주간 일정 생성 (같은 구역은 같은 요일에 묶음) */
  async buildWeekPlan(staffId: string, weekStart: string): Promise<PlanItem[]> {
    const st = await this.prisma.user.findUnique({ where: { id: staffId } });
    if (!st) return [];
    const settings = await this.settings.get();
    const [accounts, zones] = await Promise.all([
      this.prisma.account.findMany(),
      this.prisma.zone.findMany({ select: { id: true, ownerId: true } }),
    ]);
    const zm = zoneMap(zones);
    const today = todayStr();
    const wEnd = addDays(weekStart, 5);
    const mine = accounts.filter((a) => ownerOf(a, zm) === staffId);
    const scored = mine
      .map((a) => {
        const g = GRADES[a.grade] ?? GRADES.B;
        const od = overdueDays(a, today);
        const gw = ({ S: 3, A: 2, B: 1 } as Record<string, number>)[a.grade] ?? 1;
        let p = gw * (1 + clamp(od / g.visit, -1, 3));
        const si = stageIndex(a.stage);
        if (si === 2 || si === 3) p += 2;
        if (si === 0) p += 0.5;
        const inWeek = a.nextDate && a.nextDate >= weekStart && a.nextDate <= wEnd;
        if (inWeek) p += 4;
        const reason: string[] = [];
        if (od > 0) reason.push(`미방문 ${od}일 초과`);
        else if (!a.lastVisit) reason.push('첫 방문');
        if (si === 2 || si === 3) reason.push('제안·견적 단계');
        if (inWeek) reason.push('차기액션 ' + shortD(a.nextDate));
        return { a, p, reason: reason.join(' · ') || '정기 관리' };
      })
      .sort((x, y) => y.p - x.p);
    const perDay = settings.visitsPerDay || 4;
    const days = settings.workDays || 5;
    const picked = scored.slice(0, perDay * days);
    const byZone = new Map<string, typeof picked>();
    picked.forEach((x) => {
      const k = x.a.zoneId ?? '';
      byZone.set(k, [...(byZone.get(k) ?? []), x]);
    });
    const groups = [...byZone.entries()].sort((a, b) => b[1].length - a[1].length);
    const dayLoad = Array(days).fill(0) as number[];
    const items: PlanItem[] = [];
    groups.forEach(([zid, list]) => {
      list.forEach((x) => {
        if (x.a.nextDate && x.a.nextDate >= weekStart && x.a.nextDate <= wEnd) {
          const di = clamp(daysBetween(weekStart, x.a.nextDate), 0, days - 1);
          if (dayLoad[di] < perDay + 1) {
            dayLoad[di]++;
            items.push({ day: di, accountId: x.a.id, zoneId: zid, reason: x.reason });
            return;
          }
        }
        let di = dayLoad.indexOf(Math.min(...dayLoad));
        const same = items.filter((i) => i.zoneId === zid);
        if (same.length) {
          const last = same[same.length - 1].day;
          if (dayLoad[last] < perDay) di = last;
        }
        dayLoad[di]++;
        items.push({ day: di, accountId: x.a.id, zoneId: zid, reason: x.reason });
      });
    });
    return items.sort((a, b) => a.day - b.day);
  }

  async generate(staffId: string, weekStart: string) {
    const ws = weekStartOf(weekStart || todayStr());
    const items = await this.buildWeekPlan(staffId, ws);
    const plan = await this.prisma.plan.upsert({
      where: { staffId_weekStart: { staffId, weekStart: ws } },
      create: { staffId, weekStart: ws, items },
      update: { items },
    });
    return { ...plan, count: items.length };
  }

  async generateAll(weekStart: string) {
    const staff = await this.prisma.user.findMany({ where: { field: true, active: true }, select: { id: true } });
    let n = 0;
    for (const s of staff) n += (await this.generate(s.id, weekStart)).count;
    return { count: n };
  }

  /** 초안 반영 등 외부에서 한 건 추가 */
  async addItem(staffId: string, date: string, accountId: string, reason: string) {
    const ws = weekStartOf(date);
    const day = clamp(daysBetween(ws, date), 0, 5);
    const a = await this.prisma.account.findUnique({ where: { id: accountId }, select: { zoneId: true } });
    const existing = await this.prisma.plan.findUnique({ where: { staffId_weekStart: { staffId, weekStart: ws } } });
    const items = ((existing?.items as PlanItem[]) ?? []).filter((it) => !(it.accountId === accountId && it.day === day));
    items.push({ day, accountId, zoneId: a?.zoneId ?? '', reason });
    items.sort((x, y) => x.day - y.day);
    return this.prisma.plan.upsert({
      where: { staffId_weekStart: { staffId, weekStart: ws } },
      create: { staffId, weekStart: ws, items },
      update: { items },
    });
  }
}
