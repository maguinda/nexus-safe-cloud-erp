import { EInvoiceDoc } from './document';
import { LEGAL_NOTICE_EN, LEGAL_NOTICE_ES } from './legal';
import { xmlEscape as h } from './xml';

const cop = (n: number) => `${new Intl.NumberFormat('es-CO').format(n)} COP`;

/**
 * Representación gráfica imprimible. Todo texto de afuera pasa por `h` (escape); el único HTML que no se escapa es el SVG del QR, que lo genera la
 * librería a partir de un texto nuestro. Se sirve con CSP restrictiva y sin scripts.
 */
export function buildInvoiceHtml(doc: EInvoiceDoc, invoice: { number: string; milestoneName: string; projectName: string; amountCop: number; taxCop: number; totalCop: number }, qrSvg: string): string {
  const party = (title: string, p: EInvoiceDoc['customer']) => `<section><h2>${h(title)}</h2><p><strong>${h(p.name)}</strong><br>NIT ${h(p.nit)}-${p.dv}<br>${h(p.address)}, ${h(p.city)}<br>${h(p.email)}</p></section>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(doc.number)} (sandbox)</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;color:#1a2b4a;background:#fff}
main{max-width:46rem;margin:0 auto;padding:1rem}
.banner{background:#b3261e;color:#fff;padding:.75rem 1rem;font-weight:700;margin:0 0 1rem}
.banner span{display:block;font-weight:500}
h1{font-size:1.25rem;margin:.25rem 0}h2{font-size:1rem;margin:1rem 0 .25rem}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}
table{width:100%;border-collapse:collapse;margin:.5rem 0}td,th{padding:.4rem;border-bottom:1px solid #ccd;text-align:left}td.n,th.n{text-align:right}
.cufe{word-break:break-all;font-family:ui-monospace,monospace;font-size:.8rem}
.qr{width:9rem;height:9rem}.qr svg{width:100%;height:100%}
</style></head><body><main>
<p class="banner" role="alert">${h(LEGAL_NOTICE_ES)}<span lang="en">${h(LEGAL_NOTICE_EN)}</span></p>
<h1>Factura electrónica de venta (documento de prueba) ${h(doc.number)}</h1>
<p>Fecha: ${h(doc.issueDate)} ${h(doc.issueTime)} · Vence: ${h(doc.dueDate)} · Factura interna ${h(invoice.number)}</p>
<div class="grid">${party('Emisor', doc.supplier)}${party('Adquirente', doc.customer)}</div>
<table><thead><tr><th>Descripción</th><th class="n">Valor</th></tr></thead><tbody>
<tr><td>${h(invoice.milestoneName)} (${h(invoice.projectName)})</td><td class="n">${h(cop(invoice.amountCop))}</td></tr>
<tr><td>IVA 19 %</td><td class="n">${h(cop(invoice.taxCop))}</td></tr>
<tr><th>Total</th><th class="n">${h(cop(invoice.totalCop))}</th></tr></tbody></table>
<p>CUFE (calculado con una clave técnica de prueba, no oficial):</p><p class="cufe">${h(doc.cufe)}</p>
<div class="qr" role="img" aria-label="Código QR de prueba. No verifica nada real.">${qrSvg}</div>
<p>El código QR es de prueba y no verifica nada real.</p>
</main></body></html>
`;
}
