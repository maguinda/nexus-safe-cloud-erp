import { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export type RoleKey = 'lead' | 'billing' | 'sales';

/** Abre la app con la sesión de ese rol ya iniciada (se inyecta en sessionStorage, como la guarda la app). */
export async function openAs(page: Page, role: RoleKey) {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  await page.addInitScript(([k, v]) => sessionStorage.setItem(k as string, v as string), ['erp.session', JSON.stringify(sessions[role])]);
  await page.goto('/');
}
