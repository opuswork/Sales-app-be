import { BadRequestException, Injectable } from '@nestjs/common';

import { overdueDays } from '../common/domain';
import { todayStr } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertZoneDto } from './zones.dto';

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const zones = await this.prisma.zone.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        owner: { select: { id: true, name: true, rank: true } },
        accounts: { select: { id: true, grade: true, lastVisit: true } },
      },
    });
    const today = todayStr();
    return zones.map(({ accounts, ...z }) => ({
      ...z,
      accountCount: accounts.length,
      sCount: accounts.filter((a) => a.grade === 'S').length,
      unvisited: accounts.filter((a) =>
        overdueDays({ ...a, name: '', zoneId: z.id, stage: '', ownerMode: 'zone', ownerId: null }, today) > 0,
      ).length,
    }));
  }

  async create(dto: UpsertZoneDto) {
    if (!dto.name || !dto.sido || !dto.channel) {
      throw new BadRequestException('구역명·시도·주력 채널은 필수입니다.');
    }
    const max = await this.prisma.zone.aggregate({ _max: { sortOrder: true } });
    return this.prisma.zone.create({
      data: {
        ...this.clean(dto),
        name: dto.name,
        sido: dto.sido,
        channel: dto.channel,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        assignedAt: dto.ownerId ? new Date() : null,
      },
    });
  }

  async update(id: string, dto: UpsertZoneDto) {
    const prev = await this.prisma.zone.findUniqueOrThrow({ where: { id } });
    const data: any = this.clean(dto);
    if (dto.ownerId !== undefined && dto.ownerId !== prev.ownerId) data.assignedAt = new Date();
    return this.prisma.zone.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.zone.delete({ where: { id } });
    return { ok: true };
  }

  private clean(dto: UpsertZoneDto) {
    const data: any = { ...dto };
    if (dto.ownerId === '') data.ownerId = null;
    return data;
  }
}
