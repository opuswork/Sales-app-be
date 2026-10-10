import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { CHANNELS, GRADES, PRODUCTS, STAGES, VISIT_TYPES } from '../common/constants';

/** 녹취 분석 결과 스키마 (구조화 출력) */
export const ExtractionSchema = z.object({
  summary: z.string().describe('녹취 전체 요약 3~5문장'),
  visits: z.array(
    z.object({
      accountName: z.string(),
      accountId: z.string().nullable().describe('기존 거래처 목록의 id. 모르면 null'),
      date: z.string().describe('YYYY-MM-DD'),
      type: z.enum(VISIT_TYPES),
      content: z.string(),
      followup: z.string(),
      companion: z.string(),
      products: z.array(z.string()),
      stageAfter: z.string().nullable().describe('진행 단계가 바뀌었으면 새 단계명, 아니면 null'),
      confidence: z.number().describe('0~1'),
      evidence: z.string().describe('근거가 된 녹취 문장'),
    }),
  ),
  accounts: z.array(
    z.object({
      action: z.enum(['create', 'update']),
      accountId: z.string().nullable(),
      name: z.string(),
      zoneId: z.string().nullable(),
      zoneName: z.string().nullable(),
      channel: z.enum(CHANNELS),
      grade: z.enum(['S', 'A', 'B']),
      stage: z.enum(STAGES),
      nextAction: z.string(),
      nextDate: z.string().nullable(),
      memo: z.string(),
      products: z.array(z.string()),
      confidence: z.number(),
      evidence: z.string(),
    }),
  ),
  zones: z.array(
    z.object({
      action: z.enum(['create', 'update']),
      zoneId: z.string().nullable(),
      name: z.string(),
      sido: z.string(),
      area: z.string(),
      channel: z.enum(CHANNELS),
      difficulty: z.number(),
      note: z.string(),
      confidence: z.number(),
      evidence: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      date: z.string(),
      title: z.string(),
      kind: z.string().describe('행사/교육/회의/박람회/마감/공동구매/마케팅'),
      place: z.string(),
      who: z.string(),
      memo: z.string(),
      confidence: z.number(),
      evidence: z.string(),
    }),
  ),
  plans: z.array(
    z.object({
      staffName: z.string(),
      staffId: z.string().nullable(),
      date: z.string(),
      accountName: z.string(),
      accountId: z.string().nullable(),
      reason: z.string(),
      confidence: z.number(),
      evidence: z.string(),
    }),
  ),
  assignments: z.array(
    z.object({
      zoneId: z.string().nullable(),
      zoneName: z.string(),
      staffName: z.string(),
      staffId: z.string().nullable(),
      reason: z.string(),
      confidence: z.number(),
      evidence: z.string(),
    }),
  ),
  report: z.object({
    title: z.string(),
    markdown: z.string().describe('영업·마케팅 보고서 (마크다운). 활동 요약, 거래처별 진행, 리스크, 다음 액션'),
  }),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const KakaoCheckinSchema = z.object({
  isCheckin: z.boolean().describe('영업 활동(방문·전화·미팅) 보고로 볼 수 있으면 true'),
  accountName: z.string(),
  accountId: z.string().nullable(),
  date: z.string().describe('YYYY-MM-DD, 언급 없으면 오늘'),
  type: z.enum(VISIT_TYPES),
  content: z.string(),
  followup: z.string(),
  stageAfter: z.string().nullable(),
  products: z.array(z.string()),
});
export type KakaoCheckin = z.infer<typeof KakaoCheckinSchema>;

export type ExtractContext = {
  today: string;
  recordedAt: string;
  recorder: { id: string; name: string; rank: string; part: string };
  staff: { id: string; name: string; rank: string; part: string }[];
  zones: { id: string; name: string; sido: string; channel: string; ownerName: string }[];
  accounts: { id: string; name: string; zoneName: string; channel: string; grade: string; stage: string; ownerName: string }[];
};

const SYSTEM_EXTRACT = `당신은 식품회사(신앙촌식품: 간장·발효유 '런'·양재·메리야스·두부) 영업부의 영업 비서입니다.
담당자가 녹음한 영업 활동·미팅·회의 녹취록을 읽고, 앱의 데이터(구역·거래처·방문 체크인·영업일정·행사·구역 배정)로 바로 반영할 수 있게 구조화합니다.

규칙:
- 녹취에 실제로 언급된 사실만 추출합니다. 추측으로 채우지 말고, 모르면 빈 문자열이나 null 로 둡니다.
- 기존 거래처·구역·담당자 목록과 이름이 같거나 명백히 같은 곳이면 반드시 그 id 를 사용합니다(accountId/zoneId/staffId). 목록에 없으면 null 로 두고 이름만 적습니다.
- 거래처가 목록에 없는데 방문·상담이 있었으면 accounts 에 action=create 로도 추가합니다.
- 등급 기준: S=월 500만 이상 Key Account(대형 급식위탁사·대형마트·대기업 B2B), A=월 200만(병원·프랜차이즈·식자재유통·폐쇄몰), B=월 80만(산후조리원·노인복지·상회 상권·학교급식).
- 진행 단계: ${STAGES.join(' → ')}.
- 날짜는 녹음일(recordedAt)을 기준으로 "어제/다음 주 화요일" 같은 상대 표현을 YYYY-MM-DD 로 환산합니다.
- 방문 체크인(visits)은 녹음한 담당자 본인의 활동입니다. 상담 내용은 미팅보고서처럼 핵심 사실·수치·요청사항 위주로 적습니다.
- 다음에 할 일이 날짜와 함께 언급되면 plans 에 넣습니다(담당자명 포함). 구역 담당 변경 언급이 있으면 assignments 에 넣습니다.
- report.markdown 은 팀장 보고용 영업·마케팅 보고서로, '# 제목', '## 활동 요약', '## 거래처별 진행 상황', '## 마케팅·제휴', '## 리스크·이슈', '## 다음 액션' 구성으로 씁니다.
- confidence 는 녹취 근거의 명확성(0~1). 사람 이름·업체명이 음성 인식으로 틀렸을 가능성이 있으면 낮게 줍니다.
- 모든 텍스트는 한국어.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  private get model() {
    return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  }

  available() {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private getClient() {
    if (!this.available()) throw new Error('ANTHROPIC_API_KEY 가 설정되지 않았습니다.');
    if (!this.client) this.client = new Anthropic({ timeout: 10 * 60 * 1000, maxRetries: 2 });
    return this.client;
  }

  /** 녹취록 → 구조화된 초안 */
  async extractFromTranscript(transcript: string, ctx: ExtractContext): Promise<Extraction> {
    const client = this.getClient();
    const context = {
      today: ctx.today,
      recordedAt: ctx.recordedAt,
      recorder: ctx.recorder,
      staff: ctx.staff,
      zones: ctx.zones,
      accounts: ctx.accounts,
      channels: CHANNELS,
      grades: Object.fromEntries(Object.entries(GRADES).map(([k, v]) => [k, v.label])),
      products: PRODUCTS,
    };
    const user = `## 기준 데이터 (JSON)\n${JSON.stringify(context)}\n\n## 녹취록\n${transcript}`;
    const response = await client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_EXTRACT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });
    if (response.stop_reason === 'refusal') throw new Error('분석이 거부되었습니다 (refusal).');
    if (!response.parsed_output) throw new Error('분석 결과를 해석하지 못했습니다. 다시 시도해 주세요.');
    this.logger.log(`extract usage in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
    return response.parsed_output;
  }

  /** 보고서 텍스트 → 요약·코멘트 */
  async summarizeReport(markdown: string): Promise<string> {
    const client = this.getClient();
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: `당신은 식품회사 영업부(간장·발효유 런·양재·메리야스) 팀장의 보조입니다. 아래 보고서를 읽고 한국어로 (1) 핵심 요약 3줄, (2) 리스크·중복·미방문 관련 주의 2가지, (3) 다음 주 담당별 권고 액션을 담당 이름별 한 줄씩 작성하세요. 간결하게, 마크다운 없이 줄글과 하이픈 목록만 사용합니다.\n\n${markdown.slice(0, 40000)}`,
        },
      ],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  /** 카카오톡 채널 메시지 → 체크인 (5초 안에 응답해야 하므로 빠른 모델·낮은 effort) */
  async parseKakaoCheckin(
    utterance: string,
    today: string,
    accounts: { id: string; name: string; stage: string }[],
  ): Promise<KakaoCheckin | null> {
    if (!this.available()) return null;
    const client = this.getClient();
    try {
      const res = await client.messages.parse(
        {
          model: process.env.ANTHROPIC_KAKAO_MODEL || 'claude-haiku-5-5',
          max_tokens: 1024,
          output_config: { effort: 'low', format: zodOutputFormat(KakaoCheckinSchema) },
          messages: [
            {
              role: 'user',
              content: `영업 담당자가 카카오톡으로 보낸 활동 보고를 체크인 데이터로 바꿉니다. 오늘=${today}. 담당 거래처 목록(JSON): ${JSON.stringify(accounts)}\n거래처명이 목록과 같거나 명백히 같으면 accountId 를 채우고, 없으면 null 과 이름만. 진행 단계 목록: ${STAGES.join(', ')}. 제품: ${PRODUCTS.join(', ')}.\n\n메시지: """${utterance}"""`,
            },
          ],
        },
        { timeout: 4500 },
      );
      return res.parsed_output ?? null;
    } catch (e) {
      this.logger.warn(`kakao parse failed: ${(e as Error).message}`);
      return null;
    }
  }
}
