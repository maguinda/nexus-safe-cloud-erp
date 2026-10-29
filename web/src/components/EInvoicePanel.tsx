import { useEffect, useRef, useState } from 'react';
import { actionsFor, E_STATUS, FIELD_MAX, forPanel, validateFiscalForm, xmlFileName } from '../lib/einvoice';
import type { FormErrors } from '../lib/einvoice';
import type { MsgKey } from '../i18n';
import { errorText } from '../i18n/server';
import type { Invoice } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './EInvoicePanel.module.css';

const TONE = { neutral: s.chip, warn: s.chipWarn, ok: s.chipOk } as const;

/**
 * Factura electrónica de PRUEBA dentro de Facturas (solo el analista de facturación). SIEMPRE dice que no tiene validez legal. Genera el documento de una
 * factura emitida, lo muestra, descarga su XML, simula el envío al proveedor y registra el envío por correo (no se envía nada).
 */
export function EInvoicePanel({ invoices, reload, toast }: { invoices: Invoice[]; reload: () => Promise<void>; toast: (m: string) => void }) {
  const { api, t } = useSession();
  // Un bloqueo POR ACCIÓN (el final de una no libera a otra que sigue en curso) y una guardia síncrona: un doble clic muy rápido llega antes de que React vuelva a pintar.
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const inflight = useRef(new Set<string>());
  const busy = (key: string) => busyKeys.includes(key);
  const [formFor, setFormFor] = useState<Invoice | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const rows = forPanel(invoices);

  async function run(key: string, work: () => Promise<void>) {
    if (inflight.current.has(key)) return;
    inflight.current.add(key); setBusyKeys([...inflight.current]);
    try { await work(); } catch (e) {
      toast(errorText(e, t, 'einv.toast.failed')); // cada 409 dice su razón real (faltan datos, rango agotado, resolución vencida, IVA distinto del 19 %…)
    } finally { inflight.current.delete(key); setBusyKeys([...inflight.current]); await reload(); }
  }
  const openForm = (i: Invoice) => { opener.current = document.activeElement as HTMLElement | null; setFormFor(i); };
  const closeForm = () => { setFormFor(null); setTimeout(() => opener.current?.focus(), 0); };
  const generate = (i: Invoice) => run(`g:${i.number}`, async () => {
    const d = await api.eInvoiceGenerate(i.number);
    toast(t('einv.toast.generated', { n: i.number, doc: d.number }));
  });
  const submit = (i: Invoice) => run(`s:${i.number}`, async () => { await api.eInvoiceSubmit(i.number); toast(t('einv.toast.submitted', { n: i.number })); });
  const deliver = (i: Invoice) => run(`d:${i.number}`, async () => { await api.eInvoiceDeliver(i.number); toast(t('einv.toast.delivered', { n: i.number })); });
  const download = (i: Invoice) => run(`x:${i.number}`, async () => {
    const xml = await api.eInvoiceXml(i.number);
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = xmlFileName(i.number); // el servidor ya manda su nombre; aquí el archivo se llama como la factura interna, solo con letras y dígitos
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  const view = (i: Invoice) => {
    // La pestaña se abre ANTES de pedir el documento: después de un await los navegadores (Safari) la bloquean como ventana emergente.
    const tab = window.open('about:blank', '_blank');
    if (!tab) { toast(t('einv.toast.popupBlocked')); return; } // nada de «abierta en otra pestaña» si el navegador la bloqueó
    void run(`v:${i.number}`, async () => {
      try {
        const html = await api.eInvoiceHtml(i.number);
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        tab.location.replace(url);
        toast(t('einv.opened'));
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) { tab.close(); throw e; }
    });
  };

  return (
    <section aria-labelledby="einv-h" className={s.panel}>
      <h2 id="einv-h" className={ui.h2}>{t('einv.title')}</h2>
      <p className={s.banner} role="note">{t('einv.banner')}</p>
      <p className={s.hint}>{t('einv.intro')}</p>
      {rows.length === 0 ? <div className={s.empty}>{t('einv.empty')}</div> : (
        <div className={ui.scroll}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('einv.caption')}</caption>
            <thead><tr><th>{t('einv.col.invoice')}</th><th>{t('einv.col.client')}</th><th>{t('einv.col.status')}</th><th>{t('einv.col.actions')}</th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const st = E_STATUS[i.electronicStatus];
                const can = actionsFor(i.electronicStatus);
                const label = (action: MsgKey) => t('einv.action.for', { action: t(action), invoice: i.number });
                return (
                  <tr key={i.number}>
                    <td className={ui.mono}>{i.number}</td>
                    <td data-label={t('einv.col.client')} className={s.client}>{i.clientName ?? <span className={ui.muted}>{t('einv.noClient')}</span>}</td>
                    <td data-label={t('einv.col.status')}><span className={TONE[st.tone]}>{t(st.label)}</span></td>
                    <td data-label={t('einv.col.actions')}>
                      <div className={s.actions}>
                        {can.data && <button type="button" className={ui.btnGhost} aria-label={label('einv.action.data')} onClick={() => openForm(i)}>{t('einv.action.data')}</button>}
                        {can.generate && <button type="button" className={ui.btn} disabled={busy(`g:${i.number}`)} aria-label={label('einv.action.generate')} onClick={() => void generate(i)}>{t('einv.action.generate')}</button>}
                        {can.view && <button type="button" className={ui.btnGhost} disabled={busy(`v:${i.number}`)} aria-label={label('einv.action.view')} onClick={() => view(i)}>{t('einv.action.view')}</button>}
                        {can.view && <button type="button" className={ui.btnGhost} disabled={busy(`x:${i.number}`)} aria-label={label('einv.action.xml')} onClick={() => void download(i)}>{t('einv.action.xml')}</button>}
                        {can.submit && <button type="button" className={ui.btnGhost} disabled={busy(`s:${i.number}`)} aria-label={label('einv.action.submit')} onClick={() => void submit(i)}>{t('einv.action.submit')}</button>}
                        {can.deliver && <button type="button" className={ui.btnGhost} disabled={busy(`d:${i.number}`)} aria-label={label('einv.action.deliver')} onClick={() => void deliver(i)}>{t('einv.action.deliver')}</button>}
                        {!can.data && !can.view && <span className={ui.muted}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {formFor && <FiscalForm invoice={formFor} onClose={closeForm} onSaved={async (name) => { toast(t('einv.toast.customerSaved', { name })); closeForm(); await reload(); }} />}
    </section>
  );
}

function FiscalForm({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const { api, t } = useSession();
  const name = invoice.clientName ?? '';
  const [f, setF] = useState({ nit: '', email: '', address: '', city: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [failed, setFailed] = useState<{ cause: unknown } | null>(null);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []); // al abrir, el foco pasa al formulario (si no, quien usa teclado o lector de pantalla no sabe que apareció)
  const MSG = { required: 'einv.form.required', nitInvalid: 'einv.form.nitInvalid', emailInvalid: 'einv.form.emailInvalid', textInvalid: 'einv.form.textInvalid' } as const;
  const text = (k: keyof FormErrors) => (errors[k] ? t(MSG[errors[k]!]) : '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateFiscalForm(f);
    setErrors(found); setFailed(null);
    const firstBad = (['nit', 'email', 'address', 'city'] as const).find((k) => found[k]);
    if (firstBad) { document.getElementById(`fi-${firstBad}`)?.focus(); return; } // el foco va al primer campo con error
    setSaving(true);
    try { await api.putCustomer({ name, ...f }); await onSaved(name); }
    catch (err) { setFailed({ cause: err }); setSaving(false); }
  }
  const field = (k: 'nit' | 'email' | 'address' | 'city', label: MsgKey) => (
    <label className={ui.field}>
      <span>{t(label)}</span>
      <input id={`fi-${k}`} value={f[k]} maxLength={FIELD_MAX[k]} autoComplete="off" onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `fi-${k}-err` : undefined} />
      {errors[k] && <span id={`fi-${k}-err`} className={ui.err}>{text(k)}</span>}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate aria-labelledby="fiscal-h" className={ui.formCard}>
      <h3 id="fiscal-h" ref={heading} tabIndex={-1} className={ui.h2}>{t('einv.form.title', { name })}</h3>
      <p className={s.hint}>{t('einv.form.hint')}</p>
      <div className={ui.formGrid}>{field('nit', 'einv.form.nit')}{field('email', 'einv.form.email')}{field('address', 'einv.form.address')}{field('city', 'einv.form.city')}</div>
      {failed && <p role="alert" className={ui.err}>{errorText(failed.cause, t, 'einv.toast.failed')}</p>}
      <div className={ui.formActions}>
        <button type="submit" className={ui.btn} disabled={saving}>{saving ? t('einv.form.saving') : t('einv.form.save')}</button>
        <button type="button" className={ui.btnGhost} onClick={onClose}>{t('einv.form.cancel')}</button>
      </div>
    </form>
  );
}
