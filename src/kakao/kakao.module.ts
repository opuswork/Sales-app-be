import { Module } from '@nestjs/common';

import { PlansModule } from '../plans/plans.module';
import { ReportsModule } from '../reports/reports.module';
import { VisitsModule } from '../visits/visits.module';
import { KakaoController } from './kakao.controller';
import { KakaoService } from './kakao.service';

@Module({
  imports: [VisitsModule, PlansModule, ReportsModule],
  controllers: [KakaoController],
  providers: [KakaoService],
})
export class KakaoModule {}
