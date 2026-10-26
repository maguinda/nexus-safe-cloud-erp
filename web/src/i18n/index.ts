import { DEFAULT_LANG, interpolate, Lang, Params } from './core';
import { en } from './en';
import { es } from './es';

export * from './core';
export type MsgKey = keyof typeof es;
export const MESSAGES: Record<Lang, Record<MsgKey, string>> = { es, en };

export type TFn = (key: MsgKey, params?: Params) => string;

/** Traduce una clave. Si el idioma no la trae (no debería pasar: lo impide el compilador y una prueba), cae al español y luego a la clave. */
export function translate(lang: Lang, key: MsgKey, params?: Params): string {
  const text = MESSAGES[lang]?.[key] ?? MESSAGES[DEFAULT_LANG][key] ?? key;
  return interpolate(text, params);
}

export const makeT = (lang: Lang): TFn => (key, params) => translate(lang, key, params);
