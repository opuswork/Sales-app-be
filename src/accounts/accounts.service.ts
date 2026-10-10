import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { nameMatches, ownerOf, overdueDays, zoneMap } from '../common/domain';
import { todayStr } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertAccountDto } from './accounts.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 목록 + 실제 담당(resolvedOwnerId)·미방문 초과일 계산 */
  async list(filter: { ownerId?: string; zoneId?: string; q?: string } = {}) {
    const [accounts, zones, users] = await Promise.all([
      this.prisma.account.findMany({
        where: {
          ...(filter.zoneId ? { zoneId: filter.zoneId } : {}),
          ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: 'insensitive' } }, { memo: { contains: filter.q, mode: 'insensitive' } }] } : {}),
        },
        orderBy: [{ grade: 'asc' }, { name: 'asc' }],
        include: { zone: { select: { id: true, name: true, ownerId: true } } },
      }),
      this.prisma.zone.findMany({ select: { id: true, ownerId: true } }),
      this.prisma.user.findMany({ select: { id: true, name: true } }),
    ]);
    const zm = zoneMap(zones);
    const un = new Map(users.map((u) => [u.id, u.name]));
    const today = todayStr();
    let rows = accounts.map((a) => {
      const resolvedOwnerId = ownerOf(a, zm);
      return {
        ...a,
        resolvedOwnerId,
        resolvedOwnerName: un.get(resolvedOwnerId) ?? '',
        overdue: overdueDays(a, today),
      };
    });
    if (filter.ownerId) rows = rows.filter((r) => r.resolvedOwnerId === filter.ownerId);
    return rows;
  }

  /** 선등록 원칙: 유사 업체명 검사 */
  async dupes(name: string, excludeId?: string) {
    if (!name || name.trim().length < 2) return [];
    const all = await this.list();
    return all
      .filter((a) => a.id !== excludeId && nameMatches(a.name, name))
      .map((a) => ({
        id: a.id,
        name: a.name,
        zoneName: a.zone?.name ?? '',
        ownerName: a.resolvedOwnerName,
        registeredAt: a.registeredAt,
        stage: a.stage,
      }));
  }

  async create(dto: UpsertAccountDto, registeredBy: string) {
    if (!dto.name || !dto.channel) throw new BadRequestException('업체명과 채널은 필수입니다.');
    const d = await this.dupes(dto.name);
    if (d.length && dto.force !== 'true') {
      throw new ConflictException({
        message: `이미 등록된 유사 업체가 ${d.length}건 있습니다. 선등록 원칙에 따라 기존 담당이 우선합니다.`,
        dupes: d,
      });
    }
    const { force: _f, ...rest } = dto;
    return this.prisma.account.create({
      data: {
        ...this.clean(rest),
        name: dto.name,
        channel: dto.channel,
        products: dto.products ?? ['간장', '런(발효유)'],
        registeredAt: todayStr(),
        registeredBy,
      },
    });
  }

  async update(id: string, dto: UpsertAccountDto) {
    const { force: _f, ...rest } = dto;
    return this.prisma.account.update({ where: { id }, data: this.clean(rest) });
  }

  async remove(id: string) {
    await this.prisma.account.delete({ where: { id } });
    return { ok: true };
  }

  private clean(dto: Omit<UpsertAccountDto, 'force'>) {
    const data: any = { ...dto };
    if (dto.zoneId === '') data.zoneId = null;
    if (dto.ownerId === '') data.ownerId = null;
    if (dto.ownerMode === 'zone') data.ownerId = null;
    return data;
  }
}
