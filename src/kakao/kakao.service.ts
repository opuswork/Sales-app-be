import { Injectable, Logger } from '@nestjs/common';

import { STAGES } from '../common/constants';
import { addDays, DOW, parseD, todayStr, weekStartOf } from '../common/dates';
import { nameMatches, ownerOf, zoneMap } from '../common/domain';
import { PlansService, PlanItem } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../recordings/ai.service';
import { ReportsService } from '../reports/reports.service';
import { VisitsService } from '../visits/visits.service';

const HELP = `영업 체크인 봇 사용법
· 체크인: "다이클로 일광점 방문. 물류센터 일괄입고 협의, 다음주 견적서 송부"
· 전화/미팅도 "OO 전화 …", "OO 미팅 …" 으로 보내면 구분을 자동 인식합니다.
· "일정" → 이번 주 내 방문 계획
· "실적" → 내 영업실적 요약
· "연결 123456" → 앱에서 발급한 코드로 계정 연결`;

@Injectable()
export class KakaoService {
  private readonly logger = new Logger(KakaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly visits: VisitsService,
    private readonly plans: PlansService,
    private readonly reports: ReportsService,
  ) {}

  /** 카카오 i 오픈빌더 스킬 서버 응답 형식 */
  reply(text: string) {
    return { version: '2.0', template: { outputs: [{ simpleText: { text } }] } };
  }

  async handle(userKey: string, utteranceRaw: string) {
    const utterance = (utteranceRaw ?? '').trim();
    if (!userKey) return this.reply('사용자 정보를 확인할 수 없습니다.');
    const log = await this.prisma.kakaoMessage.create({ data: { userKey, utterance } });
    const text = await this.route(userKey, utterance, log.id);
    await this.prisma.kakaoMessage.update({ where: { id: log.id }, data: { reply: text.slice(0, 1000) } });
    return this.reply(text);
  }

  private async route(userKey: string, utterance: string, logId: string): Promise<string> {
    // 1) 계정 연결
    const link = utterance.match(/^연결\s*(\d{6})$/);
    if (link) return this.link(userKey, link[1]);

    const user = await this.prisma.user.findUnique({ where: { kakaoUserKey: userKey } });
    if (!user) {
      return '아직 계정이 연결되지 않았습니다.\n앱 → 내 화면 → "카카오톡 연결"에서 6자리 코드를 받아 "연결 123456" 으로 보내 주세요.';
    }
    if (!utterance || /^(도움말|help|\?)$/i.test(utterance)) return HELP;
    if (/^(일정|오늘 일정|이번주 일정|이번 주 일정)$/.test(utterance)) return this.schedule(user.id);
    if (/^(실적|내 실적|현황)$/.test(utterance)) return this.performance(user.id);
    return this.checkin(user, utterance, logId);
  }

  private async link(userKey: string, code: string) {
    const row = await this.prisma.kakaoLinkCode.findUnique({ where: { code }, include: { user: true } });
    if (!row || row.expiresAt < new Date()) return '연결 코드가 없거나 만료되었습니다. 앱에서 코드를 다시 발급해 주세요.';
    await this.prisma.user.updateMany({ where: { kakaoUserKey: userKey }, data: { kakaoUserKey: null } });
    await this.prisma.user.update({ where: { id: row.userId }, data: { kakaoUserKey: userKey } });
    await this.prisma.kakaoLinkCode.delete({ where: { code } });
    return `${row.user.name} ${row.user.rank}님, 카카오톡이 연결되었습니다.\n이제 활동 내용을 보내면 자동으로 체크인됩니다.\n\n${HELP}`;
  }

  private async schedule(staffId: string) {
    const T = todayStr();
    const w = await this.plans.week(weekStartOf(T), staffId);
    const plan = w.plans[0];
    if (!plan || !plan.items.length) return '이번 주 방문 계획이 없습니다. 앱의 내 화면에서 "일정 자동 생성"을 눌러 주세요.';
    const lines: string[] = [`이번 주 일정 (${w.weekStart}~${w.weekEnd})`];
    for (let d = 0; d < 6; d++) {
      const its = (plan.items as (PlanItem & { accountName: string; done: boolean })[]).filter((it) => it.day === d);
      if (!its.length) continue;
      const date = addDays(w.weekStart, d);
      lines.push(`\n${DOW[parseD(date).getDay()]} ${date.slice(5)}${date === T ? ' (오늘)' : ''}`);
      its.forEach((it) => lines.push(`${it.done ? '✅' : '▫'} ${it.accountName}${it.reason ? ' — ' + it.reason : ''}`));
    }
    return lines.join('\n');
  }

