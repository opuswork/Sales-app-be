import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUserPayload } from '../auth/jwt.strategy';
import { AiService } from './ai.service';
import { DraftsService } from './drafts.service';
import { RecordingsService } from './recordings.service';

@ApiTags('recordings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recordings')
export class RecordingsController {
  constructor(
    private readonly recordings: RecordingsService,
    private readonly drafts: DraftsService,
    private readonly ai: AiService,
  ) {}

  @Get()
  list(@CurrentUser() me: AuthUserPayload, @Query('staffId') staffId?: string) {
    return this.recordings.list(me, staffId);
  }

  @Get('status')
  status() {
    return { aiAvailable: this.ai.available(), model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' };
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  upload(
    @CurrentUser() me: AuthUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string; recordedAt?: string; staffId?: string },
  ) {
    return this.recordings.upload(file, me, body);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUserPayload, @Param('id') id: string) {
    return this.recordings.get(id, me);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUserPayload, @Param('id') id: string) {
    return this.recordings.remove(id, me);
  }

  @Post(':id/retry')
  retry(@CurrentUser() me: AuthUserPayload, @Param('id') id: string) {
    return this.recordings.retry(id, me);
  }

  @Post(':id/transcript')
  async transcript(@CurrentUser() me: AuthUserPayload, @Param('id') id: string, @Body() body: { transcript: string; durationSec?: number }) {
    await this.recordings.get(id, me);
    return this.recordings.setTranscript(id, body.transcript, body.durationSec);
  }

  @Post(':id/apply')
  async apply(@CurrentUser() me: AuthUserPayload, @Param('id') id: string, @Body() body: { draftIds?: string[] }) {
    await this.recordings.get(id, me);
    return this.drafts.apply(id, body.draftIds?.length ? body.draftIds : 'all', me);
  }

  @Post(':id/drafts/:draftId/reject')
  async reject(@CurrentUser() me: AuthUserPayload, @Param('id') id: string, @Param('draftId') draftId: string) {
    await this.recordings.get(id, me);
    return this.drafts.reject(draftId);
  }

  @Patch(':id/drafts/:draftId')
  async editDraft(@CurrentUser() me: AuthUserPayload, @Param('id') id: string, @Param('draftId') draftId: string, @Body() body: { payload: any; title?: string }) {
    await this.recordings.get(id, me);
    return this.drafts.updatePayload(draftId, body.payload, body.title);
  }
}
