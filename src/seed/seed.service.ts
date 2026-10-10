import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { PrismaService } from '../prisma/prisma.service';

/**
 * 첫 기동 시 자동 시드.
 * - 시스템 관리자(SYSADMIN) 가 없으면 SEED_ADMIN_EMAIL(로그인 ID, 기본 sysadmin) / SEED_ADMIN_PASSWORD 로 만든다.
 *   담당자 목록에 보이지 않고 전체를 관리한다.
 * - 사용자가 한 명도 없으면 prisma/seed-data/*.json (조직도·구역·거래처·방문·행사) 를 넣는다.
 *   김혜경 부장(총괄)은 ADMIN 권한, 로그인 s1@sales-app.local — 담당자 화면에서 실제 이메일로 바꾼다.
 * Render 무료 플랜은 Shell 이 없어 scripts/seed.mjs 를 직접 못 돌리므로 서버가 스스로 처리한다.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.ensureAdmin();
      const users = await this.prisma.user.count({ where: { role: { not: 'SYSADMIN' } } });
      if (users === 0) await this.seedAll();
    } catch (e) {
      this.logger.error(`auto seed failed: ${(e as Error).message}`);
    }
  }

  private dataDir() {
    const candidates = [join(process.cwd(), 'prisma', 'seed-data'), join(__dirname, '..', '..', 'prisma', 'seed-data')];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  private load(dir: string, sub: string): any[] {
    const d = join(dir, sub);
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')))
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  }

  private adminEmail() {
    return (process.env.SEED_ADMIN_EMAIL || 'sysadmin').toLowerCase().trim();
  }

  /** 시스템 관리자 계정 보장 */
  private async ensureAdmin() {
    const sys = await this.prisma.user.findFirst({ where: { role: 'SYSADMIN' } });
    if (sys) return;
    let email = this.adminEmail();
    // 이미 담당자(예: 김혜경 부장)가 쓰는 이메일이면 그 계정을 건드리지 않고 'sysadmin' ID 로 만든다
    if (await this.prisma.user.findUnique({ where: { email } })) {
      this.logger.warn(`SEED_ADMIN_EMAIL(${email}) is already a staff account; creating 'sysadmin' instead`);
      email = 'sysadmin';
      if (await this.prisma.user.findUnique({ where: { email } })) {
        this.logger.warn(`'sysadmin' also exists as a non-SYSADMIN account; skipping`);
        return;
      }
    }
    await this.prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'change-me-1234', 10),
        role: 'SYSADMIN',
        mustChangePw: false,
        name: '시스템관리자',
        rank: '부장',
        part: '총괄',
        roleDesc: '시스템 관리',
        field: false,
        zoneCap: 0,
        capacity: 0,
      },
    });
    this.logger.log(`sysadmin account created: ${email}`);
  }

  private async seedAll() {
    const dir = this.dataDir();
    if (!dir) {
      this.logger.warn('seed-data directory not found; creating admin only');
      await this.ensureAdmin();
      return;
    }
    const staff = this.load(dir, 'staff');
    const zones = this.load(dir, 'zones');
    const accounts = this.load(dir, 'accounts');
    const visits = this.load(dir, 'visits');
    const events = this.load(dir, 'events');
    const staffHash = await bcrypt.hash(process.env.SEED_STAFF_PASSWORD || 'sales1234!', 10);

    for (const s of staff) {
      const isAdmin = s.part === '총괄' || s.rank === '부장';
      await this.prisma.user.create({
        data: {
          id: s.id,
          email: `${s.id}@sales-app.local`,
          passwordHash: staffHash,
          role: isAdmin ? 'ADMIN' : 'STAFF',
          mustChangePw: true,
          name: s.name,
          rank: s.rank,
          part: s.part,
          roleDesc: s.role ?? '',
          base: s.base ?? '부산',
          exp: s.exp ?? 0,
          skills: s.skills ?? {},
          products: s.products ?? [],
          field: !!s.field,
          zoneCap: s.zoneCap ?? 0,
          capacity: s.capacity ?? 0,
          note: s.note ?? '',
        },
      });
    }
    let order = 0;
    for (const z of zones) {
      await this.prisma.zone.create({
        data: {
          id: z.id,
          name: z.name,
          sido: z.sido,
          area: z.area ?? '',
          channel: z.channel,
          channel2: z.channel2 ?? '',
          difficulty: z.difficulty ?? 3,
          reqRank: z.reqRank ?? '대리',
          products: z.products ?? [],
          note: z.note ?? '',
          ownerId: z.ownerId || null,
          lockOwner: !!z.lockOwner,
          sortOrder: ++order,
        },
      });
    }
    for (const a of accounts) {
      await this.prisma.account.create({
        data: {
          id: a.id,
          name: a.name,
          zoneId: a.zoneId || null,
          channel: a.channel,
          grade: a.grade ?? 'B',
          stage: a.stage ?? '접촉',
          ownerMode: a.ownerMode ?? 'zone',
          ownerId: a.ownerMode === 'fixed' && a.ownerId ? a.ownerId : null,
          products: a.products ?? [],
          phone: a.phone ?? '',
          memo: a.memo ?? '',
          nextAction: a.nextAction ?? '',
          nextDate: a.nextDate ?? '',
          lastVisit: a.lastVisit ?? '',
          registeredAt: a.registeredAt ?? '',
          registeredBy: a.registeredBy ?? '',
        },
      });
    }
    for (const v of visits) {
      await this.prisma.visit.create({
        data: {
          id: v.id,
          date: v.date,
          accountId: v.accountId,
          staffId: v.staffId,
          type: v.type ?? '방문',
          companion: v.companion ?? '',
          duration: v.duration ?? '',
          content: v.content ?? '',
          followup: v.followup ?? '',
          transport: v.transport ?? '자차',
          products: v.products ?? [],
          stageAfter: v.stageAfter ?? '',
          source: 'seed',
        },
      });
    }
    for (const e of events) {
      await this.prisma.event.create({
        data: { id: e.id, date: e.date, title: e.title, kind: e.kind ?? '행사', place: e.place ?? '', who: e.who ?? '', memo: e.memo ?? '' },
      });
    }
    this.logger.log(`auto seed done: staff ${staff.length}, zones ${zones.length}, accounts ${accounts.length}, visits ${visits.length}, events ${events.length}`);
  }
}
