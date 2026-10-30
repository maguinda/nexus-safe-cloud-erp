import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import type { PositionRate, Quote } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { QuoteEditor } from './QuoteEditor';
import s from './QuotesView.module.css';

const badge = (st: Quote['status']) => (st === 'approved' ? s.badgeOk : st === 'rejected' ? s.badgeBad : st === 'pending' ? s.badgeWarn : s.badge);

/** Cotizaciones: ventas arma y envía; gerencia aprueba o rechaza (al aprobar nacen el proyecto, sus hitos y el contrato). */
export function QuotesView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t } = useSession();
  const alive = useAlive();
  const isManager = user?.role === 'manager';
  const canWrite = isManager || user?.role === 'sales';
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ client: '', project: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [rates, setRates] = useState<PositionRate[] | null>(null);
  const [showRates, setShowRates] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.quotes(); if (alive.current) { setRows(r); setError(''); } } catch (e) { if (alive.current) setError(t('q.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let live = true; api.positionRates().then((r) => { if (live) setRates(r); }).catch(() => { /* las tarifas son ayuda: sin ellas la pantalla sigue */ }); return () => { live = false; }; }, [api]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); await load(); } catch (e) { toast(t('q.failed', { reason: errorText(e, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(''); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const c = form.client.replace(/\s+/g, ' ').trim(), p = form.project.replace(/\s+/g, ' ').trim();
    const bad = (x: string) => x.length < 2 || x.length > 120 || /[\u0000-\u001f<>]/.test(x);
    if (bad(c)) { setFormError(t('q.v.client')); return; }
    if (bad(p)) { setFormError(t('q.v.project')); return; }
    setFormError('');
    await act('new', async () => { const q = await api.createQuote(c, p); setForm({ client: '', project: '' }); setOpenId(q.id); return t('q.created', { number: q.number }); });
  }

  const money = (n: number) => t('q.money', { amount: formatCop(n) });

  return (
    <section aria-labelledby="q-h" className={s.stack}>
      <h2 id="q-h" className={ui.h2}>{t('q.title')}</h2>
      <p className={ui.muted}>{t('q.intro')}</p>

      {rates && rates.length > 0 && (
        <div>
          <button type="button" className={ui.btnGhost} aria-expanded={showRates} onClick={() => setShowRates(!showRates)}>{showRates ? t('q.rates.hide') : t('q.rates.show')}</button>
          {showRates && <RatesPanel rates={rates} isManager={isManager} toast={toast} onChanged={(r) => setRates(r)} />}
        </div>
      )}

      {canWrite && (
        <form onSubmit={(e) => void create(e)} noValidate aria-label={t('q.new')} className={ui.formCard}>
          <h3 className={ui.h2}>{t('q.new')}</h3>
          <div className={ui.formGrid}>
            <label className={ui.field}><span>{t('q.new.client')}</span><input type="text" autoComplete="off" maxLength={140} value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></label>
            <label className={ui.field}><span>{t('q.new.project')}</span><input type="text" autoComplete="off" maxLength={140} value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} /></label>
          </div>
          {formError && <p className={ui.err} role="alert">{formError}</p>}
          <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy === 'new'}>{t('q.new.create')}</button></div>
        </form>
      )}

      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {rows === null && !error ? <p role="status" className={ui.muted}>{t('q.loading')}</p> : rows && rows.length === 0 ? <p className={ui.muted}>{t('q.empty')}</p> : (
        <ul className={s.list}>
          {(rows ?? []).map((q) => (
            <li key={q.id} className={s.card} data-quote={q.number} data-status={q.status}>
              <div className={s.head}>
                <div>
                  <h3 className={s.title}>{q.number} <span className={badge(q.status)}>{t(`q.status.${q.status}` as 'q.status.draft')}</span></h3>
                  <span className={s.sub}>{t('q.row', { client: q.client, project: q.projectName })}</span>
                </div>
                <button type="button" className={ui.btnGhost} aria-expanded={openId === q.id} aria-label={t('q.openFor', { number: q.number })} onClick={() => setOpenId(openId === q.id ? null : q.id)}>{openId === q.id ? t('q.close') : t('q.open')}</button>
              </div>
              <p className={s.nums}><span>{t('q.cost')}: {money(q.costCop)}</span><span>{t('q.price')}: {money(q.priceCop)}</span><span>{t('q.profit')}: {money(q.profitCop)}</span><span>{t('q.margin')}: {q.marginPct}%</span></p>
              {q.lowMargin && <p className={s.badgeWarn}>{t('q.lowMargin')}</p>}
              <p className={s.note}>{t('q.by', { who: q.createdBy })}{q.decidedBy ? ` · ${t('q.decision', { who: q.decidedBy })}` : ''}{q.projectId ? ` · ${t('q.project', { id: q.projectId })}` : ''}</p>
              {q.status === 'rejected' && q.decisionNote && <p className={s.note}>{t('q.reason', { note: q.decisionNote })}</p>}

              {openId === q.id && (q.status === 'draft' || q.status === 'rejected') && canWrite ? (
                <QuoteEditor key={`${q.id}:${q.status}`} quote={q} onClose={() => setOpenId(null)}
                  onSaved={(x) => { toast(t('q.saved', { number: x.number })); void load(); }}
                  onSubmitted={(x) => { toast(t('q.submitted', { number: x.number })); setOpenId(null); void load(); }} />
              ) : openId === q.id ? (
                <div>
                  <p className={ui.muted}>{q.status === 'pending' || q.status === 'approved' ? t('q.readonly') : ''}</p>
                  <ul className={s.rates}>{q.milestones.map((m, i) => <li key={i} className={s.rate} data-milestone={m.name}><strong>{m.name}</strong><span>{t('q.totals', { n: i + 1, cost: formatCop(m.costCop), price: formatCop(m.priceCop) })}</span></li>)}</ul>
                </div>
              ) : null}

              {isManager && q.status === 'pending' && (
                <div className={s.actions}>
                  <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('q.approveFor', { number: q.number })} onClick={() => void act(`a:${q.id}`, async () => { const r = await api.approveQuote(q.id); return t('q.approved', { number: r.number }); })}>{t('q.approve')}</button>
                  <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('q.rejectFor', { number: q.number })} onClick={() => { setRejecting(rejecting === q.id ? null : q.id); setReason(''); setReasonError(''); }}>{t('q.reject')}</button>
                </div>
              )}
              {isManager && rejecting === q.id && (
                <form noValidate className={ui.formCard} aria-label={t('q.rejectFor', { number: q.number })} onSubmit={(e) => {
                  e.preventDefault(); const n = reason.replace(/\s+/g, ' ').trim();
                  if (n.length < 3 || n.length > 300 || /[\u0000-\u001f<>]/.test(n)) { setReasonError(t('q.v.reason')); return; }
                  setReasonError(''); void act(`r:${q.id}`, async () => { const r = await api.rejectQuote(q.id, n); setRejecting(null); return t('q.rejected', { number: r.number }); });
                }}>
                  <label className={ui.field}><span>{t('q.reject.reason')}</span><input type="text" autoComplete="off" maxLength={320} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!reasonError} />{reasonError && <span className={ui.err}>{reasonError}</span>}</label>
                  <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={!!busy}>{t('q.reject.confirm')}</button></div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tarifas de referencia por cargo (sueldo mensual estimado del mercado). Gerencia las ajusta; ventas y líderes las ven. */
function RatesPanel({ rates, isManager, toast, onChanged }: { rates: PositionRate[]; isManager: boolean; toast: (m: string) => void; onChanged: (r: PositionRate[]) => void }) {
  const { api, t } = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent, r: PositionRate) {
    e.preventDefault();
    const v = text.trim();
    if (!/^\d{1,9}$/.test(v) || Number(v) < 1 || Number(v) > 200_000_000) { setError(t('cost.v.cost', { max: (200_000_000).toLocaleString('es-CO') })); return; }
    setBusy(true); setError('');
    try { await api.setPositionRate(r.position, Number(v)); onChanged(await api.positionRates()); toast(t('q.rates.saved', { label: t(`position.${r.position}` as 'position.tech_lead') })); setEditing(null); }
    catch (x) { setError(t('q.failed', { reason: errorText(x, t, 'server.unexpected') })); } finally { setBusy(false); }
  }
  return (
    <div className={ui.formCard}>
      <h3 className={ui.h2}>{t('q.rates.title')}</h3>
      <p className={ui.muted}>{t('q.rates.intro')}</p>
      <ul className={s.rates}>
        {rates.map((r) => {
          const label = t(`position.${r.position}` as 'position.tech_lead');
          return (
            <li key={r.position} className={s.rate} data-rate={r.position}>
              <span>{t('q.rates.row', { label, salary: formatCop(r.monthlySalaryCop), monthly: formatCop(r.cost.monthlyCop), daily: formatCop(r.dailyCostCop) })}</span>
              <span className={s.note}>{t('q.rates.breakdown', { prestaciones: formatCop(r.cost.prestacionesCop), pension: formatCop(r.cost.pensionCop), caja: formatCop(r.cost.cajaCop), arl: formatCop(r.cost.arlCop), aid: formatCop(r.cost.transportAidCop) })}</span>
              {isManager && editing !== r.position && <button type="button" className={ui.btnGhost} aria-label={t('q.rates.edit', { label })} onClick={() => { setEditing(r.position); setText(String(r.monthlySalaryCop)); setError(''); }}>{t('cost.change')}</button>}
              <span className={s.note}>{r.note}</span>
              {isManager && editing === r.position && (
                <form noValidate aria-label={t('q.rates.edit', { label })} onSubmit={(e) => void save(e, r)}>
                  <label className={ui.field}><span>{t('q.rates.field')}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={9} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!error} />{error && <span className={ui.err}>{error}</span>}</label>
                  <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{t('q.rates.save')}</button><button type="button" className={ui.btnGhost} onClick={() => setEditing(null)}>{t('cost.cancel')}</button></div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
