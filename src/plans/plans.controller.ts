import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUserPayload } from '../auth/jwt.strategy';
import { PlansService } from './plans.service';

@ApiTags('plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('week')
  week(@Query('weekStart') weekStart?: string, @Query('staffId') staffId?: string) {
    return this.plans.week(weekStart ?? '', staffId);
  }

  @Post('generate')
  generate(@CurrentUser() me: AuthUserPayload, @Body() body: { staffId?: string; weekStart?: string }) {
    const staffId = me.isAdmin && body.staffId ? body.staffId : me.id;
    return this.plans.generate(staffId, body.weekStart ?? '');
  }

  @UseGuards(AdminGuard)
  @Post('generate-all')
  generateAll(@Body() body: { weekStart?: string }) {
    return this.plans.generateAll(body.weekStart ?? '');
  }
}
