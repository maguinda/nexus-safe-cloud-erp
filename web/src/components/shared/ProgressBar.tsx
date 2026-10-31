import s from './ProgressBar.module.css';

/** Barra de progreso accesible: el valor se dice con texto (`label`) y con `role="progressbar"`. El ancho es el único valor calculado que va en línea. */
export function ProgressBar({ value, max = 100, tone, label, caption }: { value: number; max?: number; tone?: 'ok' | 'warn' | 'bad'; label: string; caption?: string }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className={s.wrap}>
      <div className={s.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0, Math.min(max, value))} aria-valuetext={caption ?? `${pct} %`}>
        <div className={tone ? s[tone] : s.fill} style={{ width: `${pct}%` }} />
      </div>
      {caption && <span className={s.label}>{caption}</span>}
    </div>
  );
}
