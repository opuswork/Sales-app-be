import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUserPayload } from '../auth/jwt.strategy';
import { UpsertVisitDto } from './visits.dto';
import { VisitsService } from './visits.service';

@ApiTags('visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  list(
    @Query('staffId') staffId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.visits.list({ staffId, from, to, accountId });
  }

  @Get('warnings')
  warnings(
    @CurrentUser() me: AuthUserPayload,
    @Query('accountId') accountId: string,
    @Query('staffId') staffId?: string,
    @Query('excludeVisitId') excludeVisitId?: string,
  ) {
    return this.visits.warnings(accountId, staffId || me.id, excludeVisitId);
  }

  @Post()
  create(@CurrentUser() me: AuthUserPayload, @Body() dto: UpsertVisitDto) {
    return this.visits.create(dto, me);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUserPayload, @Param('id') id: string, @Body() dto: UpsertVisitDto) {
    return this.visits.update(id, dto, me);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUserPayload, @Param('id') id: string) {
    return this.visits.remove(id, me);
  }
}
