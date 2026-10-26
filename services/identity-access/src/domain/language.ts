/** Idiomas de la interfaz. El español es el predeterminado: un usuario nuevo, o uno anterior a esta columna, ve la app en español. */
export const LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'es';

export const isLanguage = (v: unknown): v is Language => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
