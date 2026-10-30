import { FormEvent, useEffect, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import { checkQuote, EditLine, EditQuote, LINE_CATEGORIES, MAX_LINES, MAX_MILESTONES, preview, toEdit } from '../lib/quotes';
import type { PositionRate, Quote, QuoteCatalogItem } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './QuotesView.module.css';

/** Armar o corregir una cotización (borrador o rechazada): hitos, y en cada hito líneas de materiales, insumos y mano de obra. El precio se calcula mientras se escribe. */
export function QuoteEditor({ quote, onSaved, onSubmitted, onClose }: { quote: Quote; onSaved: (q: Quote) => void; onSubmitted: (q: Quote) => void; onClose: () => void }) {
  const { api, t } = useSession();
  const [f, setF] = useState<EditQuote>(() => toEdit(quote));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [catalog, setCatalog] = useState<QuoteCatalogItem[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [rates, setRates] = useState<PositionRate[]>([]);
  useEffect(() => {
    let live = true;
    api.quoteCatalog().then((c) => { if (live) setCatalog(c); }).catch(() => { if (live) setCatalogFailed(true); });
    api.positionRates().then((r) => { if (live) setRates(r); }).catch(() => { /* sin tarifas se escribe a mano */ });
    return () => { live = false; };
  }, [api]);

  const p = preview(f);
  const setM = (i: number, patch: Partial<EditQuote['milestones'][number]>) => setF((x) => ({ ...x, milestones: x.milestones.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));
  const setL = (i: number, j: number, patch: Partial<EditLine>) => setF((x) => ({ ...x, milestones: x.milestones.map((m, k) => (k === i ? { ...m, lines: m.lines.map((l, n) => (n === j ? { ...l, ...patch } : l)) } : m)) }));
  const addLine = (i: number, line: EditLine) => setF((x) => ({ ...x, milestones: x.milestones.map((m, k) => (k === i && m.lines.length < MAX_LINES ? { ...m, lines: [...m.lines, line] } : m)) }));
  const blank = (category: EditLine['category'] = 'materials'): EditLine => ({ category, description: '', quantity: '1', unit: '', ref: null });

  async function persist(submit: boolean) {
    if (inflight.current) return;
    const { errors: errs, value } = checkQuote(t, f, submit);
    setErrors(errs);
    if (!value) return;
    inflight.current = true; setBusy(true);
    try {
      const saved = await api.saveQuote(quote.id, value);
      if (submit) onSubmitted(await api.submitQuote(quote.id)); else onSaved(saved);
    } catch (e) { setErrors([t('q.failed', { reason: errorText(e, t, 'server.unexpected') })]); }
    finally { inflight.current = false; setBusy(false); }
  }

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void persist(false); }} noValidate aria-label={t('q.openFor', { number: quote.number })} className={ui.formCard}>
      <div className={ui.formGrid}>
        <label className={ui.field}><span>{t('q.f.client')}</span><input type="text" autoComplete="off" maxLength={140} value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></label>
        <label className={ui.field}><span>{t('q.f.project')}</span><input type="text" autoComplete="off" maxLength={140} value={f.projectName} onChange={(e) => setF({ ...f, projectName: e.target.value })} /></label>
        <label className={ui.field}><span>{t('q.f.margin')}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={3} value={f.margin} onChange={(e) => setF({ ...f, margin: e.target.value })} /></label>
      </div>

      {f.milestones.map((m, i) => (
        <section key={i} className={s.milestone}>
          <label className={ui.field}><span>{t('q.f.milestone', { n: i + 1 })}</span><input type="text" autoComplete="off" maxLength={140} value={m.name} onChange={(e) => setM(i, { name: e.target.value })} /></label>
          {m.lines.map((l, j) => (
            <div key={j} className={s.line}>
              <fieldset className={`${ui.field} ${s.lineWide}`}><legend>{t('q.f.cat', { n: `${i + 1}.${j + 1}` })}</legend>
                <div className={ui.chips}>{LINE_CATEGORIES.map((c) => <button key={c} type="button" className={l.category === c ? ui.chipOn : ui.chip} aria-pressed={l.category === c} onClick={() => setL(i, j, { category: c })}>{t(`q.cat.short.${c}` as 'q.cat.short.labor')}</button>)}</div>
              </fieldset>
              <label className={`${ui.field} ${s.lineWide}`}><span>{t('q.f.desc', { n: `${i + 1}.${j + 1}` })}</span><input type="text" autoComplete="off" maxLength={140} value={l.description} onChange={(e) => setL(i, j, { description: e.target.value })} /></label>
              <label className={ui.field}><span>{t('q.f.qty', { n: `${i + 1}.${j + 1}` })}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={6} value={l.quantity} onChange={(e) => setL(i, j, { quantity: e.target.value })} /><span className={s.note}>{t('q.line.qtyUnit', { unit: t(l.category === 'labor' ? 'q.unit.labor' : 'q.unit.other') })}</span></label>
              <label className={ui.field}><span>{t('q.f.unit', { n: `${i + 1}.${j + 1}` })}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={10} value={l.unit} onChange={(e) => setL(i, j, { unit: e.target.value })} /></label>
              <div><button type="button" className={ui.btnGhost} aria-label={t('q.removeLine', { n: `${i + 1}.${j + 1}` })} onClick={() => setM(i, { lines: m.lines.filter((_, n) => n !== j) })}>×</button></div>
            </div>
          ))}
          <fieldset className={ui.field}><legend>{t('q.fromCatalogTo', { n: i + 1 })}</legend>
            {catalogFailed && <p className={ui.muted}>{t('q.noCatalog')}</p>}
            <div className={ui.chips}>{(catalog ?? []).map((c) => <button key={c.itemId} type="button" className={ui.chip} onClick={() => addLine(i, { category: c.kind === 'equipment' ? 'materials' : 'supplies', description: c.name, quantity: '1', unit: String(c.refPriceCop), ref: `proc:${c.itemId}` })}>{t('q.catalogItem', { name: c.name, price: formatCop(c.refPriceCop), supplier: c.supplier })}</button>)}</div>
          </fieldset>
          <fieldset className={ui.field}><legend>{t('q.fromRatesTo', { n: i + 1 })}</legend>
            <div className={ui.chips}>{rates.map((r) => <button key={r.position} type="button" className={ui.chip} onClick={() => addLine(i, { category: 'labor', description: t(`position.${r.position}` as 'position.tech_lead'), quantity: '1', unit: String(r.dailyCostCop), ref: `position:${r.position}` })}>{t('q.rateItem', { label: t(`position.${r.position}` as 'position.tech_lead'), daily: formatCop(r.dailyCostCop) })}</button>)}</div>
          </fieldset>
          <div className={s.actions}>
            <button type="button" className={ui.btnGhost} aria-label={t('q.addLineTo', { n: i + 1 })} onClick={() => addLine(i, blank())}>{t('q.addLine')}</button>
            <button type="button" className={ui.btnGhost} aria-label={t('q.removeMilestone', { n: i + 1 })} onClick={() => setF({ ...f, milestones: f.milestones.filter((_, k) => k !== i) })}>{t('q.removeMilestone', { n: i + 1 })}</button>
          </div>
          <p className={s.total}>{t('q.totals', { n: i + 1, cost: formatCop(p.milestones[i].cost), price: formatCop(p.milestones[i].price) })}</p>
        </section>
      ))}

      <div className={s.actions}>
        <button type="button" className={ui.btnGhost} disabled={f.milestones.length >= MAX_MILESTONES} onClick={() => setF({ ...f, milestones: [...f.milestones, { name: '', lines: [] }] })}>{t('q.addMilestone')}</button>
      </div>
      <p className={s.total} data-quote-sum>{t('q.sum', { cost: formatCop(p.cost), price: formatCop(p.price), profit: formatCop(p.profit) })}</p>
      {errors.length > 0 && <ul className={s.errors} role="alert">{errors.map((e, k) => <li key={k}>{e}</li>)}</ul>}
      <div className={ui.formActions}>
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('q.saving') : t('q.save')}</button>
        <button type="button" className={ui.btn} disabled={busy} onClick={() => void persist(true)}>{t('q.submit')}</button>
        <button type="button" className={ui.btnGhost} onClick={onClose}>{t('q.close')}</button>
      </div>
    </form>
  );
}
