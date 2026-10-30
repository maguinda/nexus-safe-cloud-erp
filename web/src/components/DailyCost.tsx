import { FormEvent, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import { checkDailyCost } from '../lib/profitability';
import type { CapacityEngineer } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

/** Costo diario del ingeniero: solo lo ve y lo cambia gerencia (el servidor no se lo manda a los demás roles). */
export function DailyCost({ engineer, onSaved, toast }: { engineer: CapacityEngineer; onSaved: () => void; toast: (m: string) => void }) {
  const { api, t } = useSession();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (inflight.current) return;
    const { error: err, value } = checkDailyCost(t, text);
    setError(err ?? '');
    if (value === undefined) return;
    inflight.current = true; setBusy(true);
    try { await api.setDailyCost(engineer.id, value); toast(t('cost.saved', { name: engineer.name })); setOpen(false); onSaved(); }
    catch (x) { setError(t('cost.failed', { reason: errorText(x, t, 'server.unexpected') })); }
    finally { inflight.current = false; setBusy(false); }
  }

  return (
    <div>
      <p><strong>{t('cost.label')}:</strong> {engineer.dailyCostCop == null ? t('cost.none') : t('cost.value', { amount: formatCop(engineer.dailyCostCop) })}{' '}
        {!open && <button type="button" className={ui.btnGhost} aria-label={t('cost.edit', { name: engineer.name })} onClick={() => { setOpen(true); setText(engineer.dailyCostCop == null ? '' : String(engineer.dailyCostCop)); setError(''); }}>{t('cost.change')}</button>}</p>
      {open && (
        <form onSubmit={(e) => void save(e)} noValidate aria-label={t('cost.edit', { name: engineer.name })} className={ui.formCard}>
          <label className={ui.field}><span>{t('cost.field')}</span>
            <input type="text" inputMode="numeric" autoComplete="off" maxLength={12} value={text} onChange={(x) => setText(x.target.value)} aria-invalid={!!error} />
            {error && <span className={ui.err}>{error}</span>}</label>
          <p className={ui.muted}>{t('cost.note')}</p>
          <div className={ui.formActions}>
            <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('cost.saving') : t('cost.save')}</button>
            <button type="button" className={ui.btnGhost} onClick={() => setOpen(false)}>{t('cost.cancel')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
