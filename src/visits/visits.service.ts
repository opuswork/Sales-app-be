import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthUserPayload } from '../auth/jwt.strategy';
import { ownerOf, zoneMap } from '../common/domain';
import { addDays, todayStr } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertVisitDto } from './visits.dto';

@Injectable()
export class VisitsService {
  constructor(private readonly prisma: PrismaService) {}

  list(filter: { staffId?: string; from?: string; to?: string; accountId?: string } = {}) {
    return this.prisma.visit.findMany({
      where: {
        ...(filter.staffId ? { staffId: filter.staffId } : {}),
        ...(filter.accountId ? { accountId: filter.accountId } : {}),
        ...(filter.from || filter.to
          ? { date: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        account: { select: { id: true, name: true, zone: { select: { name: true } } } },
        staff: { select: { id: true, name: true, rank: true } },
      },
    });
  }

  /** 체크인 전 경고: 담당 불일치 · 7일 내 타 담당 접촉 */
  async warnings(accountId: string, staffId: string, excludeVisitId?: string) {
    const [a, zones, users] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: accountId } }),
      this.prisma.zone.findMany({ select: { id: true, ownerId: true } }),
      this.prisma.user.findMany({ select: { id: true, name: true } }),
    ]);
    if (!a) return { ownerMismatch: null, recentOthers: [] };
    const un = new Map(users.map((u) => [u.id, u.name]));
    const owner = ownerOf(a, zoneMap(zones));
    const recent = await this.prisma.visit.findMany({
      where: {
        accountId,
        date: { gte: addDays(todayStr(), -7) },
        staffId: { not: staffId },
        ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}),
      },
      select: { staffId: true, date: true },
    });
    return {
      ownerMismatch: owner && owner !== staffId ? { ownerId: owner, ownerName: un.get(owner) ?? '' } : null,
      recentOthers: recent.map((r) => ({ staffName: un.get(r.staffId) ?? '', date: r.date })),
    };
  }

  /** 체크인: 방문 기록 + 거래처 최근방문/단계/차기액션 갱신 */
  async create(dto: UpsertVisitDto, me: AuthUserPayload, source = 'app') {
    if (!dto.accountId || !dto.content?.trim()) {
      throw new BadRequestException('업체와 상담 내용은 필수입니다.');
    }
    const staffId = me.isAdmin && dto.staffId ? dto.staffId : me.id;
    const visit = await this.prisma.visit.create({
      data: {
        date: dto.date || todayStr(),
        accountId: dto.accountId,
        staffId,
        type: dto.type || '방문',
        companion: dto.companion ?? '',
        duration: dto.duration ?? '',
        content: dto.content.trim(),
        followup: dto.followup ?? '',
        transport: dto.transport ?? '자차',
        products: dto.products ?? [],
        stageAfter: dto.stageAfter ?? '',
        source,
      },
    });
    await this.syncAccount(visit.accountId, visit.date, visit.stageAfter, visit.followup);
    return visit;
  }

  async update(id: string, dto: UpsertVisitDto, me: AuthUserPayload) {
    const prev = await this.prisma.visit.findUniqueOrThrow({ where: { id } });
    if (!me.isAdmin && prev.staffId !== me.id) throw new ForbiddenException('본인 기록만 수정할 수 있습니다.');
    const data: any = { ...dto };
    if (!me.isAdmin) delete data.staffId;
    const v = await this.prisma.visit.update({ where: { id }, data });
    await this.syncAccount(v.accountId, v.date, v.stageAfter, v.followup);
    return v;
  }

  async remove(id: string, me: AuthUserPayload) {
    const prev = await this.prisma.visit.findUniqueOrThrow({ where: { id } });
    if (!me.isAdmin && prev.staffId !== me.id) throw new ForbiddenException('본인 기록만 삭제할 수 있습니다.');
    await this.prisma.visit.delete({ where: { id } });
    return { ok: true };
  }

  async syncAccount(accountId: string, date: string, stageAfter: string, followup: string) {
    const a = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!a) return;
    const data: any = {};
    if (!a.lastVisit || a.lastVisit < date) data.lastVisit = date;
    if (stageAfter && stageAfter !== a.stage) data.stage = stageAfter;
    if (followup && followup !== a.nextAction) data.nextAction = followup;
    if (Object.keys(data).length) await this.prisma.account.update({ where: { id: accountId }, data });
  }
}
