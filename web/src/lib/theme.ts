import type { Theme } from './types';

/** Temas de la interfaz. «system» (el predeterminado) sigue el modo claro u oscuro del equipo de la persona. */
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME: Theme = 'system';
export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);

/** Lo mínimo que `applyTheme` necesita del elemento raíz (así se prueba con un objeto falso, sin navegador). */
export interface ThemeRoot { dataset: Record<string, string | undefined>; style: { colorScheme: string } }

/**
 * «light» y «dark» se fijan en el documento (`data-theme` + `color-scheme`) y mandan sobre el modo del equipo (ver tokens.css).
 * «system» quita ambos: la hoja de estilos vuelve a seguir al equipo.
 */
export function applyTheme(theme: Theme, root: ThemeRoot): void {
  if (theme === 'system') { delete root.dataset.theme; root.style.colorScheme = ''; return; }
  root.dataset.theme = theme; root.style.colorScheme = theme;
}
