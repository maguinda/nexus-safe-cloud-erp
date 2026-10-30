import { existsSync, readFileSync } from 'fs';

// Carga .env (ignorado por Git) sin pisar variables ya definidas.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.NODE_ENV = 'test';
process.env.RELAY_ENABLED = 'false'; // los e2e no publican a RabbitMQ (ni siquiera si el .env lo enciende); solo el del relé lo enciende dentro de su archivo
process.env.RETENTION_ENABLED = 'false'; // los e2e no borran lecturas por su cuenta; el de la retención llama al caso de uso a mano
