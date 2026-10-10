import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AccountsModule } from './accounts/accounts.module';
import { AppController } from './app.controller';
import { AssignmentModule } from './assignment/assignment.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { KakaoModule } from './kakao/kakao.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './recordings/ai.module';
import { RecordingsModule } from './recordings/recordings.module';
import { ReportsModule } from './reports/reports.module';
import { SeedModule } from './seed/seed.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { VisitsModule } from './visits/visits.module';
import { ZonesModule } from './zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AiModule,
    AuthModule,
    UsersModule,
    ZonesModule,
    AccountsModule,
    VisitsModule,
    PlansModule,
    EventsModule,
    SettingsModule,
    AssignmentModule,
    ReportsModule,
    RecordingsModule,
    KakaoModule,
    SeedModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
