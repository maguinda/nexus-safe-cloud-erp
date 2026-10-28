import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard';

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe('KpiCard', () => {
  it('escribe la etiqueta y, justo después, la cifra (las pruebas y los lectores de pantalla la leen a continuación)', () => {
    const out = html(<KpiCard icon="layers" label="Proyectos activos" value={3} />);
    expect(out.indexOf('<small')).toBeGreaterThan(-1);
    expect(out.indexOf('<strong')).toBeGreaterThan(out.indexOf('</small>'));
    expect(out).toContain('Proyectos activos');
    expect(out).toContain('>3<');
  });

  it('el ícono solo decora: está oculto a los lectores de pantalla y no es enfocable', () => {
    const out = html(<KpiCard icon="alert" label="Alertas" value={0} />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('focusable="false"');
  });

  it('la línea de apoyo aparece solo si se pide', () => {
    expect(html(<KpiCard icon="pulse" label="L" value={1} />)).not.toContain('kpiSub');
    expect(html(<KpiCard icon="pulse" label="L" value={1} sub="4.158 en estado normal" />)).toContain('4.158 en estado normal');
  });

  it('el tono cambia el ícono pero nunca el texto: sin tono no agrega clase de tono', () => {
    const none = html(<KpiCard icon="clock" label="L" value={1} />);
    const warn = html(<KpiCard icon="clock" tone="warn" label="L" value={1} />);
    expect(warn).not.toBe(none);
    expect(warn).toContain('warn');
    expect(none).not.toContain('warn');
  });

  it('acepta cifras compuestas y una clase extra para la cifra', () => {
    const out = html(<KpiCard icon="signal" label="En línea" value={<>{21} / {21}</>} valueClass="extra" />);
    expect(out).toContain('extra');
    expect(out.replace(/<!-- -->/g, '')).toContain('21 / 21');
  });

  it('cada nombre de ícono dibuja un svg', () => {
    for (const n of ['layers', 'clock', 'document', 'check', 'hourglass', 'receipt', 'signal', 'pulse', 'warning', 'alert'] as const) expect(html(<KpiCard icon={n} label="L" value={0} />)).toContain('<svg');
  });
});
