import { Page } from '@playwright/test';
import type { Lang } from '../src/i18n/core';
import type { Theme } from '../src/lib/types';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export type RoleKey = 'lead' | 'billing' | 'sales' | 'manager' | 'finance';

/** Abre la app con la sesión de ese rol ya iniciada (se inyecta en sessionStorage, como la guarda la app). */
const ACCOUNTS: Record<RoleKey, string> = { lead: 'laura.rios@nexus.example', billing: 'andres.mora@nexus.example', sales: 'camila.soto@nexus.example', manager: 'diana.vega@nexus.example', finance: 'fernanda.gil@nexus.example' };
const secondsLeft = (t: string): number => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp - Date.now() / 1000;

/** Sesiones guardadas por el setup. Los tokens duran 15 min y una corrida completa dura más: si a uno le quedan menos de 5 min se inicia sesión de nuevo
 *  (solo ese rol) y se guarda. Sin esto la app intentaba renovar con una sesión sin cookie y la auditoría (que bloquea toda escritura) fallaba. */
export async function currentSessions(): Promise<Record<string, { token: string; user: Record<string, unknown> }>> {
  const file = join(here, '.auth', 'sessions.json');
  const sessions = JSON.parse(readFileSync(file, 'utf8'));
  let changed = false;
  for (const role of Object.keys(ACCOUNTS) as RoleKey[]) {
    if (sessions[role] && secondsLeft(sessions[role].token) > 300) continue;
    const base = process.env.BASE_URL ?? 'http://localhost:8080';
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ACCOUNTS[role], password: process.env.DEMO_PASSWORD ?? 'demo-password-1' }) });
    if (!res.ok) throw new Error(`Login of ${role} failed (${res.status}) while renewing the saved test session`);
    const j = await res.json();
    sessions[role] = { token: j.accessToken, user: j.user };
    changed = true;
  }
  if (changed) writeFileSync(file, JSON.stringify(sessions));
  return sessions;
}

export async function openAs(page: Page, role: RoleKey, lang: Lang = 'en', theme: Theme = 'system') {
  const sessions = await currentSessions();
  // El idioma de la sesión es el de la persona (viene del servidor al iniciar sesión); aquí se fija a propósito: las pruebas existentes comprueban el inglés.
  const session = { ...sessions[role], user: { ...sessions[role].user, language: lang, theme } };
  await preferLanguage(page, lang, theme);
  await page.addInitScript(([k, v]) => sessionStorage.setItem(k as string, v as string), ['erp.session', JSON.stringify(session)]);
  await page.goto('/');
}

/** Idioma de las pantallas que se ven ANTES de iniciar sesión: la app recuerda el último usado en este navegador (localStorage «erp.lang»). */
export async function preferLanguage(page: Page, lang: Lang, theme: Theme = 'system') {
  await page.addInitScript(([l, t]) => { try { localStorage.setItem('erp.lang', l as string); localStorage.setItem('erp.theme', t as string); } catch { /* sin almacenamiento */ } }, [lang, theme]);
}

/** nginx deja pasar 1 inicio de sesión cada 6 s (10 por minuto, ráfaga de 5): ese es el tiempo en que se repone un cupo. */
const LOGIN_REFILL_MS = 6_500;

/**
 * Espera a que el gateway vuelva a aceptar inicios de sesión (límite de 10 por minuto por IP). Un login por la interfaz a mitad de la suite recibía 429 y la
 * prueba parecía fallar «sola». Prueba con una cuenta que no existe (401, sin efectos): un 429 no gasta cupo, pero el sondeo que SÍ pasa gasta el último que
 * encontró: el cubo de nginx queda en el borde y el login real que viene enseguida se rechazaba (medido: 6 de 6, y la prueba de tema fallaba 3 de 3 con nginx
 * saturado). Por eso, tras un sondeo que pasa, se espera lo que tarda en reponerse un cupo.
 */
export async function waitForLoginCapacity(request: { post: (url: string, o: { data: object }) => Promise<{ status(): number }> }, maxMs = 75_000): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if ((await request.post('/auth/login', { data: { email: 'sin.cupo@nexus.example', password: 'x' } })).status() !== 429) {
      await new Promise((ok) => setTimeout(ok, LOGIN_REFILL_MS));
      return;
    }
    await new Promise((ok) => setTimeout(ok, 4_000));
  }
}
