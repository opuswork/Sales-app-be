import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { UpsertUserDto } from './dto/user.dto';

const PUBLIC_SELECT = {
  id: true,
  email: true,
  role: true,
  active: true,
  mustChangePw: true,
  name: true,
  rank: true,
  part: true,
  roleDesc: true,
  base: true,
  exp: true,
  skills: true,
  products: true,
  field: true,
  zoneCap: true,
  capacity: true,
  note: true,
  phone: true,
  kakaoUserKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({
      select: { ...PUBLIC_SELECT, zones: { select: { id: true, name: true } }, _count: { select: { recordings: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({ ...u, kakaoLinked: !!u.kakaoUserKey, kakaoUserKey: undefined }));
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_SELECT });
    if (!u) throw new NotFoundException('담당자를 찾을 수 없습니다.');
    return { ...u, kakaoLinked: !!u.kakaoUserKey, kakaoUserKey: undefined };
  }

  async create(dto: UpsertUserDto) {
    if (!dto.email || !dto.name) throw new BadRequestException('이메일과 이름은 필수입니다.');
    const password = dto.password ?? this.tempPassword();
    const { password: _p, email, ...rest } = dto;
    const u = await this.prisma.user.create({
      data: {
        ...rest,
        name: dto.name,
        email: email!.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePw: !dto.password,
        skills: rest.skills ?? {},
        products: rest.products ?? [],
      },
      select: PUBLIC_SELECT,
    });
    // 임시 비밀번호는 생성 응답에 한 번만 포함 (관리자가 담당자에게 전달)
    return { ...u, tempPassword: dto.password ? undefined : password };
  }

  async update(id: string, dto: UpsertUserDto) {
    const { password, email, ...rest } = dto;
    const data: any = { ...rest };
    if (email) data.email = email.toLowerCase().trim();
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
      data.mustChangePw = true;
    }
    return this.prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }

  async resetPassword(id: string) {
    const password = this.tempPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePw: true },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    return { tempPassword: password };
  }

  /** 카카오 채널 연결 코드 발급 (10분 유효). 채널에 "연결 123456" 전송 */
  async issueKakaoLinkCode(userId: string) {
    await this.prisma.kakaoLinkCode.deleteMany({ where: { userId } });
    const code = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60000);
    await this.prisma.kakaoLinkCode.create({ data: { code, userId, expiresAt } });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async unlinkKakao(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { kakaoUserKey: null } });
    return { ok: true };
  }

  private tempPassword() {
    return 'sales' + String(randomInt(1000, 9999)) + '!';
  }
}
