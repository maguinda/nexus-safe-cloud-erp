import type { ReactNode } from 'react';
import ui from '../styles/ui.module.css';
import s from './KpiCard.module.css';
import { kpiIcon, type KpiIconName } from './KpiIcons';

interface Props {
  label: string;
  value: ReactNode;
  /** Línea de apoyo bajo la cifra. */
  sub?: ReactNode;
  icon: KpiIconName;
  /** Color del ícono según lo que significa la cifra (ok, aviso, mal). Sin tono, neutro. */
  tone?: 'ok' | 'warn' | 'bad';
  /** Clase extra para la cifra (p. ej. el color de las advertencias de Sensores). */
  valueClass?: string;
}

/**
 * Tarjeta de indicador compartida (Proyectos, Tablero y Sensores del Tablero). El orden del contenido (etiqueta y luego cifra) no cambia:
 * hay pruebas y lectores de pantalla que leen la cifra a continuación de su etiqueta.
 */
export function KpiCard({ label, value, sub, icon, tone, valueClass }: Props) {
  return (
    <div className={`${ui.card} ${s.kpiCard}`}>
      <span className={`${s.icon} ${tone ? s[tone] : ''}`} aria-hidden="true">{kpiIcon(icon)}</span>
      <small className={ui.muted}>{label}</small>
      <strong className={valueClass ? `${ui.kpi} ${valueClass}` : ui.kpi}>{value}</strong>
      {sub !== undefined && <span className={ui.kpiSub}>{sub}</span>}
    </div>
  );
}
