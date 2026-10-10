import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../prisma/prisma.service';

export type AppRole = 'ADMIN' | 'STAFF';

export type JwtPayload = { sub: string; email: string; role: AppRole; typ: 'access' };

export type AuthUserPayload = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  isAdmin: boolean;
};

export const DEV_SECRET = 'sales-app-dev-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? DEV_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUserPayload> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('잘못된 토큰입니다.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
    };
  }
}
