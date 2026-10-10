import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUserPayload } from '../auth/jwt.strategy';
import { UpsertAccountDto } from './accounts.dto';
import { AccountsService } from './accounts.service';

@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query('ownerId') ownerId?: string, @Query('zoneId') zoneId?: string, @Query('q') q?: string) {
    return this.accounts.list({ ownerId, zoneId, q });
  }

  @Get('dupes')
  dupes(@Query('name') name: string, @Query('excludeId') excludeId?: string) {
    return this.accounts.dupes(name ?? '', excludeId);
  }

  @Post()
  create(@CurrentUser() me: AuthUserPayload, @Body() dto: UpsertAccountDto) {
    return this.accounts.create(dto, me.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpsertAccountDto) {
    return this.accounts.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
