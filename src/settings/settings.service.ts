import { Injectable } from '@nestjs/common';

import { AppSettings, DEFAULT_SETTINGS } from '../common/constants';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AppSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'app' } });
    const v = (row?.value as Partial<AppSettings>) ?? {};
    return {
      ...DEFAULT_SETTINGS,
      ...v,
      weights: { ...DEFAULT_SETTINGS.weights, ...(v.weights ?? {}) },
    };
  }

  async update(patch: Partial<AppSettings>) {
    const cur = await this.get();
    const next: AppSettings = {
      ...cur,
      ...patch,
      weights: { ...cur.weights, ...(patch.weights ?? {}) },
    };
    await this.prisma.setting.upsert({
      where: { key: 'app' },
      create: { key: 'app', value: next },
      update: { value: next },
    });
    return next;
  }
}
