import { existsSync, readFileSync } from 'fs';

// Carga .env (ignorado por Git) sin pisar variables ya definidas.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.NODE_ENV = 'test';
// Las pruebas e2e no consumen del bus real salvo la que lo prueba a propósito: un consumidor vivo dejaba jest colgado.
process.env.CONSUMER_ENABLED = 'false';
