import { existsSync, readFileSync } from 'fs';

// Carga .env (ignorado por Git) sin pisar variables ya definidas.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.NODE_ENV = 'test';
// El programador de facturas vencidas se apaga en las pruebas (las que lo necesitan lo llaman a mano o lo encienden a propósito antes de arrancar la app).
process.env.OVERDUE_ENABLED = process.env.OVERDUE_ENABLED ?? 'false';
