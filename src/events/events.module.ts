import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

export class UpsertEventDto {
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() place?: string;
  @IsOptional() @IsString() who?: string;
  @IsOptional() @IsString() memo?: string;
}

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.prisma.event.findMany({
      where: from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      orderBy: { date: 'asc' },
    });
  }

  @Post()
  create(@Body() dto: UpsertEventDto) {
    return this.prisma.event.create({
      data: { date: dto.date!, title: dto.title!, kind: dto.kind ?? '행사', place: dto.place ?? '', who: dto.who ?? '', memo: dto.memo ?? '' },
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpsertEventDto) {
    return this.prisma.event.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.event.delete({ where: { id } });
    return { ok: true };
  }
}

@Module({ imports: [AuthModule], controllers: [EventsController] })
export class EventsModule {}
