import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { makeT } from '../../i18n';
import { coverageRows } from '../../lib/netview';
import type { Insight, NetworkSummary } from '../../lib/types';
import { CoverageGrid } from './CoverageGrid';
import { InsightCards } from './InsightCards';
import { NetCharts } from './NetCharts';
import { NetKpis } from './NetKpis';

const infra = (name: string, criticality: string, over: Partial<NetworkSummary['infrastructure'][number]> = {}) => ({ name, model: '3560-24PS', role: 'Core', criticality, ips: '10.0.0.2', syslog: false, snmp: false, ntp: false, netflow: false, signals: 12, ...over });
const summary = (): NetworkSummary => ({
  asOf: '2026-10-26T12:00:00Z',
  totals: { devices: 76, links: 74, criticalDevices: 5, infrastructure: 3 },
  byCategory: [{ category: 'Laptop', count: 36 }, { category: 'PC', count: 11 }, { category: 'Router', count: 2 }],
  byCriticality: [{ criticality: 'Crítica', count: 5 }, { criticality: 'Alta', count: 5 }, { criticality: 'Media', count: 66 }],
  links: { total: 74, functional: 69, notFunctional: 0, noData: 5, byType: [{ type: 'eCopper', count: 69 }, { type: 'eCustomIOLink', count: 5 }], byCriticality: [{ criticality: 'Crítica', count: 11 }, { criticality: 'Alta', count: 63 }, { criticality: 'Media', count: 0 }] },
  monitoring: { equipment: 3, syslog: 0, snmp: 0, ntp: 0, netflow: 1, withoutAnyConfig: 2, signalsPossible: 12 },
  infrastructure: [infra('ASA0', 'Crítica'), infra('Multilayer Switch0', 'Crítica', { netflow: true }), infra('SW1 P1', 'Alta')],
  insights: [],
});
const insights: Insight[] = [
  { code: 'monitoring_basics_missing', severity: 'high', params: { equipment: 3, syslog: 0, snmp: 0, ntp: 0 } },
  { code: 'critical_unmonitored', severity: 'high', params: { count: 1, critical: 2, names: 'ASA0' } },
  { code: 'netflow_partial', severity: 'medium', params: { withNetflow: 1, equipment: 3 } },
  { code: 'links_without_status', severity: 'info', params: { count: 5 } },
];
const crossLinks = [{ id: 1, origin: 'a', originPort: 'p', destination: 'b', destinationPort: 'q', linkType: 'eCopper', cableType: null, functional: true, length: 1, criticality: 'Alta' }];

