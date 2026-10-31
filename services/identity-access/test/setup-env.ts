import { existsSync, readFileSync } from 'fs';

// Carga .env (ignorado por Git) sin pisar variables ya definidas.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.NODE_ENV = 'test';
// Las pruebas no publican eventos al RabbitMQ de la demo salvo la que lo pide a propósito (user-events.e2e.ts): así la bitácora de Analytics no se llena de usuarios de prueba.
process.env.RELAY_ENABLED = 'false';
