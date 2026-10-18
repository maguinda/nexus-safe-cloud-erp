import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Un solo inicio de sesión por rol para toda la corrida: el gateway limita el login (10 por minuto por IP).
export default async function globalSetup() {
  const base = process.env.BASE_URL ?? 'http://localhost:8080';
  const password = process.env.DEMO_PASSWORD ?? 'demo-password-1';
  const accounts: Record<string, string> = { lead: 'laura.rios@nexus.example', billing: 'andres.mora@nexus.example', sales: 'camila.soto@nexus.example' };
  const dir = join(dirname(fileURLToPath(import.meta.url)), '.auth');
  const file = join(dir, 'sessions.json');
  // Si ya hay sesiones guardadas y a todas les quedan más de 2 minutos, se reutilizan (menos logins contra el gateway).
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { token: string }>;
      const left = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp - Date.now() / 1000;
      if (Object.keys(accounts).every((r) => saved[r] && left(saved[r].token) > 120)) return;
    } catch { /* se vuelve a iniciar sesión */ }
  }
  const sessions: Record<string, { token: string; user: unknown }> = {};
  for (const [role, email] of Object.entries(accounts)) {
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error(`Login of ${role} failed (${res.status}). Is the stack up and seeded (SEED_DEMO=true)?`);
    const j = await res.json();
    sessions[role] = { token: j.accessToken, user: j.user };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(sessions));
}
