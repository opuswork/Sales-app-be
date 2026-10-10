import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CHANNELS, GRADES, PARTS, PRODUCTS, RANKS, SIDOS, STAGES, TRANSPORTS, VISIT_TYPES } from '../common/constants';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get() {
    return {
      ...(await this.settings.get()),
      constants: {
        channels: CHANNELS,
        products: PRODUCTS,
        ranks: Object.keys(RANKS),
        parts: PARTS,
        grades: GRADES,
        stages: STAGES,
        visitTypes: VISIT_TYPES,
        transports: TRANSPORTS,
        sidos: SIDOS,
      },
    };
  }

  @UseGuards(AdminGuard)
  @Patch()
  update(@Body() body: any) {
    return this.settings.update(body);
  }
}
