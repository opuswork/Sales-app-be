import { Injectable } from '@nestjs/common';

import { Weights } from '../common/constants';
import { clamp, todayStr } from '../common/dates';
import { distScore, expLevel, rankScore } from '../common/domain';
import { RANKS } from '../common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

type StaffRow = {
  id: string;
  name: string;
  rank: string;
  base: string;
  exp: number;
  skills: any;
  products: string[];
  zoneCap: number;
};
type ZoneRow = {
  id: string;
  name: string;
  sido: string;
  channel: string;
  channel2: string;
  difficulty: number;
  reqRank: string;
  products: string[];
  ownerId: string | null;
  lockOwner: boolean;
};

export type Candidate = {
  staffId: string;
  staffName: string;
  score: number;
  parts: Record<string, number>;
  full: boolean;
};
export type AssignmentRow = {
  zoneId: string;
  zoneName: string;
  currentOwnerId: string | null;
  locked: boolean;
  best: Candidate | null;
  alts: Candidate[];
  accountCount: number;
};

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  scorePair(s: StaffRow, z: ZoneRow, load: number, W: Weights) {
    const sk = (s.skills ?? {}) as Record<string, number>;
    const skill = ((sk[z.channel] ?? 0) / 5) * 0.7 + ((sk[z.channel2 || z.channel] ?? 0) / 5) * 0.3;
    const lvl = expLevel(s.exp);
    const exp = clamp(1 - Math.max(0, (z.difficulty || 3) - lvl) * 0.3, 0, 1);
    const rank = clamp(rankScore(s.rank) / (RANKS[z.reqRank] ?? 1), 0, 1);
    const dist = distScore(s.base, z.sido);
    const zp = z.products ?? [];
    const prod = zp.length ? zp.filter((p) => (s.products ?? []).includes(p)).length / zp.length : 1;
    const cap = s.zoneCap || 0;
    const loadS = cap <= 0 ? 0 : clamp(1 - load / cap, 0, 1);
    const tot = W.skill + W.exp + W.rank + W.dist + W.prod + W.load || 1;
    const total =
      ((W.skill * skill + W.exp * exp + W.rank * rank + W.dist * dist + W.prod * prod + W.load * loadS) / tot) * 100;
    return { total, parts: { skill, exp, rank, dist, prod, load: loadS } };
  }

  /** 난이도·S급이 많은 구역부터 그리디로 최적 담당 추천 */
  async run(): Promise<{ result: AssignmentRow[]; load: Record<string, number> }> {
    const W = (await this.settings.get()).weights;
    const [staff, zones, accounts] = await Promise.all([
      this.prisma.user.findMany({ where: { field: true, active: true, zoneCap: { gt: 0 } } }),
      this.prisma.zone.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.account.findMany({ select: { zoneId: true, grade: true } }),
    ]);
    const field = staff as unknown as StaffRow[];
    const load: Record<string, number> = {};
    field.forEach((s) => (load[s.id] = 0));
    const countOf = (zid: string) => accounts.filter((a) => a.zoneId === zid);
    const result: AssignmentRow[] = [];

    zones
      .filter((z) => z.lockOwner && z.ownerId)
      .forEach((z) => {
        if (load[z.ownerId!] != null) load[z.ownerId!]++;
        const s = field.find((x) => x.id === z.ownerId);
        result.push({
          zoneId: z.id,
          zoneName: z.name,
          currentOwnerId: z.ownerId,
          locked: true,
          best: s ? { staffId: s.id, staffName: s.name, score: 0, parts: {}, full: false } : null,
          alts: [],
          accountCount: countOf(z.id).length,
        });
      });

    const rest = zones
      .filter((z) => !(z.lockOwner && z.ownerId))
      .map((z) => ({
        z,
        pri: (z.difficulty || 3) * 10 + countOf(z.id).filter((a) => a.grade === 'S').length * 15 + countOf(z.id).length,
      }))
      .sort((a, b) => b.pri - a.pri);

    rest.forEach(({ z }) => {
      const cands: Candidate[] = field
        .map((s) => {
          const sc = this.scorePair(s, z as unknown as ZoneRow, load[s.id], W);
          return { staffId: s.id, staffName: s.name, score: sc.total, parts: sc.parts, full: load[s.id] >= (s.zoneCap || 0) };
        })
        .sort((a, b) => b.score - a.score);
      const open = cands.filter((c) => !c.full);
      const best = open[0] ?? cands[0] ?? null;
      if (best) load[best.staffId]++;
      result.push({
        zoneId: z.id,
        zoneName: z.name,
        currentOwnerId: z.ownerId,
        locked: false,
        best,
        alts: cands.filter((c) => c !== best).slice(0, 2),
        accountCount: countOf(z.id).length,
      });
    });

    const order = zones.map((z) => z.id);
    result.sort((a, b) => order.indexOf(a.zoneId) - order.indexOf(b.zoneId));
    return { result, load };
  }

  async apply(rows: { zoneId: string; staffId: string }[]) {
    let changed = 0;
    for (const r of rows) {
      const z = await this.prisma.zone.findUnique({ where: { id: r.zoneId } });
      if (!z || z.lockOwner || z.ownerId === r.staffId) continue;
      await this.prisma.zone.update({
        where: { id: r.zoneId },
        data: { ownerId: r.staffId, assignedAt: new Date() },
      });
      changed++;
    }
    return { changed, date: todayStr() };
  }
}
