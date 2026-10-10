import { Injectable } from '@nestjs/common';

import { CHANNELS, EVAL_WEIGHTS, GRADES, PRODUCTS, STAGES, TARGETS, VISIT_TYPES } from '../common/constants';
import { addDays, clamp, fmtD, parseD, todayStr, weekStartOf } from '../common/dates';
import { isContracted, normName, ownerOf, overdueDays, stageIndex, zoneMap } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';

export type Period = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last30';

export function periodRange(p: Period | string): [string, string] {
  const T = todayStr();
  const ws = weekStartOf(T);
  if (p === 'thisWeek') return [ws, addDays(ws, 6)];
  if (p === 'lastWeek') return [addDays(ws, -7), addDays(ws, -1)];
  if (p === 'thisMonth') return [T.slice(0, 8) + '01', T];
  if (p === 'lastMonth') {
    const dt = parseD(T.slice(0, 8) + '01');
    dt.setDate(0);
    const end = fmtD(dt);
    return [end.slice(0, 8) + '01', end];
  }
  return [addDays(T, -30), T];
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async base() {
    const [staff, zones, accounts, visitsAll, events] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.zone.findMany({ orderBy: [{ sortOrder: 'asc' }] }),
      this.prisma.account.findMany(),
      this.prisma.visit.findMany({ orderBy: { date: 'desc' }, take: 3000 }),
      this.prisma.event.findMany({ orderBy: { date: 'asc' } }),
    ]);
    const zm = zoneMap(zones);
    const un = new Map(staff.map((s) => [s.id, s.name]));
    const staffName = (id: string) => un.get(id) ?? '미배정';
    const owner = (a: (typeof accounts)[number]) => ownerOf(a, zm);
    return { staff, zones, accounts, visitsAll, events, zm, staffName, owner };
  }

  /** 중복 리드: 7일 내 2인 이상 접촉 / 동일 업체명 */
  dupes(accounts: any[], visits: any[], staffName: (id: string) => string) {
    const T = todayStr();
    const from = addDays(T, -7);
    const m = new Map<string, Set<string>>();
    visits.filter((v) => v.date >= from && v.date <= T).forEach((v) => {
      m.set(v.accountId, (m.get(v.accountId) ?? new Set()).add(v.staffId));
    });
    const out: any[] = [];
    m.forEach((set, aid) => {
      if (set.size > 1) {
        const a = accounts.find((x) => x.id === aid);
        if (a) out.push({ type: 'contact', account: a, staff: [...set].map(staffName) });
      }
    });
    const names = new Map<string, any[]>();
    accounts.forEach((a) => {
      const n = normName(a.name);
      names.set(n, [...(names.get(n) ?? []), a]);
    });
    names.forEach((list) => {
      if (list.length > 1) out.push({ type: 'name', account: list[0], dupList: list });
    });
    return out;
  }

  async dashboard() {
    const { staff, zones, accounts, visitsAll, events, staffName, owner } = await this.base();
    const T = todayStr();
    const ws = weekStartOf(T);
    const we = addDays(ws, 6);
    const grades = { S: 0, A: 0, B: 0 } as Record<string, number>;
    accounts.forEach((a) => {
      if (isContracted(a.stage) && grades[a.grade] != null) grades[a.grade]++;
    });
    const unvisited = accounts
      .filter((a) => overdueDays(a, T) > 0)
      .sort((x, y) => overdueDays(y, T) - overdueDays(x, T))
      .map((a) => ({ ...a, overdue: overdueDays(a, T), ownerName: staffName(owner(a)), zoneName: zones.find((z) => z.id === a.zoneId)?.name ?? '' }));
    const weekVisits = visitsAll.filter((v) => v.date >= ws && v.date <= we);
    const dupes = this.dupes(accounts, visitsAll, staffName).map((d) => ({
      ...d,
      account: { id: d.account.id, name: d.account.name, ownerName: staffName(owner(d.account)) },
      dupList: d.dupList?.map((a: any) => ({ id: a.id, name: a.name, registeredAt: a.registeredAt, ownerName: staffName(owner(a)), zoneName: zones.find((z) => z.id === a.zoneId)?.name ?? '' })),
    }));
    const unassignedZones = zones.filter((z) => !z.ownerId).map((z) => ({ id: z.id, name: z.name, accountCount: accounts.filter((a) => a.zoneId === z.id).length }));
    const monthly = Object.entries(GRADES).reduce((t, [g, c]) => t + grades[g] * c.amount, 0);
    return {
      today: T,
      weekStart: ws,
      weekEnd: we,
      counts: { accounts: accounts.length, zones: zones.length, fieldStaff: staff.filter((s) => s.field && s.active).length, weekVisits: weekVisits.length },
      grades,
      targets: Object.fromEntries(Object.entries(GRADES).map(([g, c]) => [g, c.target])),
      monthly,
      stageCounts: STAGES.map((st) => ({ stage: st, count: accounts.filter((a) => a.stage === st).length })),
      unvisited: unvisited.slice(0, 30),
      unvisitedTotal: unvisited.length,
      dupes,
      unassignedZones,
      upcoming: events.filter((e) => e.date >= T).slice(0, 6),
      load: staff
        .filter((s) => s.field && s.active)
        .map((s) => {
          const acc = accounts.filter((a) => owner(a) === s.id);
          const c = { S: 0, A: 0, B: 0 } as Record<string, number>;
          acc.forEach((a) => c[a.grade] != null && c[a.grade]++);
          return { id: s.id, name: s.name, rank: s.rank, zones: zones.filter((z) => z.ownerId === s.id).length, zoneCap: s.zoneCap, accounts: acc.length, grades: c, weekVisits: weekVisits.filter((v) => v.staffId === s.id).length, capacity: s.capacity };
        }),
    };
  }

  /** 담당자 개인 화면 데이터 */
  async myPage(staffId: string) {
    const { staff, zones, accounts, visitsAll, events, staffName, owner } = await this.base();
    const s = staff.find((x) => x.id === staffId);
    if (!s) return null;
    const T = todayStr();
    const ws = weekStartOf(T);
    const we = addDays(ws, 6);
    const acc = accounts.filter((a) => owner(a) === staffId);
    const con = acc.filter((a) => isContracted(a.stage));
    const amount = con.reduce((t, a) => t + (GRADES[a.grade]?.amount ?? 0), 0);
    const wv = visitsAll.filter((v) => v.staffId === staffId && v.date >= ws && v.date <= we);
    const unv = acc.filter((a) => overdueDays(a, T) > 0).sort((x, y) => overdueDays(y, T) - overdueDays(x, T));
    const g = { S: 0, A: 0, B: 0 } as Record<string, number>;
    con.forEach((a) => g[a.grade] != null && g[a.grade]++);
    const forMe = (e: any) => /전원|전체/.test(e.who || '') || (e.who || '').includes(s.name);
    const P = (await this.perStaff('thisMonth')).find((p) => p.id === staffId);
    const zoneName = (id: string | null) => zones.find((z) => z.id === id)?.name ?? '';
    return {
      staff: { id: s.id, name: s.name, rank: s.rank, part: s.part, roleDesc: s.roleDesc, note: s.note, skills: s.skills, capacity: s.capacity, products: s.products },
      target: TARGETS[s.name] ?? null,
      kpis: { accounts: acc.length, zones: zones.filter((z) => z.ownerId === staffId).length, contracted: con.length, amount, weekVisits: wv.length, unvisited: unv.length, score: P?.score ?? 0, filled: P?.filled ?? 0 },
      grades: g,
      stageCounts: STAGES.map((st) => ({ stage: st, count: acc.filter((a) => a.stage === st).length })),
      unvisited: unv.slice(0, 8).map((a) => ({ id: a.id, name: a.name, grade: a.grade, overdue: overdueDays(a, T), lastVisit: a.lastVisit, nextAction: a.nextAction, zoneName: zoneName(a.zoneId) })),
      nextActions: acc.filter((a) => a.nextAction && !unv.slice(0, 8).includes(a)).sort((a, b) => ((a.nextDate || '9999') < (b.nextDate || '9999') ? -1 : 1)).slice(0, 8).map((a) => ({ id: a.id, name: a.name, stage: a.stage, nextAction: a.nextAction, nextDate: a.nextDate })),
      myZones: zones.filter((z) => z.ownerId === staffId).map((z) => ({ id: z.id, name: z.name, channel: z.channel, difficulty: z.difficulty, accountCount: accounts.filter((a) => a.zoneId === z.id).length })),
      events: events.filter((e) => e.date >= T && forMe(e)).slice(0, 5),
      recentVisits: visitsAll.filter((v) => v.staffId === staffId).slice(0, 6).map((v) => ({ id: v.id, date: v.date, type: v.type, content: v.content, accountName: accounts.find((a) => a.id === v.accountId)?.name ?? '?' })),
      staffName: staffName(staffId),
    };
  }

  async perStaff(period: string) {
    const { staff, accounts, visitsAll, owner } = await this.base();
    const [from, to] = periodRange(period);
    const vs = visitsAll.filter((v) => v.date >= from && v.date <= to);
    return staff
      .filter((s) => s.active)
      .map((s) => {
        const mv = vs.filter((v) => v.staffId === s.id);
        const owned = accounts.filter((a) => owner(a) === s.id);
        const contracts = owned.filter((a) => isContracted(a.stage));
        const regular = owned.filter((a) => a.stage === '정기납품');
        const amount = contracts.reduce((t, a) => t + (GRADES[a.grade]?.amount ?? 0), 0);
        const filled = owned.length ? owned.filter((a) => a.stage && a.nextAction).length / owned.length : 0;
        const tg = TARGETS[s.name];
        const target = tg ? tg.S + tg.A + tg.B : 8;
        const score = Math.round(
          EVAL_WEIGHTS.contracts * clamp(contracts.length / target, 0, 1) +
            EVAL_WEIGHTS.amount * clamp(amount / 2000, 0, 1) * 0.5 +
            EVAL_WEIGHTS.amount * 0.5 * (owned.length ? clamp(regular.length / owned.length / 0.5, 0, 1) : 0) +
            EVAL_WEIGHTS.activity * clamp(mv.length / (s.capacity || 1), 0, 1) +
            EVAL_WEIGHTS.data * filled,
        );
        return {
          id: s.id,
          name: s.name,
          rank: s.rank,
          field: s.field,
          visits: mv.length,
          byType: VISIT_TYPES.map((t) => mv.filter((v) => v.type === t).length),
          owned: owned.length,
          contracts: contracts.length,
          regular: regular.length,
          amount,
          filled,
          score: clamp(score, 0, 100),
        };
      });
  }

  async markdown(kind: 'weekly' | 'marketing' | 'eval', period: string) {
    const { accounts, visitsAll, events, staffName, owner, zones } = await this.base();
    const [from, to] = periodRange(period);
    const vs = visitsAll.filter((v) => v.date >= from && v.date <= to);
    const per = await this.perStaff(period);
    const pl = ({ thisWeek: '이번 주', lastWeek: '지난 주', thisMonth: '이번 달', lastMonth: '지난 달' } as Record<string, string>)[period] ?? '최근 30일';
    const grades = { S: 0, A: 0, B: 0 } as Record<string, number>;
    accounts.forEach((a) => isContracted(a.stage) && grades[a.grade] != null && grades[a.grade]++);
    const monthly = Object.entries(GRADES).reduce((t, [g, c]) => t + grades[g] * c.amount, 0);
    const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
    const L: string[] = [];
    if (kind === 'weekly') {
      L.push(`# 주간 영업 리포트 (${pl}: ${from} ~ ${to})`, '', `작성: 영업구역 배정 앱 · 기준일 ${todayStr()}`, '', '## 1. 목표 대비 확보 현황 (계약 이상 단계)');
      Object.entries(GRADES).forEach(([g, c]) => L.push(`- ${c.label}: ${grades[g]} / ${c.target}곳 (월 ${c.amount}만 기준)`));
      L.push(`- 환산 월 매출: 약 ${monthly.toLocaleString()}만 원 / 목표 8,333만 원 (${Math.round((monthly / 8333) * 100)}%)`, '', '## 2. 파이프라인 단계별 건수');
      STAGES.forEach((st) => L.push(`- ${st}: ${accounts.filter((a) => a.stage === st).length}건`));
      L.push('', '## 3. 담당별 활동', '', '| 담당 | 방문 | 전화 | 미팅 | 마케팅·행사 | 관장님문의 | 담당 거래처 | 계약 이상 | 정기납품 |', '|---|---|---|---|---|---|---|---|---|');
      per.filter((p) => p.field).forEach((p) => L.push(`| ${p.name} ${p.rank} | ${p.byType.join(' | ')} | ${p.owned} | ${p.contracts} | ${p.regular} |`));
      L.push('', '## 4. 중복 리드 점검 (선등록 원칙)');
      const d = this.dupes(accounts, visitsAll, staffName);
      if (!d.length) L.push('- 중복 0건 ✅');
      else d.forEach((x) => L.push(x.type === 'name' ? `- 동일 업체명 중복 등록: ${x.account.name} (${x.dupList.length}건) → 선등록 ${x.dupList.map((a: any) => a.registeredAt + ' ' + staffName(owner(a))).join(', ')}` : `- 7일 내 2인 이상 접촉: ${x.account.name} — ${x.staff.join(', ')}`));
      L.push('', '## 5. 미방문 경고 (등급 기준 초과)');
      const unv = accounts.filter((a) => overdueDays(a) > 0).sort((x, y) => overdueDays(y) - overdueDays(x));
      if (!unv.length) L.push('- 없음');
      else unv.slice(0, 15).forEach((a) => L.push(`- [${a.grade}] ${a.name} — ${staffName(owner(a))} · ${a.lastVisit ? overdueDays(a) + '일 초과' : '방문 이력 없음'}`));
      L.push('', '## 6. 주요 활동 내용');
      vs.slice(0, 25).forEach((v) => L.push(`- ${v.date} [${v.type}] ${accName(v.accountId)} / ${staffName(v.staffId)}: ${v.content}${v.followup ? ' → ' + v.followup : ''}`));
    } else if (kind === 'marketing') {
      const chOf = (id: string) => accounts.find((a) => a.id === id)?.channel ?? '';
      const mkt = vs.filter((v) => v.type === '마케팅·행사' || chOf(v.accountId) === '박람회·행사' || chOf(v.accountId) === '특수채널·제휴');
      L.push(`# 마케팅 보고서 (${pl}: ${from} ~ ${to})`, '', `## 1. 마케팅·특수채널·박람회 활동 (${mkt.length}건)`);
      mkt.forEach((v) => L.push(`- ${v.date} [${v.type}] ${accName(v.accountId)} / ${staffName(v.staffId)}: ${v.content}${v.followup ? ' → 차기: ' + v.followup : ''}`));
      L.push('', '## 2. 채널별 거래처 현황');
      CHANNELS.forEach((c) => {
        const list = accounts.filter((a) => a.channel === c);
        L.push(`- ${c}: ${list.length}곳 (계약 이상 ${list.filter((a) => isContracted(a.stage)).length})`);
      });
      L.push('', '## 3. 제품별 접촉 현황 (기간 내 활동 기준)');
      PRODUCTS.forEach((p) => L.push(`- ${p}: ${vs.filter((v) => (v.products ?? []).includes(p)).length}건`));
      L.push('', '## 4. 박람회·행사·교육 일정');
      events.filter((e) => e.date >= from).slice(0, 12).forEach((e) => L.push(`- ${e.date} [${e.kind}] ${e.title}${e.who ? ' — ' + e.who : ''}${e.place ? ' @' + e.place : ''}`));
      L.push('', '## 5. 차기 액션');
      accounts.filter((a) => a.nextAction && ['특수채널·제휴', '박람회·행사', '온라인'].includes(a.channel)).forEach((a) => L.push(`- ${a.name}: ${a.nextAction}${a.nextDate ? ' (' + a.nextDate + ')' : ''} — ${staffName(owner(a))}`));
    } else {
      L.push(`# 담당별 평가 지표 (${pl})`, '', '가중치: 신규 계약 건수 40% · 계약 금액/정기납품 전환 30% · 유효 상담 활동량 20% · 데이터 기입 성실도 10%', '', '| 담당 | 계약 이상 | 정기납품 | 환산 월 거래액 | 기간 활동 | 기입률 | 종합점수 |', '|---|---|---|---|---|---|---|');
      per.filter((p) => p.field).sort((a, b) => b.score - a.score).forEach((p) => L.push(`| ${p.name} ${p.rank} | ${p.contracts} | ${p.regular} | ${p.amount.toLocaleString()}만 | ${p.visits}건 | ${Math.round(p.filled * 100)}% | ${p.score} |`));
    }
    void zones;
    void stageIndex;
    return { kind, period, from, to, markdown: L.join('\n'), activityCount: vs.length };
  }

  async channelStats(period: string) {
    const { accounts, visitsAll } = await this.base();
    const [from, to] = periodRange(period);
    const vs = visitsAll.filter((v) => v.date >= from && v.date <= to);
    const chOf = (id: string) => accounts.find((a) => a.id === id)?.channel ?? '';
    return {
      channels: CHANNELS.map((c) => ({ channel: c, accounts: accounts.filter((a) => a.channel === c).length, contracted: accounts.filter((a) => a.channel === c && isContracted(a.stage)).length, activity: vs.filter((v) => chOf(v.accountId) === c).length })),
      products: PRODUCTS.map((p) => ({ product: p, count: vs.filter((v) => (v.products ?? []).includes(p)).length })),
      total: vs.length,
      stageCounts: STAGES.map((st) => ({ stage: st, count: accounts.filter((a) => a.stage === st).length })),
    };
  }

  saved() {
    return this.prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  save(kind: string, period: string, title: string, markdown: string, recordingId = '') {
    return this.prisma.report.create({ data: { kind, period, title, markdown, recordingId } });
  }
}
