import type { CapForm } from '../lib/workorders';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

/** Cuánto de la jornada de la persona gasta la orden y entre qué días. Va junto al selector del responsable: sin responsable no hay reserva. */
export function CapacityFields({ value, onChange, error, today }: { value: CapForm; onChange: (v: CapForm) => void; error?: string; today: string }) {
  const { t } = useSession();
  return (
    <fieldset className={`${ui.field} ${ui.fieldWide}`}>
      <legend>{t('wo.cap.title')}</legend>
      <p className={ui.muted}>{t('wo.cap.hint')}</p>
      <div className={ui.formGrid}>
        <label className={ui.field}><span>{t('wo.cap.percent')}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={3} value={value.percent} onChange={(e) => onChange({ ...value, percent: e.target.value })} aria-invalid={!!error} /></label>
        <label className={ui.field}><span>{t('wo.cap.start')}</span><input type="date" min={today} value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} aria-invalid={!!error} /></label>
        <label className={ui.field}><span>{t('wo.cap.end')}</span><input type="date" min={value.start || today} value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} aria-invalid={!!error} /></label>
      </div>
      <label className={ui.checkRow}><input type="checkbox" checked={value.allowOver} onChange={(e) => onChange({ ...value, allowOver: e.target.checked })} /><span>{t('wo.cap.allowOver')}</span></label>
      {error && <span className={ui.err} role="alert">{error}</span>}
    </fieldset>
  );
}