describe.each(['es', 'en'] as const)('Red [%s]', (lang) => {
  const t = makeT(lang);
  it('InsightCards: una tarjeta por hallazgo, con gravedad en texto, la frase con sus números, cómo se detectó y su botón', () => {
    const html = renderToStaticMarkup(<InsightCards insights={insights} t={t} onAction={vi.fn()} />);
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toContain(t('netview.severity.high')); expect(html).toContain(t('netview.severity.medium')); expect(html).toContain(t('netview.severity.info'));
    expect(html).toContain(t('netview.insight.critical_unmonitored.text', insights[1].params));
    expect(html).toContain('ASA0'); // el nombre del equipo, tal cual
    expect(html.match(/<button /g)).toHaveLength(4); // los 4 llevan a algún lado
    for (const k of ['netview.action.devices', 'netview.action.critical', 'netview.action.links'] as const) expect(html).toContain(t(k));
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/); // ningún marcador sin llenar
  });
  it('InsightCards: la gravedad se dice con icono y con texto, no solo con color', () => {
    const html = renderToStaticMarkup(<InsightCards insights={[insights[0]]} t={t} onAction={vi.fn()} />);
    expect(html).toContain('aria-hidden="true">✕</span>'); expect(html).toContain(t('netview.severity.high'));
  });
  it('InsightCards: «todo cubierto» no tiene botón y un código desconocido no se muestra', () => {
    const html = renderToStaticMarkup(<InsightCards insights={[{ code: 'all_covered', severity: 'info', params: {} }, { code: 'algo_nuevo' as never, severity: 'high', params: {} }]} t={t} onAction={vi.fn()} />);
    expect(html.match(/<li /g)).toHaveLength(1); expect(html).not.toContain('<button'); expect(html).not.toContain('algo_nuevo');
  });
  it('InsightCards: sin hallazgos no pinta ni el título', () => { expect(renderToStaticMarkup(<InsightCards insights={[]} t={t} onAction={vi.fn()} />)).toBe(''); });

  it('CoverageGrid: una fila por equipo con ✓/✗ y su texto oculto, el nombre es un botón y el resumen cuenta lo que se ve', () => {
    const s = summary(); const rows = coverageRows(s);
    const html = renderToStaticMarkup(<CoverageGrid rows={rows} lang={lang} t={t} signals={12} onViewLinks={vi.fn()} />);
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr>/g)).toHaveLength(3);
    expect(html.match(/✗/g)!.length).toBe(11); // 3 equipos × 4 columnas − 1 NetFlow configurado
    expect(html.match(/✓/g)).toHaveLength(1);
    expect(html).toContain(t('netview.coverage.off')); expect(html).toContain(t('netview.coverage.on'));
    expect(html).toContain(`aria-label="${t('netview.coverage.viewLinks', { name: 'ASA0' })}"`);
    expect(html).toContain('scope="row"'); expect(html).toContain('<caption');
    expect(html).toContain(t('netview.coverage.summary', { syslog: 0, snmp: 0, ntp: 0, netflow: 1, n: 3 }));
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
  it('CoverageGrid: sin equipos muestra el estado vacío, no una tabla', () => {
    const html = renderToStaticMarkup(<CoverageGrid rows={[]} lang={lang} t={t} signals={0} onViewLinks={vi.fn()} />);
    expect(html).not.toContain('<table');
  });

  it('NetKpis: cinco tarjetas, cada una con «Ver detalle» que dice de qué cifra es, y el medidor de monitoreo básico dice 0 de 3', () => {
    const s = summary(); const html = renderToStaticMarkup(<NetKpis summary={s} rows={coverageRows(s)} lang={lang} t={t} onDetail={vi.fn()} />);
    expect(html.match(/netview|<button/g)!.filter((x) => x === '<button')).toHaveLength(5);
    expect(html).toContain(t('netview.kpi.linksSub', { functional: '69', noData: '5' }));
    expect(html).toContain(t('netview.kpi.detailAria', { what: t('netview.kpi.critical') }));
    expect(html).toContain(t('netview.kpi.basicsValue', { n: 0, total: 3 })); expect(html).toContain('role="img"');
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('NetCharts: los tres gráficos tienen su resumen para el lector de pantalla y su tabla alternativa', () => {
    const html = renderToStaticMarkup(<NetCharts summary={summary()} links={crossLinks} linksError={false} lang={lang} t={t} />);
    expect(html.match(/role="img"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(t('netview.chart.criticality.aria', { critical: 5, high: 5, medium: 66, total: 76 }));
    expect(html).toContain(t('netview.chart.category.aria', { top: 'Laptop', count: 36, total: 76 }));
    expect(html.match(/<details/g)).toHaveLength(3);
    expect(html).toContain('Laptop'); // el dato, tal cual
    expect(html).not.toMatch(/NaN|undefined|\{[a-zA-Z]+\}/);
  });
  it('NetCharts: mientras llegan los enlaces o si fallan, solo ese gráfico lo dice; los otros siguen', () => {
    const loading = renderToStaticMarkup(<NetCharts summary={summary()} links={null} linksError={false} lang={lang} t={t} />);
    expect(loading).toContain(t('chart.loading')); expect(loading).toContain(t('netview.chart.criticality.title'));
    const failed = renderToStaticMarkup(<NetCharts summary={summary()} links={null} linksError lang={lang} t={t} />);
    expect(failed).toContain(t('netview.chart.links.error')); expect(failed).toContain(t('netview.chart.category.title'));
  });
  it('NetCharts: con muchas categorías agrupa en «Otras» y los criticos salen con el nombre del idioma', () => {
    const s = summary(); s.byCategory = Array.from({ length: 12 }, (_, i) => ({ category: `Cat ${i}`, count: 12 - i }));
    const html = renderToStaticMarkup(<NetCharts summary={s} links={crossLinks} linksError={false} lang={lang} t={t} />);
    expect(html).toContain(t('netview.chart.category.other', { n: 5 }));
    expect(html).toContain(t('netview.crit.Crítica'));
  });
});

describe('los nombres de criticidad y el idioma', () => {
  it('en español dice Crítica y en inglés Critical (es vocabulario de la app); el dato del servidor no cambia', () => {
    expect(makeT('es')('netview.crit.Crítica')).toBe('Crítica'); expect(makeT('en')('netview.crit.Crítica')).toBe('Critical');
  });
});
