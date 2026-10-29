import { Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { InboxUseCases } from '../application/inbox.use-cases';

export const INBOX = 'INBOX_USE_CASES';

class ListQuery {
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() unread?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset?: number;
}

/** Cualquier rol con sesión: cada quien ve los avisos de SU rol y sus propias marcas de lectura (el rol sale del token firmado). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(INBOX) private readonly inbox: InboxUseCases) {}

  @Get()
  list(@Req() req: any, @Query() q: ListQuery) {
    return this.inbox.list(req.user, { unreadOnly: q.unread ?? false, limit: q.limit ?? 30, offset: q.offset ?? 0 });
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) { return this.inbox.unreadCount(req.user); }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Req() req: any) { return this.inbox.markAllRead(req.user); }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    if (!(await this.inbox.markRead(req.user, id))) throw new NotFoundException('Notification not found');
  }
}
