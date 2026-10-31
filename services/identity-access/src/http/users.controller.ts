import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ChangeRoleUseCase, CreateUserUseCase, ListUsersUseCase, RevokeUserSessionsUseCase } from '../application/user-admin.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { UserSummary } from '../domain/ports';
import { ChangeRoleDto, CreateUserDto } from './users.dto';

export const LIST_USERS_USE_CASE = 'LIST_USERS_USE_CASE';
export const CREATE_USER_USE_CASE = 'CREATE_USER_USE_CASE';
export const CHANGE_ROLE_USE_CASE = 'CHANGE_ROLE_USE_CASE';
export const REVOKE_SESSIONS_USE_CASE = 'REVOKE_SESSIONS_USE_CASE';
export const USERS_WRITE_RATE_LIMIT = Number(process.env.USERS_WRITE_RATE_LIMIT ?? 30);

/** Contrato público: solo estos campos. Nunca la contraseña ni su hash. */
const toDto = (u: UserSummary) => ({ id: u.id, email: u.email, name: u.name, role: u.role, staffId: u.staffId, createdAt: u.createdAt.toISOString() });
const actorOf = (req: { user: AuthUser }) => req.user.id; // sale del token firmado, jamás del cuerpo
const ctxOf = (req: { user: AuthUser; correlationId?: string }) => ({ actorEmail: req.user.email, correlationId: req.correlationId });

@ApiTags('Users')
@ApiBearerAuth()
@Roles('manager')
@Controller('users')
export class UsersController {
  constructor(
    @Inject(LIST_USERS_USE_CASE) private readonly listUsers: ListUsersUseCase,
    @Inject(CREATE_USER_USE_CASE) private readonly createUser: CreateUserUseCase,
    @Inject(CHANGE_ROLE_USE_CASE) private readonly changeRole: ChangeRoleUseCase,
    @Inject(REVOKE_SESSIONS_USE_CASE) private readonly revokeSessions: RevokeUserSessionsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List users (manager only)' })
  @ApiResponse({ status: 200, description: 'Users, oldest first. Never includes passwords or hashes.' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, tampered or expired token' })
  @ApiResponse({ status: 403, description: 'The role is not manager' })
  async list(@Req() req: { user: AuthUser }) {
    return (await this.listUsers.execute(actorOf(req))).map(toDto);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: USERS_WRITE_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a user with a role and an initial password (manager only)' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 400, description: 'Invalid body or weak password' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, tampered or expired token' })
  @ApiResponse({ status: 403, description: 'The role is not manager' })
  @ApiResponse({ status: 409, description: 'That email is already registered' })
  async create(@Req() req: { user: AuthUser; correlationId?: string }, @Body() dto: CreateUserDto) {
    return toDto(await this.createUser.execute(actorOf(req), dto, ctxOf(req)));
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @Throttle({ default: { limit: USERS_WRITE_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Close every session of a user on all devices (manager only). The user can sign in again; an access token already issued lasts up to 15 minutes' })
  @ApiResponse({ status: 200, description: 'How many renewal tokens were revoked' })
  @ApiResponse({ status: 400, description: 'Invalid id' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, tampered or expired token' })
  @ApiResponse({ status: 403, description: 'The role is not manager' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async revoke(@Req() req: { user: AuthUser }, @Param('id', new ParseUUIDPipe()) id: string) {
    return { revoked: await this.revokeSessions.execute(actorOf(req), id) };
  }

  @Patch(':id/role')
  @Throttle({ default: { limit: USERS_WRITE_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change a user’s role (manager only; not your own; never the last manager). Applies from the next sign-in.' })
  @ApiResponse({ status: 200, description: 'The user with the new role' })
  @ApiResponse({ status: 400, description: 'Invalid id or role' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, tampered or expired token' })
  @ApiResponse({ status: 403, description: 'The role is not manager' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Own role, or the last manager' })
  async role(@Req() req: { user: AuthUser; correlationId?: string }, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ChangeRoleDto) {
    return toDto(await this.changeRole.execute(actorOf(req), id, dto.role, ctxOf(req)));
  }
}
