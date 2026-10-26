import { Page } from '@playwright/test';
import type { Lang } from '../src/i18n/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export type RoleKey = 'lead' | 'billing' | 'sales' | 'manager';

/** Abre la app con la sesión de ese rol ya iniciada (se inyecta en sessionStorage, como la guarda la app). */
export async function openAs(page: Page, role: RoleKey, lang: Lang = 'en') {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  // El idioma de la sesión es el de la persona (viene del servidor al iniciar sesión); aquí se fija a propósito: las pruebas existentes comprueban el inglés.
  const session = { ...sessions[role], user: { ...sessions[role].user, language: lang } };
  await preferLanguage(page, lang);
  await page.addInitScript(([k, v]) => sessionStorage.setItem(k as string, v as string), ['erp.session', JSON.stringify(session)]);
  await page.goto('/');
}

/** Idioma de las pantallas que se ven ANTES de iniciar sesión: la app recuerda el último usado en este navegador (localStorage «erp.lang»). */
export async function preferLanguage(page: Page, lang: Lang) {
  await page.addInitScript((l) => { try { localStorage.setItem('erp.lang', l as string); } catch { /* sin almacenamiento */ } }, lang);
}
