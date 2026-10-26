import { describe, expect, it } from 'vitest';
import {
  activeFilters, actionForInsight, applyAction, applyInsight, ariaSort, basicsPercent, categoryBars, clampPage, cleanQuery, clearFilters, COVERAGE_COLUMNS, coverageRows,
  coverageTotals, criticalitySlices, criticalityTone, ExplorerState, initialExplorer, linksCrossTab, linksOfDevice, MAX_Q, pageCount, PAGE_SIZES, rangeOf, removeFilter, setPage,
  setPageSize, setSearch, setTab, sortBy, toDevicesQuery, toggleFilter, toLinksQuery,
} from './netview';
import type { NetworkSummary } from './types';

const summary = (): NetworkSummary => ({
  asOf: '2026-10-26T12:00:00Z',
  totals: { devices: 76, links: 74, criticalDevices: 5, infrastructure: 10 },
  byCategory: [
    { category: 'Laptop', count: 36 }, { category: 'PC', count: 11 }, { category: 'CCTV / IoT', count: 9 }, { category: 'IoT', count: 6 }, { category: 'Switch Acceso', count: 5 },
    { category: 'Switch Capa 3', count: 2 }, { category: 'Router', count: 2 }, { category: 'Firewall / ASA', count: 1 }, { category: 'Servidor', count: 1 }, { category: 'IoT / MCU', count: 1 },
    { category: 'WiredEndDevice', count: 1 }, { category: 'Power Distribution Device', count: 1 },
  ],
  byCriticality: [{ criticality: 'Crítica', count: 5 }, { criticality: 'Alta', count: 5 }, { criticality: 'Media', count: 66 }],
  links: { total: 74, functional: 69, notFunctional: 0, noData: 5, byType: [{ type: 'eCopper', count: 69 }, { type: 'eCustomIOLink', count: 5 }], byCriticality: [{ criticality: 'Crítica', count: 11 }, { criticality: 'Alta', count: 63 }, { criticality: 'Media', count: 0 }] },
  monitoring: { equipment: 10, syslog: 0, snmp: 0, ntp: 0, netflow: 4, withoutAnyConfig: 6, signalsPossible: 12 },
  infrastructure: [
    { name: 'ASA0', model: '5505', role: 'Firewall', criticality: 'Crítica', ips: '200.10.10.1', syslog: false, snmp: false, ntp: false, netflow: false, signals: 12 },
    { name: 'Multilayer Switch0', model: '3560-24PS', role: 'Core', criticality: 'Crítica', ips: '10.0.0.2; 10.0.0.9', syslog: false, snmp: false, ntp: false, netflow: true, signals: 12 },
    { name: 'SW1 P1', model: '2960-24TT', role: 'Acceso', criticality: 'Alta', ips: null, syslog: false, snmp: false, ntp: false, netflow: false, signals: 12 },
  ],
  insights: [],
});

describe('cleanQuery: el texto de búsqueda que se envía', () => {
  it.each([['  hola   mundo  ', 'hola mundo'], ['', undefined], ['   ', undefined], ['\n\t', undefined], ['3560', '3560'], ['Fa0/1', 'Fa0/1']])('%j -> %j', (raw, want) => expect(cleanQuery(raw)).toBe(want));
  it('se recorta a 60 caracteres, y un recorte que deja un espacio al final no lo conserva', () => {
    expect(cleanQuery('x'.repeat(200))).toHaveLength(MAX_Q);
    expect(cleanQuery(`${'a'.repeat(59)} ${'b'.repeat(20)}`)).toBe('a'.repeat(59));
  });
  it('los caracteres raros pasan al servidor tal cual (él los valida); no se interpretan aquí', () => {
    expect(cleanQuery("'; DROP TABLE x;--")).toBe("'; DROP TABLE x;--");
    expect(cleanQuery('<b>ñandú</b>')).toBe('<b>ñandú</b>');
  });
});

