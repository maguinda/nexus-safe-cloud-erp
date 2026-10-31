import { useEffect, useState } from 'react';
import { errorText } from '../i18n/server';
import type { CapacityEngineer } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

export interface StaffChoice { id: string; name: string }

/** Elegir a una persona del personal técnico (ingenieros y técnicos de Capacidad técnica) con botones; tocar de nuevo a la elegida la quita. */
export function StaffPicker({ label, value, onChange, kind }: { label: string; value: StaffChoice | null; onChange: (v: StaffChoice | null) => void; kind?: 'engineer' | 'technician' }) {
  const { api, t } = useSession();
  const [staff, setStaff] = useState<CapacityEngineer[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.capacity().then((r) => { if (live) setStaff(r.engineers); }).catch((e) => { if (live) setError(errorText(e, t, 'server.unexpected')); });
    return () => { live = false; };
  }, [api, t]);
  return (
    <fieldset className={`${ui.field} ${ui.fieldWide}`}>
      <legend>{label}</legend>
      {staff === null && !error && <p className={ui.muted} role="status">{t('staff.loading')}</p>}
      {error && <p className={ui.err} role="alert">{t('staff.error', { reason: error })}</p>}
      {staff !== null && (
        <div className={ui.chips}>
          {staff.filter((p) => !kind || p.kind === kind).map((p) => (
            <button key={p.id} type="button" className={value?.id === p.id ? ui.chipOn : ui.chip} aria-pressed={value?.id === p.id} onClick={() => onChange(value?.id === p.id ? null : { id: p.id, name: p.name })}>
              {p.name} · {t(`kind.${p.kind}` as 'kind.engineer')}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
