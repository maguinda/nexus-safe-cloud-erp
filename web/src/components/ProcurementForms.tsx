import { FormEvent, useState } from 'react';
import type { Api } from '../lib/api';
import { errorText } from '../i18n/server';
import { checkAdjust, checkName, checkOrder, NAME_MAX, parseKinds, TERMS_MAX } from '../lib/procurement';
import type { StockItem, Supplier } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

type Choice = { value: string; label: string };

/** Elegir entre pocas opciones con botones (no un <select> nativo: en WebKit mide menos de 32 px y la auditoría lo rechaza). */
function Pick({ label, value, onChange, options, error, id }: { label: string; value: string; onChange: (v: string) => void; options: Choice[]; error?: string; id: string }) {
  return (
    <fieldset className={ui.field} aria-describedby={error ? `${id}-err` : undefined}>
      <legend>{label}</legend>
      <div className={ui.seg}>
        {options.map((o) => <button key={o.value} type="button" className={value === o.value ? ui.segBtnOn : ui.segBtn} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
      {error && <span id={`${id}-err`} className={ui.err}>{error}</span>}
    </fieldset>
  );
}

export function NewSupplierForm({ api, onCreated }: { api: Api; onCreated: (name: string) => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ name: '', kind: '', terms: '' });
  const [e, setE] = useState<{ name?: string; kind?: string; terms?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const next = { name: checkName(t, f.name, 'proc.field.name', 2, NAME_MAX), kind: f.kind ? '' : t('proc.v.choose'), terms: f.terms.trim() ? checkName(t, f.terms, 'proc.field.terms', 2, TERMS_MAX) : '' };
    setE({ name: next.name || undefined, kind: next.kind || undefined, terms: next.terms || undefined });
    if (next.name || next.kind || next.terms) return;
    setBusy(true);
    try { await api.createSupplier({ name: f.name.replace(/\s+/g, ' ').trim(), kind: f.kind, terms: f.terms.replace(/\s+/g, ' ').trim() }); setF({ name: '', kind: '', terms: '' }); onCreated(f.name.trim()); }
    catch (err) { setE({ form: t('proc.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-sup-h" className={ui.formCard}>
      <h3 id="new-sup-h" className={ui.h2}>{t('proc.new.supplier')}</h3>
      <div className={ui.formGrid}>
        <label className={ui.field}><span>{t('proc.field.name')}</span><input type="text" autoComplete="off" value={f.name} maxLength={NAME_MAX + 20} onChange={(x) => setF({ ...f, name: x.target.value })} aria-invalid={!!e.name} aria-describedby={e.name ? 'ns-name-err' : undefined} />{e.name && <span id="ns-name-err" className={ui.err}>{e.name}</span>}</label>
        <Pick id="ns-kind" label={t('proc.field.kind')} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} error={e.kind} options={[{ value: 'fixed', label: t('proc.kind.fixed') }, { value: 'tender', label: t('proc.kind.tender') }]} />
        <label className={ui.field}><span>{t('proc.field.terms')}</span><input type="text" autoComplete="off" value={f.terms} maxLength={TERMS_MAX + 40} onChange={(x) => setF({ ...f, terms: x.target.value })} aria-invalid={!!e.terms} aria-describedby={e.terms ? 'ns-terms-err' : undefined} />{e.terms && <span id="ns-terms-err" className={ui.err}>{e.terms}</span>}</label>
      </div>
      {e.form && <p className={ui.err} role="alert">{e.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? t('proc.saving') : t('proc.add')}</button></div>
    </form>
  );
}

export function NewItemForm({ api, onCreated }: { api: Api; onCreated: (name: string) => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ name: '', kind: '', forKinds: '' });
  const [e, setE] = useState<{ name?: string; kind?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const next = { name: checkName(t, f.name, 'proc.field.name', 2, NAME_MAX), kind: f.kind ? '' : t('proc.v.choose') };
    setE({ name: next.name || undefined, kind: next.kind || undefined });
    if (next.name || next.kind) return;
    setBusy(true);
    try { await api.createItem({ name: f.name.replace(/\s+/g, ' ').trim(), kind: f.kind, forKinds: parseKinds(f.forKinds) }); setF({ name: '', kind: '', forKinds: '' }); onCreated(f.name.trim()); }
    catch (err) { setE({ form: t('proc.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-item-h" className={ui.formCard}>
      <h3 id="new-item-h" className={ui.h2}>{t('proc.new.item')}</h3>
      <div className={ui.formGrid}>
        <label className={ui.field}><span>{t('proc.field.name')}</span><input type="text" autoComplete="off" value={f.name} maxLength={NAME_MAX + 20} onChange={(x) => setF({ ...f, name: x.target.value })} aria-invalid={!!e.name} aria-describedby={e.name ? 'ni-name-err' : undefined} />{e.name && <span id="ni-name-err" className={ui.err}>{e.name}</span>}</label>
        <Pick id="ni-kind" label={t('proc.field.kind')} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} error={e.kind} options={[{ value: 'spare', label: t('proc.kind.spare') }, { value: 'equipment', label: t('proc.kind.equipment') }]} />
        <label className={ui.field}><span>{t('proc.field.forKinds')}</span><input type="text" autoComplete="off" value={f.forKinds} maxLength={300} onChange={(x) => setF({ ...f, forKinds: x.target.value })} /><span className={ui.muted}>{t('proc.hint.forKinds')}</span></label>
      </div>
      {e.form && <p className={ui.err} role="alert">{e.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? t('proc.saving') : t('proc.add')}</button></div>
    </form>
  );
}

export function NewOrderForm({ api, suppliers, items, onCreated }: { api: Api; suppliers: Supplier[]; items: StockItem[]; onCreated: (number: string) => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ supplierId: '', itemId: '', quantity: '', price: '' });
  const [e, setE] = useState<ReturnType<typeof checkOrder>['errors'] & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const { errors, value } = checkOrder(t, f);
    setE(errors);
    if (!value) return;
    setBusy(true);
    try { const r = await api.createOrder(value); setF({ supplierId: '', itemId: '', quantity: '', price: '' }); onCreated(r.number); }
    catch (err) { setE({ form: t('proc.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-ord-h" className={ui.formCard}>
      <h3 id="new-ord-h" className={ui.h2}>{t('proc.new.order')}</h3>
      <div className={ui.formGrid}>
        <Pick id="no-sup" label={t('proc.field.supplier')} value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} error={e.supplier} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <Pick id="no-item" label={t('proc.field.item')} value={f.itemId} onChange={(v) => setF({ ...f, itemId: v })} error={e.item} options={items.map((i) => ({ value: i.id, label: i.name }))} />
        <label className={ui.field}><span>{t('proc.field.quantity')}</span><input type="text" inputMode="numeric" autoComplete="off" value={f.quantity} maxLength={8} onChange={(x) => setF({ ...f, quantity: x.target.value })} aria-invalid={!!e.quantity} aria-describedby={e.quantity ? 'no-q-err' : undefined} />{e.quantity && <span id="no-q-err" className={ui.err}>{e.quantity}</span>}</label>
        <label className={ui.field}><span>{t('proc.field.price')}</span><input type="text" inputMode="numeric" autoComplete="off" value={f.price} maxLength={14} onChange={(x) => setF({ ...f, price: x.target.value })} aria-invalid={!!e.price} aria-describedby={e.price ? 'no-p-err' : undefined} />{e.price && <span id="no-p-err" className={ui.err}>{e.price}</span>}</label>
      </div>
      {e.form && <p className={ui.err} role="alert">{e.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? t('proc.saving') : t('proc.create')}</button></div>
    </form>
  );
}

export function AdjustForm({ api, item, onDone, onCancel }: { api: Api; item: StockItem; onDone: (message: string) => void; onCancel: () => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ delta: '', reason: '' });
  const [e, setE] = useState<{ delta?: string; reason?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const { errors, value } = checkAdjust(t, f);
    setE(errors);
    if (!value) return;
    setBusy(true);
    try { const r = await api.adjustStock(item.id, value); onDone(t('proc.adjusted', { name: item.name, onHand: r.onHand })); }
    catch (err) { setE({ form: errorText(err, t, 'server.unexpected') }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate aria-label={t('proc.adjustFor', { name: item.name })} className={ui.formCard}>
      <div className={ui.formGrid}>
        <label className={ui.field}><span>{t('proc.adjust.delta')}</span><input type="text" inputMode="numeric" autoComplete="off" value={f.delta} maxLength={8} onChange={(x) => setF({ ...f, delta: x.target.value })} aria-invalid={!!e.delta} />{e.delta && <span className={ui.err}>{e.delta}</span>}</label>
        <label className={ui.field}><span>{t('proc.adjust.reason')}</span><input type="text" autoComplete="off" value={f.reason} maxLength={140} onChange={(x) => setF({ ...f, reason: x.target.value })} aria-invalid={!!e.reason} />{e.reason && <span className={ui.err}>{e.reason}</span>}</label>
      </div>
      {e.form && <p className={ui.err} role="alert">{e.form}</p>}
      <div className={ui.formActions}>
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('proc.saving') : t('proc.adjust.save')}</button>
        <button type="button" className={ui.btnGhost} onClick={onCancel}>{t('capacity.cancel')}</button>
      </div>
    </form>
  );
}
