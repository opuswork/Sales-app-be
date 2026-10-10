import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { nameMatches, ownerOf, zoneMap } from '../common/domain';
import { todayStr, isDateStr } from '../common/dates';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { VisitsService } from '../visits/visits.service';
import type { Extraction } from './ai.service';

/** 분석 결과 → Draft 행 생성, Draft → 실제 데이터 반영 */
@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visits: VisitsService,
    private readonly plans: PlansService,
    private readonly reports: ReportsService,
  ) {}

  async createFromExtraction(recordingId: string, ex: Extraction) {
    const rows: { kind: string; action: string; targetId: string; title: string; payload: any; confidence: number; evidence: string }[] = [];
    ex.zones.forEach((z) =>
      rows.push({ kind: 'zone', action: z.action, targetId: z.zoneId ?? '', title: `${z.action === 'create' ? '구역 추가' : '구역 수정'}: ${z.name}`, payload: z, confidence: z.confidence, evidence: z.evidence }),
    );
    ex.assignments.forEach((a) =>
      rows.push({ kind: 'assignment', action: 'update', targetId: a.zoneId ?? '', title: `구역 배정: ${a.zoneName} → ${a.staffName}`, payload: a, confidence: a.confidence, evidence: a.evidence }),
    );
    ex.accounts.forEach((a) =>
      rows.push({ kind: 'account', action: a.action, targetId: a.accountId ?? '', title: `${a.action === 'create' ? '거래처 등록' : '거래처 수정'}: ${a.name} [${a.grade}·${a.stage}]`, payload: a, confidence: a.confidence, evidence: a.evidence }),
    );
    ex.visits.forEach((v) =>
      rows.push({ kind: 'visit', action: 'create', targetId: v.accountId ?? '', title: `체크인 ${v.date} [${v.type}] ${v.accountName}`, payload: v, confidence: v.confidence, evidence: v.evidence }),
    );
    ex.plans.forEach((p) =>
      rows.push({ kind: 'plan', action: 'create', targetId: p.accountId ?? '', title: `일정 ${p.date} ${p.accountName} (${p.staffName})`, payload: p, confidence: p.confidence, evidence: p.evidence }),
    );
    ex.events.forEach((e) =>
      rows.push({ kind: 'event', action: 'create', targetId: '', title: `행사·일정 ${e.date} [${e.kind}] ${e.title}`, payload: e, confidence: e.confidence, evidence: e.evidence }),
    );
    if (ex.report?.markdown) {
      rows.push({ kind: 'report', action: 'create', targetId: '', title: `보고서: ${ex.report.title || '녹취 보고서'}`, payload: ex.report, confidence: 0.9, evidence: '' });
    }
    await this.prisma.draft.deleteMany({ where: { recordingId, status: 'PENDING' } });
    await this.prisma.draft.createMany({ data: rows.map((r) => ({ ...r, recordingId })) });
    return rows.length;
  }

  async apply(recordingId: string, draftIds: string[] | 'all', appliedBy: { id: string; isAdmin: boolean }) {
    const rec = await this.prisma.recording.findUniqueOrThrow({ where: { id: recordingId } });
    const where: any = { recordingId, status: 'PENDING' };
    if (draftIds !== 'all') where.id = { in: draftIds };
    const drafts = await this.prisma.draft.findMany({ where, orderBy: { createdAt: 'asc' } });
    // 적용 순서: 구역 → 배정 → 거래처 → 방문 → 일정 → 행사 → 보고서 (앞 단계가 만든 id 를 뒤에서 참조)
    const order = ['zone', 'assignment', 'account', 'visit', 'plan', 'event', 'report'];
    drafts.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const results: { id: string; ok: boolean; message: string }[] = [];
    for (const d of drafts) {
      try {
        const appliedId = await this.applyOne(d, rec.staffId, appliedBy);
        await this.prisma.draft.update({ where: { id: d.id }, data: { status: 'APPLIED', appliedId } });
        results.push({ id: d.id, ok: true, message: appliedId });
      } catch (e) {
        this.logger.warn(`draft ${d.id} failed: ${(e as Error).message}`);
        results.push({ id: d.id, ok: false, message: (e as Error).message });
      }
    }
    const pending = await this.prisma.draft.count({ where: { recordingId, status: 'PENDING' } });
    if (pending === 0) await this.prisma.recording.update({ where: { id: recordingId }, data: { status: 'APPLIED' } });
    return { applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), pending };
  }

  async reject(draftId: string) {
    return this.prisma.draft.update({ where: { id: draftId }, data: { status: 'REJECTED' } });
  }

  async updatePayload(draftId: string, payload: any, title?: string) {
    return this.prisma.draft.update({ where: { id: draftId }, data: { payload, ...(title ? { title } : {}) } });
  }

  private async resolveAccount(id: string | null | undefined, name: string) {
    if (id) {
      const a = await this.prisma.account.findUnique({ where: { id } });
      if (a) return a;
    }
    if (!name) return null;
    const all = await this.prisma.account.findMany({ select: { id: true, name: true } });
    const hit = all.find((a) => a.name === name) ?? all.find((a) => nameMatches(a.name, name));
    return hit ? this.prisma.account.findUnique({ where: { id: hit.id } }) : null;
  }

  private async resolveZone(id: string | null | undefined, name: string | null | undefined) {
    if (id) {
      const z = await this.prisma.zone.findUnique({ where: { id } });
      if (z) return z;
    }
    if (!name) return null;
    const all = await this.prisma.zone.findMany();
    return all.find((z) => z.name === name) ?? all.find((z) => nameMatches(z.name, name)) ?? null;
  }

  private async resolveStaff(id: string | null | undefined, name: string) {
    if (id) {
      const u = await this.prisma.user.findUnique({ where: { id } });
      if (u) return u;
    }
    if (!name) return null;
    const all = await this.prisma.user.findMany();
    return all.find((u) => u.name === name) ?? all.find((u) => name.includes(u.name)) ?? null;
  }

  private async applyOne(d: { kind: string; action: string; payload: any; targetId: string }, recorderId: string, by: { id: string; isAdmin: boolean }): Promise<string> {
    const p = d.payload;
    const today = todayStr();
    switch (d.kind) {
      case 'zone': {
        const existing = await this.resolveZone(p.zoneId, p.name);
        const data = { name: p.name, sido: p.sido || '부산', area: p.area ?? '', channel: p.channel, difficulty: Math.max(1, Math.min(5, Math.round(Number(p.difficulty) || 3))), note: p.note ?? '' };
        if (existing) {
          await this.prisma.zone.update({ where: { id: existing.id }, data: { ...data, note: [existing.note, p.note].filter(Boolean).join(' / ') } });
          return existing.id;
        }
        const z = await this.prisma.zone.create({ data });
        return z.id;
      }
      case 'assignment': {
        if (!by.isAdmin) throw new Error('구역 배정 변경은 관리자만 반영할 수 있습니다.');
        const z = await this.resolveZone(p.zoneId, p.zoneName);
        const s = await this.resolveStaff(p.staffId, p.staffName);
        if (!z || !s) throw new Error('구역 또는 담당자를 찾을 수 없습니다.');
        await this.prisma.zone.update({ where: { id: z.id }, data: { ownerId: s.id, assignedAt: new Date() } });
        return z.id;
      }
      case 'account': {
        const existing = d.action === 'update' || p.accountId ? await this.resolveAccount(p.accountId, p.name) : await this.resolveAccount(null, p.name);
        const zone = await this.resolveZone(p.zoneId, p.zoneName);
        const base: any = {
          channel: p.channel,
          grade: p.grade,
          stage: p.stage,
          products: p.products?.length ? p.products : undefined,
          nextAction: p.nextAction || undefined,
          nextDate: isDateStr(p.nextDate) ? p.nextDate : undefined,
        };
        if (zone) base.zoneId = zone.id;
        if (existing) {
          await this.prisma.account.update({
            where: { id: existing.id },
            data: { ...base, memo: p.memo && !existing.memo.includes(p.memo) ? [existing.memo, p.memo].filter(Boolean).join(' / ') : undefined },
          });
          return existing.id;
        }
        const a = await this.prisma.account.create({
          data: { ...base, name: p.name, products: p.products?.length ? p.products : ['간장', '런(발효유)'], memo: p.memo ?? '', nextAction: p.nextAction ?? '', nextDate: isDateStr(p.nextDate) ? p.nextDate : '', registeredAt: today, registeredBy: recorderId },
        });
        return a.id;
      }
      case 'visit': {
        let acc = await this.resolveAccount(p.accountId, p.accountName);
        if (!acc) {
          acc = await this.prisma.account.create({
            data: { name: p.accountName, channel: '상회·상권', grade: 'B', stage: p.stageAfter || '접촉', products: p.products ?? [], registeredAt: today, registeredBy: recorderId, memo: '녹취에서 자동 등록' },
          });
        }
        const v = await this.prisma.visit.create({
          data: {
            date: isDateStr(p.date) ? p.date : today,
            accountId: acc.id,
            staffId: recorderId,
            type: p.type || '방문',
            companion: p.companion ?? '',
            content: p.content || '(내용 없음)',
            followup: p.followup ?? '',
            products: p.products ?? [],
            stageAfter: p.stageAfter ?? '',
            transport: '자차',
            source: 'voice',
          },
        });
        await this.visits.syncAccount(acc.id, v.date, v.stageAfter, v.followup);
        return v.id;
      }
      case 'plan': {
        const s = (await this.resolveStaff(p.staffId, p.staffName)) ?? (await this.prisma.user.findUnique({ where: { id: recorderId } }));
        const acc = await this.resolveAccount(p.accountId, p.accountName);
        if (!s || !acc) throw new Error('일정의 담당자 또는 거래처를 찾을 수 없습니다.');
        if (!isDateStr(p.date)) throw new Error('일정 날짜 형식이 올바르지 않습니다.');
        const plan = await this.plans.addItem(s.id, p.date, acc.id, p.reason || '녹취 일정');
        return plan.id;
      }
      case 'event': {
        if (!isDateStr(p.date)) throw new Error('행사 날짜 형식이 올바르지 않습니다.');
        const e = await this.prisma.event.create({ data: { date: p.date, title: p.title, kind: p.kind || '행사', place: p.place ?? '', who: p.who ?? '', memo: p.memo ?? '' } });
        return e.id;
      }
      case 'report': {
        const r = await this.reports.save('voice', today, p.title || '녹취 보고서', p.markdown, d.targetId);
        return r.id;
      }
      default:
        throw new BadRequestException('알 수 없는 초안 종류: ' + d.kind);
    }
    void ownerOf;
    void zoneMap;
  }
}
