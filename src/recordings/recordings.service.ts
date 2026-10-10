import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AuthUserPayload } from '../auth/jwt.strategy';
import { ownerOf, zoneMap } from '../common/domain';
import { todayStr } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';
import { DraftsService } from './drafts.service';
import { StorageService } from './storage.service';

const ALLOWED = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'application/octet-stream'];

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly drafts: DraftsService,
  ) {}

  async upload(file: Express.Multer.File, me: AuthUserPayload, body: { title?: string; recordedAt?: string; staffId?: string }) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    if (!ALLOWED.includes(file.mimetype) && !/\.(m4a|mp3|wav|aac|webm|ogg|mp4)$/i.test(file.originalname)) {
      throw new BadRequestException('오디오 파일(m4a 등)만 업로드할 수 있습니다.');
    }
    const staffId = me.isAdmin && body.staffId ? body.staffId : me.id;
    const { fileUrl } = await this.storage.save(file.buffer, file.originalname, file.mimetype);
    return this.prisma.recording.create({
      data: {
        staffId,
        title: body.title?.trim() || file.originalname.replace(/\.[^.]+$/, ''),
        fileName: file.originalname,
        fileUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        recordedAt: body.recordedAt || todayStr(),
        status: 'QUEUED',
      },
    });
  }

  async list(me: AuthUserPayload, staffId?: string) {
    const where: any = me.isAdmin ? (staffId ? { staffId } : {}) : { staffId: me.id };
    const rows = await this.prisma.recording.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { staff: { select: { id: true, name: true, rank: true } }, drafts: { select: { status: true, kind: true } } },
    });
    return rows.map(({ drafts, transcript, ...r }) => ({
      ...r,
      hasTranscript: !!transcript,
      draftCounts: { pending: drafts.filter((d) => d.status === 'PENDING').length, applied: drafts.filter((d) => d.status === 'APPLIED').length, rejected: drafts.filter((d) => d.status === 'REJECTED').length },
    }));
  }

  async get(id: string, me: AuthUserPayload) {
    const r = await this.prisma.recording.findUnique({
      where: { id },
      include: { staff: { select: { id: true, name: true, rank: true } }, drafts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!r) throw new NotFoundException('녹취를 찾을 수 없습니다.');
    if (!me.isAdmin && r.staffId !== me.id) throw new ForbiddenException('본인 녹취만 볼 수 있습니다.');
    return r;
  }

  async remove(id: string, me: AuthUserPayload) {
    const r = await this.get(id, me);
    await this.storage.remove(r.fileUrl);
    await this.prisma.recording.delete({ where: { id } });
    return { ok: true };
  }

  async retry(id: string, me: AuthUserPayload) {
    const r = await this.get(id, me);
    if (r.transcript) return this.analyze(id);
    return this.prisma.recording.update({ where: { id }, data: { status: 'QUEUED', error: '', claimedBy: '', claimedAt: null } });
  }

  /** 녹취록을 직접 붙여 넣는 경우 (STT 없이) */
  async setTranscript(id: string, transcript: string, durationSec?: number) {
    if (!transcript?.trim()) throw new BadRequestException('녹취록이 비어 있습니다.');
    await this.prisma.recording.update({
      where: { id },
      data: { transcript: transcript.trim(), durationSec: durationSec ?? undefined, status: 'ANALYZING', error: '' },
    });
    return this.analyze(id);
  }

  /** 녹취록 → Anthropic 분석 → 초안 생성 */
  async analyze(id: string) {
    const rec = await this.prisma.recording.findUniqueOrThrow({ where: { id }, include: { staff: true } });
    if (!rec.transcript) throw new BadRequestException('녹취록이 아직 없습니다.');
    if (!this.ai.available()) {
      await this.prisma.recording.update({ where: { id }, data: { status: 'FAILED', error: 'ANTHROPIC_API_KEY 가 설정되지 않아 분석할 수 없습니다.' } });
      throw new BadRequestException('ANTHROPIC_API_KEY 가 설정되지 않았습니다.');
    }
    await this.prisma.recording.update({ where: { id }, data: { status: 'ANALYZING', error: '' } });
    try {
      const [staff, zones, accounts] = await Promise.all([
        this.prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, rank: true, part: true } }),
        this.prisma.zone.findMany({ select: { id: true, name: true, sido: true, channel: true, ownerId: true } }),
        this.prisma.account.findMany({ select: { id: true, name: true, zoneId: true, channel: true, grade: true, stage: true, ownerMode: true, ownerId: true, lastVisit: true } }),
      ]);
      const un = new Map(staff.map((s) => [s.id, s.name]));
      const zm = zoneMap(zones);
      const ex = await this.ai.extractFromTranscript(rec.transcript, {
        today: todayStr(),
        recordedAt: rec.recordedAt || todayStr(),
        recorder: { id: rec.staff.id, name: rec.staff.name, rank: rec.staff.rank, part: rec.staff.part },
        staff,
        zones: zones.map((z) => ({ id: z.id, name: z.name, sido: z.sido, channel: z.channel, ownerName: un.get(z.ownerId ?? '') ?? '' })),
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, zoneName: zm.get(a.zoneId ?? '')?.name ?? '', channel: a.channel, grade: a.grade, stage: a.stage, ownerName: un.get(ownerOf(a, zm)) ?? '' })),
      });
      const n = await this.drafts.createFromExtraction(id, ex);
      await this.prisma.recording.update({ where: { id }, data: { status: 'READY', summary: ex.summary, error: '' } });
      return { ok: true, drafts: n };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      this.logger.error(`analyze ${id} failed: ${msg}`);
      await this.prisma.recording.update({ where: { id }, data: { status: 'FAILED', error: msg.slice(0, 500) } });
      throw new BadRequestException('분석 실패: ' + msg);
    }
  }

  /* ---------- STT 워커용 ---------- */

  /** 가장 오래된 대기 작업 1건 점유 (2시간 넘게 멈춘 작업은 재점유) */
  async claimNext(workerId: string) {
    const stale = new Date(Date.now() - 2 * 3600 * 1000);
    const next = await this.prisma.recording.findFirst({
      where: { OR: [{ status: 'QUEUED' }, { status: 'TRANSCRIBING', claimedAt: { lt: stale } }] },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) return null;
    const r = await this.prisma.recording.update({
      where: { id: next.id },
      data: { status: 'TRANSCRIBING', claimedBy: workerId, claimedAt: new Date(), error: '' },
    });
    return { id: r.id, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, title: r.title };
  }

  async fileFor(id: string) {
    const r = await this.prisma.recording.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    return r;
  }

  async workerTranscript(id: string, transcript: string, durationSec?: number) {
    await this.prisma.recording.update({
      where: { id },
      data: { transcript: transcript.trim(), durationSec: durationSec ?? undefined, status: 'ANALYZING' },
    });
    // 분석은 비동기로 (워커 응답은 바로)
    this.analyze(id).catch(() => null);
    return { ok: true };
  }

  async workerFail(id: string, error: string) {
    await this.prisma.recording.update({ where: { id }, data: { status: 'FAILED', error: error.slice(0, 500) } });
    return { ok: true };
  }
}
