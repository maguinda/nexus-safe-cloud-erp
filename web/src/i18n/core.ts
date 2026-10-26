/** Idiomas de la interfaz. Solo cambia lo que es de la APLICACIÓN (pantallas, opciones, avisos); los datos que vienen de la base se muestran como están. */
export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

export type Params = Record<string, string | number>;

/** Sustituye {nombre} por su valor. Un parámetro que falta se deja como está: se ve el hueco y no se rompe la pantalla. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Los marcadores {nombre} de una cadena, ordenados: sirven para comprobar que los dos idiomas usan los mismos. */
export const placeholdersOf = (template: string): string[] => [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
