import { Page } from '@playwright/test';
import type { Lang } from '../src/i18n/core';
import type { Theme } from '../src/lib/types';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export type RoleKey = 'lead' | 'billing' | 'sales' | 'manager';

/** Abre la app con la sesión de ese rol ya iniciada (se inyecta en sessionStorage, como la guarda la app). */
export async function openAs(page: Page, role: RoleKey, lang: Lang = 'en', theme: Theme = 'system') {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
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

/**
 * Espera a que el gateway vuelva a aceptar inicios de sesión (límite de 10 por minuto por IP). Un login por la interfaz a mitad de la suite recibía 429 y la
 * prueba parecía fallar «sola». Prueba con una cuenta que no existe (401, sin efectos): un 429 no gasta cupo, así que el sondeo no empeora nada.
 */
export async function waitForLoginCapacity(request: { post: (url: string, o: { data: object }) => Promise<{ status(): number }> }, maxMs = 75_000): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if ((await request.post('/auth/login', { data: { email: 'sin.cupo@nexus.example', password: 'x' } })).status() !== 429) return;
    await new Promise((ok) => setTimeout(ok, 4_000));
  }
}
