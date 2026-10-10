import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlansModule } from '../plans/plans.module';
import { ReportsModule } from '../reports/reports.module';
import { VisitsModule } from '../visits/visits.module';
import { DraftsService } from './drafts.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { StorageService } from './storage.service';
import { WorkerController } from './worker.controller';

@Module({
  imports: [AuthModule, VisitsModule, PlansModule, ReportsModule],
  controllers: [RecordingsController, WorkerController],
  providers: [RecordingsService, StorageService, DraftsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