  private async performance(staffId: string) {
    const p = await this.reports.myPage(staffId);
    if (!p) return '담당자 정보를 찾을 수 없습니다.';
    const k = p.kpis;
    const tg = p.target;
    return [
      `${p.staff.name} ${p.staff.rank} 영업실적`,
      `· 담당 거래처 ${k.accounts}곳 / 구역 ${k.zones}곳`,
      `· 계약 이상 ${k.contracted}곳 (S ${p.grades.S} / A ${p.grades.A} / B ${p.grades.B}${tg ? ` · 목표 ${tg.S}/${tg.A}/${tg.B}` : ''})`,
      `· 환산 월 거래액 ${k.amount.toLocaleString()}만${tg ? ` / 목표 ${tg.amount.toLocaleString()}만` : ''}`,
      `· 이번 주 활동 ${k.weekVisits}건 / 가능 ${p.staff.capacity}건`,
      `· 미방문 경고 ${k.unvisited}건 · 이번 달 평가 ${k.score}점`,
      p.unvisited.length ? `\n먼저 챙길 곳: ${p.unvisited.slice(0, 3).map((a) => `${a.name}(+${a.overdue}일)`).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async checkin(user: { id: string; name: string }, utterance: string, logId: string) {
    const T = todayStr();
    const [accounts, zones] = await Promise.all([this.prisma.account.findMany(), this.prisma.zone.findMany({ select: { id: true, ownerId: true } })]);
    const zm = zoneMap(zones);
    const mine = accounts.filter((a) => ownerOf(a, zm) === user.id);
    const candidates = (mine.length ? mine : accounts).map((a) => ({ id: a.id, name: a.name, stage: a.stage }));

    let parsed = await this.ai.parseKakaoCheckin(utterance, T, candidates);
    if (!parsed) parsed = this.fallbackParse(utterance, T, accounts.map((a) => ({ id: a.id, name: a.name })));
    if (!parsed || !parsed.isCheckin || !parsed.accountName) {
      return '활동 보고로 인식하지 못했습니다. "업체명 방문/전화/미팅. 내용" 형식으로 보내 주세요.\n\n' + HELP;
    }
    let acc = parsed.accountId ? accounts.find((a) => a.id === parsed!.accountId) : undefined;
    if (!acc) acc = accounts.find((a) => a.name === parsed!.accountName) ?? accounts.find((a) => nameMatches(a.name, parsed!.accountName));
    if (!acc) {
      return `"${parsed.accountName}" 거래처를 찾지 못했습니다. 앱에서 먼저 거래처를 등록하거나 업체명을 정확히 적어 주세요.`;
    }
    const warn = await this.visits.warnings(acc.id, user.id);
    const visit = await this.visits.create(
      {
        date: parsed.date || T,
        accountId: acc.id,
        type: parsed.type || '방문',
        content: parsed.content || utterance,
        followup: parsed.followup || '',
        products: parsed.products ?? [],
        stageAfter: parsed.stageAfter && (STAGES as readonly string[]).includes(parsed.stageAfter) ? parsed.stageAfter : '',
        transport: '자차',
      },
      { id: user.id, email: '', name: user.name, role: 'STAFF', isAdmin: false },
      'kakao',
    );
    await this.prisma.kakaoMessage.update({ where: { id: logId }, data: { parsed: parsed as any, visitId: visit.id } });
    const lines = [`✅ 체크인 완료 — ${acc.name}`, `${visit.date} [${visit.type}] ${visit.content}`];
    if (visit.followup) lines.push(`차기: ${visit.followup}`);
    if (visit.stageAfter) lines.push(`단계 → ${visit.stageAfter}`);
    if (warn.ownerMismatch) lines.push(`⚠ 이 거래처 담당은 ${warn.ownerMismatch.ownerName}입니다. 진행 중이면 인사 후 철수, 홍보 수준만 진행하세요.`);
    if (warn.recentOthers.length) lines.push(`⚠ 7일 내 타 담당 접촉: ${warn.recentOthers.map((r) => `${r.staffName} ${r.date.slice(5)}`).join(', ')}`);
    return lines.join('\n');
  }

  /** API 키가 없거나 시간 초과일 때: 업체명 매칭 + 구분 키워드 */
  private fallbackParse(utterance: string, today: string, accounts: { id: string; name: string }[]) {
    const hit = accounts.find((a) => utterance.includes(a.name)) ?? accounts.find((a) => nameMatches(a.name, utterance.split(/[\s,.]/)[0] ?? ''));
    if (!hit) return null;
    const type = /전화|통화/.test(utterance) ? '전화' : /미팅|회의/.test(utterance) ? '미팅' : /행사|박람회|마케팅/.test(utterance) ? '마케팅·행사' : /관장/.test(utterance) ? '관장님문의' : '방문';
    const content =
      utterance
        .replace(hit.name, '')
        .replace(/^[\s,.:·-]*(방문|전화|통화|미팅|회의)?[\s,.:·-]*/, '')
        .trim() || utterance;
    return { isCheckin: true, accountName: hit.name, accountId: hit.id, date: today, type: type as any, content, followup: '', stageAfter: null, products: [] as string[] };
  }
}
