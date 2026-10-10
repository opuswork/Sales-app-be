import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RecordingsService } from './recordings.service';
import { StorageService } from './storage.service';

/** 이 PC 의 STT 워커가 쓰는 토큰 인증 (헤더 x-worker-token) */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const expected = process.env.WORKER_TOKEN;
    const got = req.headers['x-worker-token'];
    if (!expected || !got || got !== expected) throw new UnauthorizedException('worker token');
    return true;
  }
}

@ApiTags('worker')
@UseGuards(WorkerTokenGuard)
@Controller('worker')
export class WorkerController {
  constructor(
    private readonly recordings: RecordingsService,
    private readonly storage: StorageService,
  ) {}

  @Post('jobs/next')
  next(@Body() body: { workerId?: string }) {
    return this.recordings.claimNext(body.workerId ?? 'worker');
  }

  @Get('recordings/:id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const r = await this.recordings.fileFor(id);
    if (this.storage.isLocal(r.fileUrl)) {
      res.setHeader('Content-Type', r.mimeType || 'application/octet-stream');
      this.storage.stream(r.fileUrl).pipe(res);
      return;
    }
    res.redirect(r.fileUrl);
  }

  @Post('jobs/:id/transcript')
  transcript(@Param('id') id: string, @Body() body: { transcript: string; durationSec?: number }) {
    return this.recordings.workerTranscript(id, body.transcript ?? '', body.durationSec);
  }

  @Post('jobs/:id/fail')
  fail(@Param('id') id: string, @Body() body: { error?: string }) {
    return this.recordings.workerFail(id, body.error ?? 'unknown');
  }
}
