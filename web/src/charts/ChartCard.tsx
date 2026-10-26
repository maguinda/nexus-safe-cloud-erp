import { useId } from 'react';
import type { ReactNode } from 'react';
import s from './charts.module.css';
import { ChartEmpty, DataTable } from './parts';
import { resolveT, type ChartTable, type I18nProps } from './types';

export interface ChartCardProps extends I18nProps {
  title: string;
  subtitle?: string;
  /** Algo a la derecha del título: un selector de periodo, un enlace «Ver detalle»… */
  action?: ReactNode;
  /** 'ready' dibuja `children`; 'empty' muestra «Sin datos»; 'loading' un esqueleto; 'error' el aviso de error. */
  state?: 'ready' | 'empty' | 'loading' | 'error';
  /** Texto propio del estado vacío o de error (si no, el genérico del idioma). */
  stateText?: string;
  /** Alternativa en tabla de los MISMOS datos: todo gráfico debe llevarla. Se ve con «Ver como tabla». */
  table?: ChartTable;
  /** Nota al pie: de dónde salen los datos, qué rango cubren. */
  footnote?: string;
  /** Nivel del título (h2..h4) según dónde se use la tarjeta. */
  headingLevel?: 2 | 3 | 4;
  children?: ReactNode;
}

/** Contenedor de un gráfico: título, subtítulo, acción, el gráfico o su estado, la tabla alternativa y una nota. */
export function ChartCard({ title, subtitle, action, state = 'ready', stateText, table, footnote, headingLevel = 3, children, ...i18n }: ChartCardProps) {
  const { t } = resolveT(i18n);
  const id = useId();
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <section className={s.card} aria-labelledby={`${id}-h`}>
      <div className={s.cardHead}>
        <div>
          <H id={`${id}-h`} className={s.cardTitle}>{title}</H>
          {subtitle && <p className={s.cardSub}>{subtitle}</p>}
        </div>
        {action && <div className={s.cardAction}>{action}</div>}
      </div>
      {state === 'loading' ? <div className={s.skeleton} role="status" aria-label={t('chart.loading')} />
        : state === 'error' ? <ChartEmpty title={stateText ?? t('chart.error')} />
          : state === 'empty' ? <ChartEmpty title={stateText ?? t('chart.noData')} hint={t('chart.noDataHint')} />
            : children}
      {state === 'ready' && table && table.rows.length > 0 && (
        <details className={s.tableBox}>
          <summary className={s.tableSummary}>{t('chart.viewTable')}</summary>
          <DataTable table={{ caption: title, ...table }} />
        </details>
      )}
      {footnote && <p className={s.cardFoot}>{footnote}</p>}
    </section>
  );
}
