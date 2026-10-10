import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AppRole, AuthUserPayload, DEV_SECRET } from './jwt.strategy';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private accessSeconds() {
    return Number(this.config.get('JWT_ACCESS_SECONDS') ?? 3600);
  }
  private refreshDays() {
    return Number(this.config.get('JWT_REFRESH_DAYS') ?? 90);
  }

  async login(email: string, password: string, device = '') {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    return this.issueTokens(user.id, user.email, user.role, device);
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: AppRole,
    device: string,
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, role, typ: 'access' },
      {
        secret: this.config.get<string>('JWT_SECRET') ?? DEV_SECRET,
        expiresIn: this.accessSeconds(),
      },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshDays() * 86400000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), userAgent: device.slice(0, 200), expiresAt },
    });
    const user = await this.me(userId);
    return {
      accessToken,
      refreshToken,
      accessExpiresIn: this.accessSeconds(),
      refreshExpiresAt: expiresAt.toISOString(),
      user,
    };
  }

  /** 리프레시 토큰 회전: 기존 토큰 폐기 후 새 쌍 발급 (로그인 유지) */
  async refresh(refreshToken: string, device = '') {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!row || row.expiresAt < new Date() || !row.user.active) {
      if (row) await this.prisma.refreshToken.delete({ where: { id: row.id } }).catch(() => null);
      throw new UnauthorizedException('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }
    await this.prisma.refreshToken.delete({ where: { id: row.id } });
    return this.issueTokens(row.userId, row.user.email, row.user.role, device || row.userAgent);
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken
        .deleteMany({ where: { tokenHash: sha256(refreshToken) } })
        .catch(() => null);
    }
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { ok: true };
  }

  async me(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { passwordHash: _ph, ...rest } = u;
    return { ...rest, isAdmin: u.role === 'ADMIN', kakaoLinked: !!u.kakaoUserKey };
  }

  async changePassword(user: AuthUserPayload, currentPassword: string, newPassword: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const ok = await bcrypt.compare(currentPassword, u.passwordHash);
    if (!ok) throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePw: false },
    });
    return { ok: true };
  }

  /** 만료된 리프레시 토큰 정리 */
  async purgeExpired() {
    await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
