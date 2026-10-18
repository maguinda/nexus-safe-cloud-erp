import { Module, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { LoginUseCase } from './application/login.use-case';
import { loadConfig } from './config';
import { AuthController, LOGIN_USE_CASE } from './http/auth.controller';
import { HealthController } from './http/health.controller';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { Rs256TokenIssuer } from './infrastructure/rs256-token-issuer';

const prisma = new PrismaClient();

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
  controllers: [AuthController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
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