describe('página y rango', () => {
  it.each([[0, 76, 25, 0], [2, 76, 25, 2], [3, 76, 25, 3], [4, 76, 25, 3], [99, 76, 25, 3], [-5, 76, 25, 0], [1, 0, 25, 0], [5, 25, 25, 0], [1, 26, 25, 1], [Number.NaN, 76, 25, 0], [Infinity, 76, 25, 0], [1.9, 76, 25, 1]])('clampPage(%s de %s, tamaño %s) = %s', (p, t, size, want) => expect(clampPage(p, t, size)).toBe(want));
  it('el tamaño de página 0 o negativo no rompe la cuenta', () => { expect(clampPage(3, 10, 0)).toBe(3); expect(pageCount(10, 0)).toBe(10); });
  it('pageCount: siempre al menos una página', () => { expect(pageCount(0, 25)).toBe(1); expect(pageCount(76, 25)).toBe(4); expect(pageCount(75, 25)).toBe(3); expect(pageCount(-3, 25)).toBe(1); });
  it('rangeOf: «26–50 de 76», la última página corta y el vacío', () => {
    expect(rangeOf(76, 0, 25, 25)).toEqual({ from: 1, to: 25 });
    expect(rangeOf(76, 1, 25, 25)).toEqual({ from: 26, to: 50 });
    expect(rangeOf(76, 3, 25, 1)).toEqual({ from: 76, to: 76 });
    expect(rangeOf(0, 0, 25, 0)).toEqual({ from: 0, to: 0 });
    expect(rangeOf(76, 9, 25, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('del estado a la consulta del servidor', () => {
  it('el estado inicial pide la primera página, por nombre, sin ningún filtro', () => {
    const s = initialExplorer();
    expect(toDevicesQuery(s)).toEqual({ sort: 'name', order: 'asc', limit: 25, offset: 0 });
    expect(toLinksQuery(s)).toEqual({ sort: 'id', order: 'asc', limit: 25, offset: 0 });
  });
  it('cada filtro puesto viaja, y los vacíos no', () => {
    const s: ExplorerState = { ...initialExplorer(), devices: { category: 'Router', criticality: 'Crítica', monitored: 'yes', q: '  3560  ' }, links: { linkType: 'eCopper', criticality: 'Alta', functional: 'unknown', device: 'ASA0', q: ' Fa0/1 ' } };
    expect(toDevicesQuery(s)).toMatchObject({ category: 'Router', criticality: 'Crítica', monitored: 'yes', q: '3560' });
    expect(toLinksQuery(s)).toMatchObject({ linkType: 'eCopper', criticality: 'Alta', functional: 'unknown', device: 'ASA0', q: 'Fa0/1' });
    expect(toDevicesQuery({ ...s, devices: { category: '', q: '   ' } })).not.toHaveProperty('category');
    expect(toDevicesQuery({ ...s, devices: { q: '   ' } })).not.toHaveProperty('q');
  });
  it('el desplazamiento es página × tamaño y nunca negativo', () => {
    expect(toDevicesQuery({ ...initialExplorer(), devicePage: 2, pageSize: 50 })).toMatchObject({ limit: 50, offset: 100 });
    expect(toLinksQuery({ ...initialExplorer(), linkPage: -3 })).toMatchObject({ offset: 0 });
  });
  it('cada pestaña usa SU orden y SU página', () => {
    const s = { ...initialExplorer(), deviceSort: { key: 'criticality' as const, dir: 'desc' as const }, linkSort: { key: 'length' as const, dir: 'asc' as const }, devicePage: 1, linkPage: 2 };
    expect(toDevicesQuery(s)).toMatchObject({ sort: 'criticality', order: 'desc', offset: 25 });
    expect(toLinksQuery(s)).toMatchObject({ sort: 'length', order: 'asc', offset: 50 });
  });
});

describe('hallazgos: a qué filtro y pestaña llevan', () => {
  it.each([
    ['monitoring_basics_missing', 'devices', { monitored: 'yes' }],
    ['netflow_partial', 'devices', { monitored: 'yes' }],
    ['critical_unmonitored', 'devices', { monitored: 'yes', criticality: 'Crítica' }],
  ])('%s -> pestaña %s con %j', (code, tab, filters) => {
    const s = applyInsight(initialExplorer(), { code });
    expect(s.tab).toBe(tab);
    expect(s.devices).toEqual({ q: '', ...filters });
  });
  it('links_without_status lleva a Enlaces con «sin dato» y no toca los filtros de Dispositivos', () => {
    const before: ExplorerState = { ...initialExplorer(), devices: { category: 'PC', q: 'x' } };
    const s = applyInsight(before, { code: 'links_without_status' });
    expect(s.tab).toBe('links'); expect(s.links).toEqual({ q: '', functional: 'unknown' }); expect(s.devices).toEqual(before.devices);
  });
  it('all_covered y un código desconocido no cambian nada (no hay a dónde ir)', () => {
    const s = initialExplorer();
    expect(applyInsight(s, { code: 'all_covered' })).toBe(s);
    expect(applyInsight(s, { code: 'something_new' })).toBe(s);
    expect(actionForInsight('all_covered')).toBeNull(); expect(actionForInsight('constructor')).toBeNull(); expect(actionForInsight('__proto__')).toBeNull();
  });
  it('lo que se pide ver sustituye a los filtros anteriores de esa pestaña y vuelve a la página 1', () => {
    const before: ExplorerState = { ...initialExplorer(), devices: { category: 'Laptop', criticality: 'Media', q: 'abc' }, devicePage: 2 };
    const s = applyInsight(before, { code: 'critical_unmonitored' });
    expect(s.devices).toEqual({ q: '', monitored: 'yes', criticality: 'Crítica' }); expect(s.devicePage).toBe(0);
  });
  it('«Ver enlaces» de un equipo: pestaña Enlaces filtrada solo por ese equipo', () => {
    const s = linksOfDevice({ ...initialExplorer(), links: { linkType: 'eCopper', q: 'z' }, linkPage: 3 }, 'Multilayer Switch0');
    expect(s.tab).toBe('links'); expect(s.links).toEqual({ q: '', device: 'Multilayer Switch0' }); expect(s.linkPage).toBe(0);
  });
  it('applyAction no modifica el estado que recibe', () => {
    const s = initialExplorer(); const copy = JSON.stringify(s);
    applyAction(s, { tab: 'links', links: { functional: 'no' } });
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('filtros activos, quitar y limpiar', () => {
  const withFilters = (): ExplorerState => applyInsight(setSearch(initialExplorer(), 'abc'), { code: 'critical_unmonitored' });
  it('los chips salen en orden fijo y solo los de la pestaña actual', () => {
    const s: ExplorerState = { ...initialExplorer(), devices: { q: ' texto ', monitored: 'no', category: 'PC', criticality: 'Alta' }, links: { q: '', device: 'ASA0' } };
    expect(activeFilters(s).map((f) => f.key)).toEqual(['category', 'criticality', 'monitored', 'q']);
    expect(activeFilters(s).find((f) => f.key === 'q')!.value).toBe('texto');
    expect(activeFilters({ ...s, tab: 'links' }).map((f) => f.key)).toEqual(['device']);
  });
  it('sin filtros no hay chips', () => { expect(activeFilters(initialExplorer())).toEqual([]); expect(activeFilters(setSearch(initialExplorer(), '   '))).toEqual([]); });
  it('quitar un filtro lo quita, deja los otros y vuelve a la página 1', () => {
    const s = { ...withFilters(), devicePage: 3 };
    const r = removeFilter(s, 'criticality');
    expect(r.devices).toEqual({ q: '', monitored: 'yes' }); expect(r.devicePage).toBe(0);
    expect(removeFilter(s, 'q').devices.q).toBe('');
  });
  it('quitar un filtro que esta pestaña no tiene no rompe nada', () => {
    const s = initialExplorer();
    expect(removeFilter(s, 'functional').devices).toEqual({ q: '' });
    expect(removeFilter({ ...s, tab: 'links' }, 'category').links).toEqual({ q: '' });
  });
  it('limpiar deja la pestaña como al principio: sin filtros y en la página 1, conservando orden y tamaño', () => {
    const s: ExplorerState = { ...withFilters(), pageSize: 100, deviceSort: { key: 'model', dir: 'desc' }, devicePage: 2 };
    const c = clearFilters(s);
    expect(c.devices).toEqual(initialExplorer().devices); expect(c.devicePage).toBe(0); expect(c.deviceSort).toEqual({ key: 'model', dir: 'desc' }); expect(c.pageSize).toBe(100);
    expect(activeFilters(c)).toEqual([]);
  });
  it('limpiar desde el estado que dejó un hallazgo da el estado inicial de esa pestaña', () => {
    expect(clearFilters(applyInsight(initialExplorer(), { code: 'monitoring_basics_missing' }))).toEqual(initialExplorer());
    const links = clearFilters(applyInsight(initialExplorer(), { code: 'links_without_status' }));
    expect(links).toEqual({ ...initialExplorer(), tab: 'links' });
  });
  it('limpiar una pestaña no toca los filtros de la otra', () => {
    const s = { ...applyInsight(initialExplorer(), { code: 'links_without_status' }), devices: { category: 'PC', q: '' } };
    expect(clearFilters(s).devices).toEqual({ category: 'PC', q: '' });
  });
});

describe('filtros de lista y búsqueda', () => {
  it('activar un valor lo pone; pulsarlo otra vez lo quita; cambiar a otro lo reemplaza', () => {
    let s = toggleFilter(initialExplorer(), 'criticality', 'Crítica');
    expect(s.devices.criticality).toBe('Crítica');
    s = toggleFilter(s, 'criticality', 'Alta'); expect(s.devices.criticality).toBe('Alta');
    s = toggleFilter(s, 'criticality', 'Alta'); expect(s.devices).toEqual({ q: '' });
  });
  it('cada pestaña tiene sus claves: una que no es suya se ignora', () => {
    const s = initialExplorer();
    expect(toggleFilter(s, 'functional', 'yes')).toBe(s);
    expect(toggleFilter({ ...s, tab: 'links' }, 'category', 'PC')).toEqual({ ...s, tab: 'links' });
    expect(toggleFilter({ ...s, tab: 'links' }, 'functional', 'unknown').links.functional).toBe('unknown');
  });
  it('cambiar un filtro vuelve a la página 1', () => {
    expect(toggleFilter({ ...initialExplorer(), devicePage: 2 }, 'category', 'PC').devicePage).toBe(0);
    expect(setSearch({ ...initialExplorer(), tab: 'links', linkPage: 4 }, 'a').linkPage).toBe(0);
  });
  it('la búsqueda se guarda en la pestaña actual y lo escrito de más se corta sin romper', () => {
    expect(setSearch(initialExplorer(), 'abc').devices.q).toBe('abc');
    expect(setSearch({ ...initialExplorer(), tab: 'links' }, 'Fa0').links.q).toBe('Fa0');
    expect(setSearch(initialExplorer(), 'x'.repeat(5000)).devices.q.length).toBeLessThanOrEqual(MAX_Q * 2);
  });
});

describe('orden, página y pestaña', () => {
  it('pulsar otra columna empieza ascendente; la misma, alterna', () => {
    let s = sortBy(initialExplorer(), 'criticality'); expect(s.deviceSort).toEqual({ key: 'criticality', dir: 'asc' });
    s = sortBy(s, 'criticality'); expect(s.deviceSort.dir).toBe('desc');
    s = sortBy(s, 'criticality'); expect(s.deviceSort.dir).toBe('asc');
    s = sortBy(s, 'model'); expect(s.deviceSort).toEqual({ key: 'model', dir: 'asc' });
  });
  it('ordenar vuelve a la página 1 y usa el orden de la pestaña actual', () => {
    const s = sortBy({ ...initialExplorer(), tab: 'links', linkPage: 3 }, 'origin');
    expect(s.linkSort).toEqual({ key: 'origin', dir: 'asc' }); expect(s.linkPage).toBe(0); expect(s.deviceSort).toEqual(initialExplorer().deviceSort);
  });
  it('ariaSort dice el sentido solo en la columna activa', () => {
    expect(ariaSort({ key: 'name', dir: 'asc' }, 'name')).toBe('ascending');
    expect(ariaSort({ key: 'name', dir: 'desc' }, 'name')).toBe('descending');
    expect(ariaSort({ key: 'name', dir: 'desc' }, 'model')).toBe('none');
  });
  it('setPage: entero, nunca negativo, y solo de la pestaña actual', () => {
    expect(setPage(initialExplorer(), 2).devicePage).toBe(2);
    expect(setPage(initialExplorer(), -4).devicePage).toBe(0);
    expect(setPage(initialExplorer(), 1.8).devicePage).toBe(1);
    expect(setPage(initialExplorer(), Number.NaN).devicePage).toBe(0);
    expect(setPage({ ...initialExplorer(), tab: 'links' }, 3)).toMatchObject({ linkPage: 3, devicePage: 0 });
  });
  it('setPageSize: solo 25, 50 o 100, y vuelve a la página 1 en las dos pestañas', () => {
    for (const n of PAGE_SIZES) expect(setPageSize({ ...initialExplorer(), devicePage: 2, linkPage: 1 }, n)).toMatchObject({ pageSize: n, devicePage: 0, linkPage: 0 });
    const s = initialExplorer();
    expect(setPageSize(s, 7)).toBe(s); expect(setPageSize(s, 1e9)).toBe(s);
  });
  it('setTab cambia de pestaña sin tocar nada más, y la misma pestaña es la misma identidad', () => {
    const s = initialExplorer();
    expect(setTab(s, 'devices')).toBe(s);
    expect(setTab(s, 'links')).toEqual({ ...s, tab: 'links' });
  });
});

describe('datos de los gráficos', () => {
  it('criticidad: un trozo por nivel con su tono de estado, en el orden del servidor', () => {
    expect(criticalitySlices(summary())).toEqual([
      { id: 'Crítica', criticality: 'Crítica', value: 5, tone: 'bad' }, { id: 'Alta', criticality: 'Alta', value: 5, tone: 'warn' }, { id: 'Media', criticality: 'Media', value: 66, tone: 'chart-other' },
    ]);
    expect(criticalityTone('algo nuevo')).toBe('chart-other');
  });
  it('categorías: de más a menos, las pequeñas se agrupan en «Otras» y la suma no cambia', () => {
    const bars = categoryBars(summary(), 8);
    expect(bars).toHaveLength(8);
    expect(bars[0]).toMatchObject({ category: 'Laptop', value: 36 });
    const head = bars.slice(0, 7).map((b) => b.value);
    expect(head).toEqual([...head].sort((a, b) => b - a)); // las 7 primeras, de más a menos
    expect(bars[7]).toMatchObject({ id: '__other', category: null, folded: 5, value: 5 });
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(76);
  });
  it('categorías: con pocas no se agrupa nada; empates por nombre; sin datos, vacío; las de cero no salen', () => {
    const few = { byCategory: [{ category: 'Zeta', count: 2 }, { category: 'Alfa', count: 2 }, { category: 'Beta', count: 5 }, { category: 'Vacía', count: 0 }] };
    expect(categoryBars(few).map((b) => b.category)).toEqual(['Beta', 'Alfa', 'Zeta']);
    expect(categoryBars({ byCategory: [] })).toEqual([]);
    expect(categoryBars(few).every((b) => b.folded === 0)).toBe(true);
  });
  it('cobertura: las filas conservan el orden del servidor y sus celdas', () => {
    const rows = coverageRows(summary());
    expect(rows.map((r) => r.name)).toEqual(['ASA0', 'Multilayer Switch0', 'SW1 P1']);
    expect(rows[1].cells).toEqual({ syslog: false, snmp: false, ntp: false, netflow: true });
    expect(COVERAGE_COLUMNS).toEqual(['syslog', 'snmp', 'ntp', 'netflow']);
  });
  it('cobertura: los totales salen de la propia matriz y concuerdan con lo que se ve', () => {
    const t = coverageTotals(coverageRows(summary()));
    expect(t).toEqual({ syslog: 0, snmp: 0, ntp: 0, netflow: 1, equipment: 3, bare: 2, basics: 0 });
    const full = coverageRows({ infrastructure: [{ name: 'A', model: 'm', role: 'r', criticality: 'Crítica', ips: null, syslog: true, snmp: true, ntp: true, netflow: false, signals: 12 }] });
    expect(coverageTotals(full)).toMatchObject({ syslog: 1, snmp: 1, ntp: 1, netflow: 0, bare: 0, basics: 1 });
    expect(coverageTotals([])).toEqual({ syslog: 0, snmp: 0, ntp: 0, netflow: 0, equipment: 0, bare: 0, basics: 0 });
  });
  it('porcentaje de monitoreo básico: entero y sin dividir por cero', () => {
    expect(basicsPercent(0, 10)).toBe(0); expect(basicsPercent(3, 10)).toBe(30); expect(basicsPercent(1, 3)).toBe(33); expect(basicsPercent(2, 3)).toBe(67); expect(basicsPercent(5, 0)).toBe(0);
  });
  it('cruce de enlaces: tipos del más común al menos, una serie por criticidad y los totales cuadran', () => {
    const links = [
      ...Array.from({ length: 6 }, () => ({ linkType: 'eCopper', criticality: 'Alta' })), ...Array.from({ length: 2 }, () => ({ linkType: 'eCopper', criticality: 'Crítica' })),
      ...Array.from({ length: 3 }, () => ({ linkType: 'eCustomIOLink', criticality: 'Alta' })), { linkType: 'eFibra', criticality: 'Baja' },
    ];
    const x = linksCrossTab(links, ['Crítica', 'Alta', 'Media']);
    expect(x.types).toEqual(['eCopper', 'eCustomIOLink', 'eFibra']);
    expect(x.series.map((s) => s.criticality)).toEqual(['Crítica', 'Alta', 'Media', 'Baja']); // una criticidad desconocida se muestra al final y no se pierde
    expect(x.series[1].values).toEqual([6, 3, 0]); expect(x.series[0].values).toEqual([2, 0, 0]); expect(x.series[2].values).toEqual([0, 0, 0]);
    expect(x.series.flatMap((s) => s.values).reduce((n, v) => n + v, 0)).toBe(links.length);
  });
  it('cruce de enlaces sin enlaces: sin tipos y con todas las series en cero', () => {
    expect(linksCrossTab([], ['Crítica', 'Alta'])).toEqual({ types: [], series: [{ criticality: 'Crítica', values: [] }, { criticality: 'Alta', values: [] }] });
  });
});
