import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return { ok: true, service: 'sales-app-be', time: new Date().toISOString() };
  }
}
