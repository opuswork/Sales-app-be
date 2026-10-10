import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUserPayload } from '../auth/jwt.strategy';
import { UpsertUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: UpsertUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUserPayload, @Param('id') id: string, @Body() dto: UpsertUserDto) {
    if (!me.isAdmin) {
      if (me.id !== id) throw new ForbiddenException('본인 정보만 수정할 수 있습니다.');
      // 담당자는 연락처·메모·제품만 스스로 수정
      const { phone, note, products } = dto;
      return this.users.update(id, { phone, note, products });
    }
    return this.users.update(id, dto, me);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@CurrentUser() me: AuthUserPayload, @Param('id') id: string) {
    return this.users.remove(id, me);
  }

  @UseGuards(AdminGuard)
  @Post(':id/reset-password')
  resetPassword(@CurrentUser() me: AuthUserPayload, @Param('id') id: string) {
    return this.users.resetPassword(id, me);
  }

  @Post('me/kakao-link-code')
  kakaoLinkCode(@CurrentUser() me: AuthUserPayload) {
    return this.users.issueKakaoLinkCode(me.id);
  }

  @Delete('me/kakao-link')
  unlinkKakao(@CurrentUser() me: AuthUserPayload) {
    return this.users.unlinkKakao(me.id);
  }
}
