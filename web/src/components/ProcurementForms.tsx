import { FormEvent, useEffect, useState } from 'react';
import type { Api } from '../lib/api';
import { errorText } from '../i18n/server';
import { checkAdjust, checkCatalog, checkName, checkOrder, checkTender, NAME_MAX, parseKinds, TERMS_MAX } from '../lib/procurement';
import { formatCop } from '../lib/format';
import type { StockItem, Supplier } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

export type Choice = { value: string; label: string };

/** Elegir entre pocas opciones con botones (no un <select> nativo: en WebKit mide menos de 32 px y la auditoría lo rechaza). */
export function Pick({ label, value, onChange, options, error, id, wrap }: { label: string; value: string; onChange: (v: string) => void; options: Choice[]; error?: string; id: string; wrap?: boolean }) {
  return (
    <fieldset className={wrap ? `${ui.field} ${ui.fieldWide}` : ui.field} aria-describedby={error ? `${id}-err` : undefined}>
      <legend>{label}</legend>
      <div className={wrap ? ui.chips : ui.seg}>
        {options.map((o) => <button key={o.value} type="button" className={wrap ? (value === o.value ? ui.chipOn : ui.chip) : (value === o.value ? ui.segBtnOn : ui.segBtn)} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
      {error && <span id={`${id}-err`} className={ui.err}>{error}</span>}
    </fieldset>
  );
}

export function NewSupplierForm({ api, onCreated }: { api: Api; onCreated: (name: string) => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ name: '', kind: '', terms: '', tenderRef: '', validUntil: '' });
  const [e, setE] = useState<{ name?: string; kind?: string; terms?: string; tenderRef?: string; validUntil?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const next = { name: checkName(t, f.name, 'proc.field.name', 2, NAME_MAX), kind: f.kind ? '' : t('proc.v.choose'), terms: f.terms.trim() ? checkName(t, f.terms, 'proc.field.terms', 2, TERMS_MAX) : '' };
    const tender = f.kind === 'tender' ? checkTender(t, { ref: f.tenderRef, until: f.validUntil }) : { errors: {} as { ref?: string; until?: string }, value: {} };
    setE({ name: next.name || undefined, kind: next.kind || undefined, terms: next.terms || undefined, tenderRef: tender.errors.ref, validUntil: tender.errors.until });
    if (next.name || next.kind || next.terms || tender.errors.ref || tender.errors.until) return;
    setBusy(true);
    try { await api.createSupplier({ name: f.name.replace(/\s+/g, ' ').trim(), kind: f.kind, terms: f.terms.replace(/\s+/g, ' ').trim(), ...tender.value }); setF({ name: '', kind: '', terms: '', tenderRef: '', validUntil: '' }); onCreated(f.name.trim()); }
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
      {f.kind === 'tender' && (
        <div className={ui.formGrid}>
          <label className={ui.field}><span>{t('cat.field.tenderRef')}</span><input type="text" autoComplete="off" maxLength={60} value={f.tenderRef} onChange={(x) => setF({ ...f, tenderRef: x.target.value })} aria-invalid={!!e.tenderRef} />{e.tenderRef && <span className={ui.err}>{e.tenderRef}</span>}</label>
          <label className={ui.field}><span>{t('cat.field.until')}</span><input type="date" value={f.validUntil} onChange={(x) => setF({ ...f, validUntil: x.target.value })} aria-invalid={!!e.validUntil} />{e.validUntil && <span className={ui.err}>{e.validUntil}</span>}</label>
        </div>
      )}
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
  const [project, setProject] = useState('');
  const [projects, setProjects] = useState<string[]>([]);
  useEffect(() => { let live = true; api.projects().then((p) => { if (live) setProjects(p.map((x) => x.name)); }).catch(() => { /* el proyecto es opcional */ }); return () => { live = false; }; }, [api]);
  const [e, setE] = useState<ReturnType<typeof checkOrder>['errors'] & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const supplier = suppliers.find((x) => x.id === f.supplierId);
  // Con un proveedor elegido solo se ofrece lo que vende (su catálogo); el precio de referencia sale como pista.
  const sold = supplier?.catalog;
  const options = sold ? items.filter((i) => sold.some((c) => c.itemId === i.id)) : items;
  const ref = sold?.find((c) => c.itemId === f.itemId);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const { errors, value } = checkOrder(t, f);
    setE(errors);
    if (!value) return;
    setBusy(true);
    try { const r = await api.createOrder({ ...value, ...(project ? { projectName: project } : {}) }); setF({ supplierId: '', itemId: '', quantity: '', price: '' }); setProject(''); onCreated(r.number); }
    catch (err) { setE({ form: t('proc.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-ord-h" className={ui.formCard}>
      <h3 id="new-ord-h" className={ui.h2}>{t('proc.new.order')}</h3>
      <div className={ui.formGrid}>
        <Pick id="no-sup" label={t('proc.field.supplier')} value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v, itemId: '' })} error={e.supplier} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <Pick id="no-item" label={t('proc.field.item')} value={f.itemId} onChange={(v) => setF({ ...f, itemId: v })} error={e.item} options={options.map((i) => ({ value: i.id, label: i.name }))} />
        {supplier && options.length === 0 && <p className={ui.muted}>{t('cat.noItemsForSupplier')}</p>}
        {projects.length > 0 && <Pick wrap id="no-project" label={t('proc.field.project')} value={project} onChange={(v) => setProject(v === project ? '' : v)} options={projects.map((p) => ({ value: p, label: p }))} />}
        <label className={ui.field}><span>{t('proc.field.quantity')}</span><input type="text" inputMode="numeric" autoComplete="off" value={f.quantity} maxLength={8} onChange={(x) => setF({ ...f, quantity: x.target.value })} aria-invalid={!!e.quantity} aria-describedby={e.quantity ? 'no-q-err' : undefined} />{e.quantity && <span id="no-q-err" className={ui.err}>{e.quantity}</span>}</label>
        <label className={ui.field}><span>{t('proc.field.price')}</span>{ref && <span className={ui.muted}>{t('cat.refHint', { price: formatCop(ref.refPriceCop), days: ref.leadDays })}</span>}<input type="text" inputMode="numeric" autoComplete="off" value={f.price} maxLength={14} onChange={(x) => setF({ ...f, price: x.target.value })} aria-invalid={!!e.price} aria-describedby={e.price ? 'no-p-err' : undefined} />{e.price && <span id="no-p-err" className={ui.err}>{e.price}</span>}</label>
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

/** Catálogo de un proveedor: qué vende, a qué precio de referencia y en cuántos días entrega. Solo gerencia. */
export function CatalogForm({ api, supplier, items, onDone, onCancel }: { api: Api; supplier: Supplier; items: StockItem[]; onDone: (message: string) => void; onCancel: () => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ itemId: '', price: '', days: '' });
  const [e, setE] = useState<{ item?: string; price?: string; days?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const { errors, value } = checkCatalog(t, f);
    const next = { ...errors, item: f.itemId ? undefined : t('proc.v.choose') };
    setE(next);
    if (!value || next.item) return;
    setBusy(true);
    try { await api.setCatalog(supplier.id, f.itemId, value); onDone(t('cat.saved', { name: supplier.name })); }
    catch (err) { setE({ form: t('proc.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate aria-label={t('cat.edit', { name: supplier.name })} className={ui.formCard}>
      <div className={ui.formGrid}>
        <Pick id={`cat-item-${supplier.id}`} label={t('cat.field.item')} value={f.itemId} onChange={(v) => { const c = supplier.catalog?.find((x) => x.itemId === v); setF({ itemId: v, price: c ? String(c.refPriceCop) : f.price, days: c ? String(c.leadDays) : f.days }); }} error={e.item} options={items.map((i) => ({ value: i.id, label: i.name }))} />
        <label className={ui.field}><span>{t('cat.field.price')}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={14} value={f.price} onChange={(x) => setF({ ...f, price: x.target.value })} aria-invalid={!!e.price} />{e.price && <span className={ui.err}>{e.price}</span>}</label>
        <label className={ui.field}><span>{t('cat.field.days')}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={f.days} onChange={(x) => setF({ ...f, days: x.target.value })} aria-invalid={!!e.days} />{e.days && <span className={ui.err}>{e.days}</span>}</label>
      </div>
      {e.form && <p className={ui.err} role="alert">{e.form}</p>}
      <div className={ui.formActions}>
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('proc.saving') : t('cat.save')}</button>
        <button type="button" className={ui.btnGhost} onClick={onCancel}>{t('proc.orders.cancel')}</button>
      </div>
    </form>
  );
}
