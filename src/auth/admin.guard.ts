import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { AuthUserPayload } from './jwt.strategy';

/** JwtAuthGuard 뒤에 붙여 ADMIN 만 통과 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUserPayload }>();
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('관리자(부장·총괄)만 할 수 있습니다.');
    }
    return true;
  }
}
