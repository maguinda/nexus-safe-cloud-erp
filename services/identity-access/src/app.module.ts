import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { LoginUseCase } from './application/login.use-case';
import { SessionService } from './application/session.service';
import { SetLanguageUseCase } from './application/set-language.use-case';
import { SetThemeUseCase } from './application/set-theme.use-case';
import { ChangeRoleUseCase, CreateUserUseCase, ListUsersUseCase, RevokeUserSessionsUseCase } from './application/user-admin.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { AuthController, COOKIE_SECURE, LOGIN_USE_CASE, SESSION_SERVICE } from './http/auth.controller';
import { HealthController } from './http/health.controller';
import { MeController, SET_LANGUAGE_USE_CASE, SET_THEME_USE_CASE } from './http/me.controller';
import { CHANGE_ROLE_USE_CASE, CREATE_USER_USE_CASE, LIST_USERS_USE_CASE, REVOKE_SESSIONS_USE_CASE, UsersController } from './http/users.controller';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { PrismaRefreshTokenStore } from './infrastructure/prisma-refresh-token.store';
import { PrismaUserAdminStore } from './infrastructure/prisma-user-admin.store';
import { PrismaUserPreferencesStore } from './infrastructure/prisma-user-preferences.store';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { Rs256TokenIssuer } from './infrastructure/rs256-token-issuer';

const prisma = new PrismaClient();
let relay: OutboxRelay | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 1000) }])],
  controllers: [AuthController, UsersController, MeController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const cfg = loadConfig(); return { publicKey: cfg.publicKey, issuer: cfg.issuer, audience: cfg.audience }; } },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // por defecto TODA ruta exige token; login y salud son @Public()
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: LIST_USERS_USE_CASE, useFactory: () => new ListUsersUseCase(new PrismaUserAdminStore(prisma)) },
    { provide: CREATE_USER_USE_CASE, useFactory: () => new CreateUserUseCase(new PrismaUserAdminStore(prisma), new BcryptPasswordHasher()) },
    { provide: SET_LANGUAGE_USE_CASE, useFactory: () => new SetLanguageUseCase(new PrismaUserPreferencesStore(prisma)) },
    { provide: SET_THEME_USE_CASE, useFactory: () => new SetThemeUseCase(new PrismaUserPreferencesStore(prisma)) },
    { provide: CHANGE_ROLE_USE_CASE, useFactory: () => new ChangeRoleUseCase(new PrismaUserAdminStore(prisma)) },
    {
      provide: SESSION_SERVICE,
      useFactory: () => {
        const cfg = loadConfig();
        return new SessionService(new PrismaRefreshTokenStore(prisma), new PrismaUserRepository(prisma), new Rs256TokenIssuer(cfg), { idleMs: cfg.refreshIdleMinutes * 60_000, maxMs: cfg.sessionMaxHours * 3_600_000 });
      },
    },
    {
      provide: REVOKE_SESSIONS_USE_CASE,
      inject: [SESSION_SERVICE],
      useFactory: (sessions: SessionService) => new RevokeUserSessionsUseCase(new PrismaUserAdminStore(prisma), new PrismaUserRepository(prisma), sessions),
    },
    { provide: COOKIE_SECURE, useFactory: () => loadConfig().cookieSecure },
    {
      provide: LOGIN_USE_CASE,
      inject: [SESSION_SERVICE],
      useFactory: (sessions: SessionService) => {
        const cfg = loadConfig();
        return new LoginUseCase(new PrismaUserRepository(prisma), new BcryptPasswordHasher(), new Rs256TokenIssuer(cfg), sessions);
      },
    },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = loadConfig();
    // Sin broker configurado Identity sigue funcionando: los eventos esperan en la tabla hasta que haya relé.
    if (c.rabbitUrl && process.env.RELAY_ENABLED !== 'false') {
      relay = new OutboxRelay(prisma, { url: c.rabbitUrl, pollMs: c.outboxPollMs, mandatory: c.relayMandatory, compactAfterDays: c.outboxCompactDays });
      relay.start();
    }
  }

  async onModuleDestroy() {
    await relay?.stop();
    relay = undefined;
    await prisma.$disconnect();
  }
}
