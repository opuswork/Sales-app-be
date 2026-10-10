import { Body, Controller, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { KakaoService } from './kakao.service';

/**
 * 카카오 i 오픈빌더 스킬 서버 엔드포인트.
 * 오픈빌더 > 스킬 > URL: https://<api>/api/kakao/skill?key=<KAKAO_SKILL_KEY>
 * 폴백 블록에 이 스킬을 연결하면 모든 사용자 발화가 여기로 온다.
 */
@ApiTags('kakao')
@Controller('kakao')
export class KakaoController {
  constructor(private readonly kakao: KakaoService) {}

  @Get('skill')
  ping(@Query('key') key?: string) {
    this.check(key);
    return { ok: true };
  }

  @Post('skill')
  @HttpCode(200)
  async skill(@Query('key') key: string | undefined, @Headers('x-kakao-skill-key') hkey: string | undefined, @Body() body: any) {
    this.check(key ?? hkey);
    const userKey: string = body?.userRequest?.user?.properties?.botUserKey || body?.userRequest?.user?.id || '';
    const utterance: string = body?.userRequest?.utterance ?? '';
    return this.kakao.handle(userKey, utterance);
  }

  private check(key?: string) {
    const expected = process.env.KAKAO_SKILL_KEY;
    if (!expected || key !== expected) throw new UnauthorizedException('kakao skill key');
  }
}
