import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssignmentService } from './assignment.service';

@ApiTags('assignment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('assignment')
export class AssignmentController {
  constructor(private readonly assignment: AssignmentService) {}

  @Post('run')
  run() {
    return this.assignment.run();
  }

  @Post('apply')
  apply(@Body() body: { rows: { zoneId: string; staffId: string }[] }) {
    return this.assignment.apply(body.rows ?? []);
  }
}
