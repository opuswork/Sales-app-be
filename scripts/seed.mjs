// 초기 데이터 적재: prisma/seed-data/*.json (Notion 조직도·엑셀 기준 예시 데이터)
//   npm run seed
// 이미 같은 id 가 있으면 건너뛴다 (멱등). 관리자 계정은 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
import 'dotenv/config';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../dist/generated/prisma/client');

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'prisma', 'seed-data');

function load(dir) {
  const d = join(DATA, dir);
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

const conn = process.env.DATABASE_URL;
if (!conn) throw new Error('DATABASE_URL is not set');
const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(conn);
const pool = new pg.Pool(local ? { connectionString: conn } : { connectionString: conn.replace(/[?&]sslmode=require/, ''), ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'change-me-1234';
const STAFF_PW = process.env.SEED_STAFF_PASSWORD || 'sales1234!';

async function main() {
  const staff = load('staff');
  const zones = load('zones');
  const accounts = load('accounts');
  const visits = load('visits');
  const events = load('events');

  const staffHash = await bcrypt.hash(STAFF_PW, 10);
  const adminHash = await bcrypt.hash(ADMIN_PW, 10);
  let created = { staff: 0, zones: 0, accounts: 0, visits: 0, events: 0 };

  for (const s of staff) {
    const isAdmin = s.part === '총괄' || s.rank === '부장';
    const exists = await prisma.user.findUnique({ where: { id: s.id } });
    if (exists) continue;
    await prisma.user.create({
      data: {
        id: s.id,
        email: isAdmin ? ADMIN_EMAIL : `${s.id}@sales-app.local`,
        passwordHash: isAdmin ? adminHash : staffHash,
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
    created.staff++;
  }

  let order = 0;
  for (const z of zones) {
    order++;
    if (await prisma.zone.findUnique({ where: { id: z.id } })) continue;
    await prisma.zone.create({
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
        assignedAt: z.assignedAt ? new Date(z.assignedAt) : null,
        sortOrder: order,
      },
    });
    created.zones++;
  }

  for (const a of accounts) {
    if (await prisma.account.findUnique({ where: { id: a.id } })) continue;
    await prisma.account.create({
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
    created.accounts++;
  }

  for (const v of visits) {
    if (await prisma.visit.findUnique({ where: { id: v.id } })) continue;
    await prisma.visit.create({
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
    created.visits++;
  }

  for (const e of events) {
    if (await prisma.event.findUnique({ where: { id: e.id } })) continue;
    await prisma.event.create({
      data: { id: e.id, date: e.date, title: e.title, kind: e.kind ?? '행사', place: e.place ?? '', who: e.who ?? '', memo: e.memo ?? '' },
    });
    created.events++;
  }

  console.log('seeded:', created);
  console.log(`admin login: ${ADMIN_EMAIL} / (SEED_ADMIN_PASSWORD)`);
  console.log(`staff login: <id>@sales-app.local / ${STAFF_PW}  (예: s3@sales-app.local)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
