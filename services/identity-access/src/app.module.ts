import { Module, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { LoginUseCase } from './application/login.use-case';
import { SetLanguageUseCase } from './application/set-language.use-case';
import { ChangeRoleUseCase, CreateUserUseCase, ListUsersUseCase } from './application/user-admin.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { AuthController, LOGIN_USE_CASE } from './http/auth.controller';
import { HealthController } from './http/health.controller';
import { MeController, SET_LANGUAGE_USE_CASE } from './http/me.controller';
import { CHANGE_ROLE_USE_CASE, CREATE_USER_USE_CASE, LIST_USERS_USE_CASE, UsersController } from './http/users.controller';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher';
import { PrismaUserAdminStore } from './infrastructure/prisma-user-admin.store';
import { PrismaUserPreferencesStore } from './infrastructure/prisma-user-preferences.store';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { Rs256TokenIssuer } from './infrastructure/rs256-token-issuer';

const prisma = new PrismaClient();

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
  controllers: [AuthController, UsersController, MeController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const cfg = loadConfig(); return { publicKey: cfg.publicKey, issuer: cfg.issuer, audience: cfg.audience }; } },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // por defecto TODA ruta exige token; login y salud son @Public()
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: LIST_USERS_USE_CASE, useFactory: () => new ListUsersUseCase(new PrismaUserAdminStore(prisma)) },
    { provide: CREATE_USER_USE_CASE, useFactory: () => new CreateUserUseCase(new PrismaUserAdminStore(prisma), new BcryptPasswordHasher()) },
    { provide: SET_LANGUAGE_USE_CASE, useFactory: () => new SetLanguageUseCase(new PrismaUserPreferencesStore(prisma)) },
    { provide: CHANGE_ROLE_USE_CASE, useFactory: () => new ChangeRoleUseCase(new PrismaUserAdminStore(prisma)) },
    {
      provide: LOGIN_USE_CASE,
      useFactory: () => {
        const cfg = loadConfig();
        return new LoginUseCase(new PrismaUserRepository(prisma), new BcryptPasswordHasher(), new Rs256TokenIssuer(cfg));
      },
    },
  ],
})
export class AppModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await prisma.$disconnect();
  }
}
