import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ChangeRoleUseCase, CreateUserUseCase, ListUsersUseCase } from '../application/user-admin.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { UserSummary } from '../domain/ports';
import { ChangeRoleDto, CreateUserDto } from './users.dto';

export const LIST_USERS_USE_CASE = 'LIST_USERS_USE_CASE';
export const CREATE_USER_USE_CASE = 'CREATE_USER_USE_CASE';
export const CHANGE_ROLE_USE_CASE = 'CHANGE_ROLE_USE_CASE';
export const USERS_WRITE_RATE_LIMIT = Number(process.env.USERS_WRITE_RATE_LIMIT ?? 30);

/** Contrato público: solo estos campos. Nunca la contraseña ni su hash. */
const toDto = (u: UserSummary) => ({ id: u.id, email: u.email, name: u.name, role: u.role, staffId: u.staffId, createdAt: u.createdAt.toISOString() });
const actorOf = (req: { user: AuthUser }) => req.user.id; // sale del token firmado, jamás del cuerpo

@ApiTags('Users')
@ApiBearerAuth()
@Roles('manager')
@Controller('users')
export class UsersController {
  constructor(
    @Inject(LIST_USERS_USE_CASE) private readonly listUsers: ListUsersUseCase,
    @Inject(CREATE_USER_USE_CASE) private readonly createUser: CreateUserUseCase,
    @Inject(CHANGE_ROLE_USE_CASE) private readonly changeRole: ChangeRoleUseCase,
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
  async create(@Req() req: { user: AuthUser }, @Body() dto: CreateUserDto) {
    return toDto(await this.createUser.execute(actorOf(req), dto));
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
  async role(@Req() req: { user: AuthUser }, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ChangeRoleDto) {
    return toDto(await this.changeRole.execute(actorOf(req), id, dto.role));
  }
}
