/** Temas de la interfaz. «system» sigue el modo claro u oscuro del equipo: es el predeterminado, así que un usuario nuevo, o uno anterior a esta columna, no ve ningún cambio. */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'system';

export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);
