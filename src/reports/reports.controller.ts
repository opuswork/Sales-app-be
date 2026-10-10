import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUserPayload } from '../auth/jwt.strategy';
import { AiService } from '../recordings/ai.service';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly ai: AiService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('me/page')
  myPage(@CurrentUser() me: AuthUserPayload, @Query('staffId') staffId?: string) {
    return this.reports.myPage(me.isAdmin && staffId ? staffId : me.id);
  }

  @Get('reports')
  async report(@Query('kind') kind = 'weekly', @Query('period') period = 'thisWeek') {
    const k = (['weekly', 'marketing', 'eval'].includes(kind) ? kind : 'weekly') as 'weekly' | 'marketing' | 'eval';
    const [md, per, stats] = await Promise.all([
      this.reports.markdown(k, period),
      this.reports.perStaff(period),
      this.reports.channelStats(period),
    ]);
    return { ...md, perStaff: per, stats, aiAvailable: this.ai.available() };
  }

  @Get('reports/saved')
  saved() {
    return this.reports.saved();
  }

  @Post('reports/save')
  save(@Body() body: { kind: string; period: string; title: string; markdown: string }) {
    return this.reports.save(body.kind, body.period, body.title, body.markdown);
  }

  /** AI 요약·코멘트 (Anthropic API) */
  @Post('reports/summarize')
  async summarize(@Body() body: { kind?: string; period?: string }) {
    const k = (['weekly', 'marketing', 'eval'].includes(body.kind ?? '') ? body.kind : 'weekly') as 'weekly' | 'marketing' | 'eval';
    const md = await this.reports.markdown(k, body.period ?? 'thisWeek');
    const text = await this.ai.summarizeReport(md.markdown);
    return { text };
  }
}
