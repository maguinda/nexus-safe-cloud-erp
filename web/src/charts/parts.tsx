import type { CSSProperties, ReactNode } from 'react';
import s from './charts.module.css';
import { toneColor, type ChartTable, type LegendItem, type Tone } from './types';

const swatchStyle = (tone: Tone): CSSProperties => ({ ['--swatch' as string]: toneColor(tone) });

/** Leyenda. Se muestra siempre que haya 2 o más series (con una sola, el título ya dice qué es). La marca refleja el gráfico: línea, caja o punto. */
export function Legend({ items, label, activeId, onActive }: { items: LegendItem[]; label?: string; activeId?: string | null; onActive?: (id: string | null) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className={s.legend} aria-label={label}>
      {items.map((it) => (
        <li
          key={it.id} className={activeId && activeId !== it.id ? s.legendItemDim : s.legendItem}
          tabIndex={onActive ? 0 : undefined}
          onPointerEnter={onActive ? () => onActive(it.id) : undefined} onPointerLeave={onActive ? () => onActive(null) : undefined}
          onFocus={onActive ? () => onActive(it.id) : undefined} onBlur={onActive ? () => onActive(null) : undefined}
        >
          <span className={it.shape === 'box' ? s.swatchBox : it.shape === 'dot' ? s.swatchDot : it.dashed ? s.swatchLineDashed : s.swatchLine} style={swatchStyle(it.tone)} aria-hidden />
          <span>{it.label}</span>
          {it.value !== undefined && <span className={s.legendValue}>{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export type TipAlign = 'center' | 'left' | 'right';
export interface TooltipRow { id: string; tone?: Tone; label: string; value: string }

/** Alineación del tooltip según dónde cae el punto: así nunca se sale del gráfico. */
export const tipAlign = (x: number, width: number): TipAlign => (x < 90 ? 'left' : x > width - 90 ? 'right' : 'center');

/** Tooltip HTML: el valor va en fuerte y el nombre de la serie al lado en secundario. El texto entra como nodos de React (nunca como HTML crudo). */
export function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: TooltipRow[] }) {
  const align = tipAlign(x, width);
  return (
    <div className={`${s.tooltip} ${align === 'left' ? s.tipLeft : align === 'right' ? s.tipRight : s.tipCenter}`} style={{ left: Math.round(x) }} aria-hidden>
      <p className={s.tipTitle}>{title}</p>
      <ul className={s.tipRows}>
        {rows.map((r) => (
          <li key={r.id} className={s.tipRow}>
            {r.tone && <span className={s.tipKey} style={swatchStyle(r.tone)} />}
            <span className={s.tipValue}>{r.value}</span>
            <span className={s.tipLabel}>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Texto para el lector de pantalla (no se ve). `live` anuncia los cambios, p. ej. la lectura activa al moverse con el teclado. */
export function SrOnly({ children, live, id }: { children: ReactNode; live?: boolean; id?: string }) {
  return <span id={id} className={s.srOnly} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>{children}</span>;
}

/** Estado «sin datos». */
export function ChartEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={s.state} role="status">
      <p className={s.stateTitle}>{title}</p>
      {hint && <p className={s.stateHint}>{hint}</p>}
    </div>
  );
}

/** Tabla alternativa. Los números van a la derecha y un valor ausente se escribe «—». */
export function DataTable({ table }: { table: ChartTable }) {
  const from = table.numericFrom ?? 1;
  return (
    <div className={s.tableScroll} tabIndex={0}>
      <table className={s.table}>
        {table.caption && <caption className={s.srOnly}>{table.caption}</caption>}
        <thead><tr>{table.columns.map((c, i) => <th key={`${c}-${i}`} scope="col" className={i >= from ? s.num : undefined}>{c}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>{row.map((cell, i) => (i === 0 ? <th key={i} scope="row" className={s.rowHead}>{cell ?? '—'}</th> : <td key={i} className={i >= from ? s.num : undefined}>{cell ?? '—'}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
