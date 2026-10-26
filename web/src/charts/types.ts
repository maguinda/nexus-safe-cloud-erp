import type { Lang } from '../i18n/core';
import type { TFn } from '../i18n';
import { makeT } from '../i18n';

/**
 * Tonos con los que se pinta un dato. `chart-1`..`chart-6` son los categóricos (identidad), EN ESE ORDEN y sin repetirse:
 * un 7.º elemento se agrupa en «Otros» (`chart-other`). `ok`/`warn`/`bad` son de ESTADO: reservados para bueno/atención/crítico
 * y siempre con icono y texto, nunca solos. `accent` y `muted` son los de la app.
 */
export type Tone = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6' | 'chart-other' | 'ok' | 'warn' | 'bad' | 'accent' | 'muted';

const VAR: Record<Tone, string> = {
  'chart-1': 'var(--chart-1)', 'chart-2': 'var(--chart-2)', 'chart-3': 'var(--chart-3)', 'chart-4': 'var(--chart-4)', 'chart-5': 'var(--chart-5)', 'chart-6': 'var(--chart-6)',
  'chart-other': 'var(--chart-other)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', accent: 'var(--accent)', muted: 'var(--muted)',
};
/** El `var(--…)` de un tono; se usa en `fill`/`stroke` (por `style`, no por atributo). */
export const toneColor = (t: Tone): string => VAR[t];

export const MAX_CATEGORICAL = 6;
/** El tono del elemento número `i` (0, 1, 2…): fijo por posición. Del 7.º en adelante es el gris de «Otros», no un tono nuevo. */
export const seriesTone = (i: number): Tone => (i >= 0 && i < MAX_CATEGORICAL ? (`chart-${i + 1}` as Tone) : 'chart-other');

/** Idioma y traductor de un gráfico: lo que se pase por props, o español por defecto. Los componentes NO leen la sesión (así se prueban sin React). */
export interface I18nProps { lang?: Lang; t?: TFn }
export const resolveT = ({ lang, t }: I18nProps): { lang: Lang; t: TFn } => { const l: Lang = lang ?? 'es'; return { lang: l, t: t ?? makeT(l) }; };

/** Tabla alternativa de un gráfico: los MISMOS datos que se dibujan, para quien no ve el gráfico y para quien no distingue los colores. */
export interface ChartTable {
  caption?: string;
  columns: string[];
  rows: (string | number | null)[][];
  /** Desde qué columna los números van alineados a la derecha (por defecto, desde la segunda). */
  numericFrom?: number;
}

export interface LegendItem { id: string; label: string; tone: Tone; shape?: 'line' | 'box' | 'dot'; dashed?: boolean; value?: string }
