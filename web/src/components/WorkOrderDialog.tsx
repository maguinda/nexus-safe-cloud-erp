import { FormEvent, useEffect, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import { checkWorkOrder, WO_PRIORITIES, WO_TYPES } from '../lib/workorders';
import type { WoErrors } from '../lib/workorders';
import type { WorkOrder } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './WorkOrderDialog.module.css';

export interface WoTarget { kind: 'sensor' | 'device'; ref: string | number; name: string; note?: string; suggest?: 'inspection' | 'preventive' | 'corrective' }

/** Crear una orden de trabajo desde una alerta o un equipo. Un cuadro de diálogo: Esc o «Cancelar» lo cierran y el foco vuelve al botón que lo abrió. */
export function WorkOrderDialog({ target, onClose, onCreated }: { target: WoTarget; onClose: () => void; onCreated: (o: WorkOrder) => void }) {
  const { api, t } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: target.suggest ?? '', priority: 'normal', description: target.note ? target.note : '', dueDate: '', assignedTo: '' });
  const [errors, setErrors] = useState<WoErrors & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); setTimeout(() => opener.current?.focus(), 0); };
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inflight.current) return;
    const { errors: errs, value } = checkWorkOrder(t, f, today);
    setErrors(errs);
    if (!value) return;
    inflight.current = true; setBusy(true);
    try { onCreated(await api.createWorkOrder({ ...value, targetKind: target.kind, targetRef: target.ref, ...(target.note ? { sourceNote: target.note.slice(0, 200) } : {}) })); }
    catch (err) { setErrors({ form: t('wo.failed', { reason: errorText(err, t, 'server.unexpected') }) }); }
    finally { inflight.current = false; setBusy(false); }
  }

  return (
    <div className={s.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="wo-dlg-h" className={s.dialog}>
        <h2 id="wo-dlg-h" className={ui.h2}>{t('wo.dialogTitle')}</h2>
        <p><strong>{t('wo.target', { name: target.name })}</strong></p>
        {target.note && <p className={ui.muted}>{t('wo.origin', { note: target.note })}</p>}
        <form onSubmit={(e) => void submit(e)} noValidate aria-label={t('wo.createFor', { name: target.name })} className={s.form}>
          <fieldset className={ui.field}><legend>{t('wo.field.type')}</legend>
            <div className={ui.seg}>{WO_TYPES.map((x, i) => <button key={x} ref={i === 0 ? first : undefined} type="button" className={f.type === x ? ui.segBtnOn : ui.segBtn} aria-pressed={f.type === x} onClick={() => setF({ ...f, type: x })}>{t(`wo.type.${x}` as 'wo.type.inspection')}</button>)}</div>
            {errors.type && <span className={ui.err}>{errors.type}</span>}</fieldset>
          <fieldset className={ui.field}><legend>{t('wo.field.priority')}</legend>
            <div className={ui.seg}>{WO_PRIORITIES.map((x) => <button key={x} type="button" className={f.priority === x ? ui.segBtnOn : ui.segBtn} aria-pressed={f.priority === x} onClick={() => setF({ ...f, priority: x })}>{t(`wo.priority.${x}` as 'wo.priority.low')}</button>)}</div>
            {errors.priority && <span className={ui.err}>{errors.priority}</span>}</fieldset>
          <label className={ui.field}><span>{t('wo.field.description')}</span><textarea rows={3} maxLength={320} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} aria-invalid={!!errors.description} className={s.area} />{errors.description && <span className={ui.err}>{errors.description}</span>}</label>
          <div className={ui.formGrid}>
            <label className={ui.field}><span>{t('wo.field.due')}</span><input type="date" min={today} value={f.dueDate} onChange={(x) => setF({ ...f, dueDate: x.target.value })} aria-invalid={!!errors.dueDate} />{errors.dueDate && <span className={ui.err}>{errors.dueDate}</span>}</label>
            <label className={ui.field}><span>{t('wo.field.assigned')}</span><input type="text" autoComplete="off" maxLength={100} value={f.assignedTo} onChange={(x) => setF({ ...f, assignedTo: x.target.value })} aria-invalid={!!errors.assignedTo} />{errors.assignedTo && <span className={ui.err}>{errors.assignedTo}</span>}</label>
          </div>
          {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
          <div className={ui.formActions}>
            <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('wo.saving') : t('wo.save')}</button>
            <button type="button" className={ui.btnGhost} onClick={onClose}>{t('wo.cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
