import type { DevicesQuery, Insight, LinksQuery, NetworkInsightCode, NetworkLinkItem, NetworkSummary } from './types';

/**
 * Lógica pura de la pantalla «Red»: el estado de los filtros del explorador, de un hallazgo al filtro que lo muestra, y los datos de los gráficos
 * a partir del resumen del servidor. Sin React ni red: se prueba con vitest en entorno node.
 */

export type NetTab = 'devices' | 'links';
export type Dir = 'asc' | 'desc';
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
/** Tope del texto de búsqueda: el mismo que valida el servidor. */
export const MAX_Q = 60;

export interface DevicesFilters { category?: string; criticality?: string; monitored?: 'yes' | 'no'; q: string }
export interface LinksFilters { linkType?: string; criticality?: string; functional?: 'yes' | 'no' | 'unknown'; device?: string; q: string }
export type DeviceSortKey = NonNullable<DevicesQuery['sort']>;
export type LinkSortKey = NonNullable<LinksQuery['sort']>;

export interface ExplorerState {
  tab: NetTab;
  devices: DevicesFilters;
  links: LinksFilters;
  deviceSort: { key: DeviceSortKey; dir: Dir };
  linkSort: { key: LinkSortKey; dir: Dir };
  pageSize: PageSize;
  /** Página de cada pestaña (desde 0). */
  devicePage: number;
  linkPage: number;
}

export const initialExplorer = (): ExplorerState => ({
  tab: 'devices',
  devices: { q: '' },
  links: { q: '' },
  deviceSort: { key: 'name', dir: 'asc' },
  linkSort: { key: 'id', dir: 'asc' },
  pageSize: 25,
  devicePage: 0,
  linkPage: 0,
});

/** Texto de búsqueda listo para enviar: espacios repetidos fuera, recortado a 60 caracteres. Vacío = sin filtro. */
export function cleanQuery(raw: string): string | undefined {
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_Q).trim();
  return t === '' ? undefined : t;
}

/** Página dentro de 0..última: una página fuera de rango (p. ej. tras filtrar) se acerca a la última que existe. */
export function clampPage(page: number, total: number, size: number): number {
  const last = Math.max(0, Math.ceil(Math.max(0, total) / Math.max(1, size)) - 1);
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.trunc(page)), last);
}
export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));

/** «Mostrando 26–50 de 76»: desde y hasta (contados desde 1); con cero resultados, 0–0. */
export function rangeOf(total: number, page: number, size: number, itemsOnPage: number): { from: number; to: number } {
  if (total <= 0 || itemsOnPage <= 0) return { from: 0, to: 0 };
  const from = page * size + 1;
  return { from, to: Math.min(total, from + itemsOnPage - 1) };
}

export function toDevicesQuery(s: ExplorerState): DevicesQuery {
  const f = s.devices;
  return {
    ...(f.category ? { category: f.category } : {}), ...(f.criticality ? { criticality: f.criticality } : {}), ...(f.monitored ? { monitored: f.monitored } : {}),
    ...(cleanQuery(f.q) ? { q: cleanQuery(f.q) } : {}),
    sort: s.deviceSort.key, order: s.deviceSort.dir, limit: s.pageSize, offset: Math.max(0, s.devicePage) * s.pageSize,
  };
}
export function toLinksQuery(s: ExplorerState): LinksQuery {
  const f = s.links;
  return {
    ...(f.linkType ? { linkType: f.linkType } : {}), ...(f.criticality ? { criticality: f.criticality } : {}), ...(f.functional ? { functional: f.functional } : {}),
    ...(f.device ? { device: f.device } : {}), ...(cleanQuery(f.q) ? { q: cleanQuery(f.q) } : {}),
    sort: s.linkSort.key, order: s.linkSort.dir, limit: s.pageSize, offset: Math.max(0, s.linkPage) * s.pageSize,
  };
}

/** Qué hacer al pulsar la acción de un hallazgo: a qué pestaña ir y con qué filtros. */
export interface InsightAction { tab: NetTab; devices?: Partial<DevicesFilters>; links?: Partial<LinksFilters> }
const ACTIONS: Record<NetworkInsightCode, InsightAction | null> = {
  monitoring_basics_missing: { tab: 'devices', devices: { monitored: 'yes' } },
  netflow_partial: { tab: 'devices', devices: { monitored: 'yes' } },
  critical_unmonitored: { tab: 'devices', devices: { monitored: 'yes', criticality: 'Crítica' } },
  links_without_status: { tab: 'links', links: { functional: 'unknown' } },
  all_covered: null,
};
// hasOwn y no `in`: un código como «constructor» o «__proto__» existe en todo objeto y no es una acción.
export const actionForInsight = (code: string): InsightAction | null => (Object.prototype.hasOwnProperty.call(ACTIONS, code) ? ACTIONS[code as NetworkInsightCode] : null);

/** Aplica una acción: la pestaña de destino queda SOLO con esos filtros (los anteriores se quitan: lo que se pidió ver es eso) y vuelve a la página 1. */
export function applyAction(s: ExplorerState, a: InsightAction): ExplorerState {
  return {
    ...s,
    tab: a.tab,
    ...(a.tab === 'devices' ? { devices: { q: '', ...a.devices }, devicePage: 0 } : { links: { q: '', ...a.links }, linkPage: 0 }),
  };
}
export function applyInsight(s: ExplorerState, insight: Pick<Insight, 'code'>): ExplorerState {
  const a = actionForInsight(insight.code);
  return a ? applyAction(s, a) : s;
}

/** «Ver enlaces» de un equipo: pestaña Enlaces filtrada por ese equipo, sin otros filtros. */
export const linksOfDevice = (s: ExplorerState, name: string): ExplorerState => applyAction(s, { tab: 'links', links: { device: name } });

export type ActiveFilterKey = 'category' | 'criticality' | 'monitored' | 'q' | 'linkType' | 'functional' | 'device';
export interface ActiveFilter { key: ActiveFilterKey; value: string }
/** Los filtros puestos en la pestaña actual, en un orden fijo, para pintar los chips quitables. */
export function activeFilters(s: ExplorerState): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (s.tab === 'devices') {
    const f = s.devices;
    if (f.category) out.push({ key: 'category', value: f.category });
    if (f.criticality) out.push({ key: 'criticality', value: f.criticality });
    if (f.monitored) out.push({ key: 'monitored', value: f.monitored });
    if (cleanQuery(f.q)) out.push({ key: 'q', value: cleanQuery(f.q)! });
  } else {
    const f = s.links;
    if (f.linkType) out.push({ key: 'linkType', value: f.linkType });
    if (f.criticality) out.push({ key: 'criticality', value: f.criticality });
    if (f.functional) out.push({ key: 'functional', value: f.functional });
    if (f.device) out.push({ key: 'device', value: f.device });
    if (cleanQuery(f.q)) out.push({ key: 'q', value: cleanQuery(f.q)! });
  }
  return out;
}

/** Quita un filtro de la pestaña actual y vuelve a la página 1. */
export function removeFilter(s: ExplorerState, key: ActiveFilterKey): ExplorerState {
  if (s.tab === 'devices') {
    const d = { ...s.devices }; if (key === 'q') d.q = ''; else if (key === 'category' || key === 'criticality' || key === 'monitored') delete d[key];
    return { ...s, devices: d, devicePage: 0 };
  }
  const l = { ...s.links }; if (key === 'q') l.q = ''; else if (key === 'linkType' || key === 'criticality' || key === 'functional' || key === 'device') delete l[key];
  return { ...s, links: l, linkPage: 0 };
}

/** «Limpiar filtros»: la pestaña actual vuelve a no tener ninguno y a la página 1 (el orden y el tamaño de página se conservan). */
export function clearFilters(s: ExplorerState): ExplorerState {
  return s.tab === 'devices' ? { ...s, devices: { q: '' }, devicePage: 0 } : { ...s, links: { q: '' }, linkPage: 0 };
}

/** Activa un valor de un filtro de lista; pulsar el mismo valor otra vez lo quita. Siempre vuelve a la página 1. */
export function toggleFilter(s: ExplorerState, key: Exclude<ActiveFilterKey, 'q' | 'device'>, value: string): ExplorerState {
  if (s.tab === 'devices') {
    if (key !== 'category' && key !== 'criticality' && key !== 'monitored') return s;
    const d = { ...s.devices }; const cur = d[key];
    if (cur === value) delete d[key]; else (d as Record<string, unknown>)[key] = value;
    return { ...s, devices: d, devicePage: 0 };
  }
  if (key !== 'linkType' && key !== 'criticality' && key !== 'functional') return s;
  const l = { ...s.links }; const cur = l[key];
  if (cur === value) delete l[key]; else (l as Record<string, unknown>)[key] = value;
  return { ...s, links: l, linkPage: 0 };
}

export function setSearch(s: ExplorerState, raw: string): ExplorerState {
  const q = raw.slice(0, MAX_Q * 2); // lo que se escribe puede pasar un poco; lo que se envía se recorta en cleanQuery
  return s.tab === 'devices' ? { ...s, devices: { ...s.devices, q }, devicePage: 0 } : { ...s, links: { ...s.links, q }, linkPage: 0 };
}

/** Pulsar el encabezado de una columna: si ya era la columna, invierte; si es otra, empieza ascendente. Vuelve a la página 1. */
export function sortBy(s: ExplorerState, key: string): ExplorerState {
  if (s.tab === 'devices') {
    const k = key as DeviceSortKey; const same = s.deviceSort.key === k;
    return { ...s, deviceSort: { key: k, dir: same && s.deviceSort.dir === 'asc' ? 'desc' : 'asc' }, devicePage: 0 };
  }
  const k = key as LinkSortKey; const same = s.linkSort.key === k;
  return { ...s, linkSort: { key: k, dir: same && s.linkSort.dir === 'asc' ? 'desc' : 'asc' }, linkPage: 0 };
}
export const ariaSort = (current: { key: string; dir: Dir }, key: string): 'ascending' | 'descending' | 'none' => (current.key === key ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none');

export const setPage = (s: ExplorerState, page: number): ExplorerState => (s.tab === 'devices' ? { ...s, devicePage: Math.max(0, Math.trunc(page) || 0) } : { ...s, linkPage: Math.max(0, Math.trunc(page) || 0) });
export const setPageSize = (s: ExplorerState, size: number): ExplorerState => ((PAGE_SIZES as readonly number[]).includes(size) ? { ...s, pageSize: size as PageSize, devicePage: 0, linkPage: 0 } : s);
export const setTab = (s: ExplorerState, tab: NetTab): ExplorerState => (s.tab === tab ? s : { ...s, tab });

/* ---------- datos de los gráficos ---------- */

export type CriticalityTone = 'bad' | 'warn' | 'chart-other';
/** Crítica y Alta son niveles de ESTADO (se dicen además con su nombre en la leyenda); Media es el gris neutro. */
export const criticalityTone = (c: string): CriticalityTone => (c === 'Crítica' ? 'bad' : c === 'Alta' ? 'warn' : 'chart-other');

export function criticalitySlices(summary: Pick<NetworkSummary, 'byCriticality'>): { id: string; value: number; criticality: string; tone: CriticalityTone }[] {
  return summary.byCriticality.map((c) => ({ id: c.criticality, value: c.count, criticality: c.criticality, tone: criticalityTone(c.criticality) }));
}

/** Categorías de más a menos; las que pasan de `max` se agrupan en una barra «Otras» (con cuántas categorías son). */
export function categoryBars(summary: Pick<NetworkSummary, 'byCategory'>, max = 8): { id: string; category: string | null; value: number; folded: number }[] {
  const rows = [...summary.byCategory].filter((c) => c.count > 0).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  if (rows.length <= max) return rows.map((r) => ({ id: r.category, category: r.category, value: r.count, folded: 0 }));
  const keep = rows.slice(0, max - 1); const rest = rows.slice(max - 1);
  return [...keep.map((r) => ({ id: r.category, category: r.category, value: r.count, folded: 0 })), { id: '__other', category: null, value: rest.reduce((n, r) => n + r.count, 0), folded: rest.length }];
}

export const COVERAGE_COLUMNS = ['syslog', 'snmp', 'ntp', 'netflow'] as const;
export type CoverageColumn = (typeof COVERAGE_COLUMNS)[number];
export interface CoverageRow { name: string; model: string; criticality: string; signals: number; cells: Record<CoverageColumn, boolean> }
/** Filas de la matriz de cobertura, tal como las ordena el servidor (Crítica primero y luego por nombre). */
export const coverageRows = (summary: Pick<NetworkSummary, 'infrastructure'>): CoverageRow[] =>
  summary.infrastructure.map((r) => ({ name: r.name, model: r.model, criticality: r.criticality, signals: r.signals, cells: { syslog: r.syslog, snmp: r.snmp, ntp: r.ntp, netflow: r.netflow } }));

/** Cuántos equipos tienen cada cosa configurada, de la propia matriz (la misma cuenta que ve quien lee la tabla). */
export function coverageTotals(rows: readonly CoverageRow[]): Record<CoverageColumn, number> & { equipment: number; bare: number; basics: number } {
  const c = { syslog: 0, snmp: 0, ntp: 0, netflow: 0 };
  let bare = 0, basics = 0;
  for (const r of rows) {
    for (const k of COVERAGE_COLUMNS) if (r.cells[k]) c[k]++;
    if (COVERAGE_COLUMNS.every((k) => !r.cells[k])) bare++;
    if (r.cells.syslog && r.cells.snmp && r.cells.ntp) basics++;
  }
  return { ...c, equipment: rows.length, bare, basics };
}
/** Porcentaje (entero) de equipos con Syslog, SNMP y NTP a la vez; 0 si no hay equipos. */
export const basicsPercent = (basics: number, equipment: number): number => (equipment <= 0 ? 0 : Math.round((basics / equipment) * 100));

/** Cruce tipo de enlace × criticidad, sacado de la lista de enlaces (el resumen trae los totales por separado, no el cruce). */
export function linksCrossTab(links: readonly Pick<NetworkLinkItem, 'linkType' | 'criticality'>[], criticalities: readonly string[]): { types: string[]; series: { criticality: string; values: number[] }[] } {
  const types = [...new Set(links.map((l) => l.linkType))].sort((a, b) => links.filter((l) => l.linkType === b).length - links.filter((l) => l.linkType === a).length || a.localeCompare(b));
  const crits = [...criticalities, ...[...new Set(links.map((l) => l.criticality))].filter((c) => !criticalities.includes(c)).sort()];
  return { types, series: crits.map((criticality) => ({ criticality, values: types.map((ty) => links.filter((l) => l.linkType === ty && l.criticality === criticality).length) })) };
}

/* ---------- ayudas de presentación (puras) ---------- */

/** Clave del diccionario de un hallazgo: `netview.insight.<código>.text` o `.rule`. */
export const insightKey = (code: string, part: 'text' | 'rule'): string => `netview.insight.${code}.${part}`;
export const KNOWN_INSIGHTS: readonly NetworkInsightCode[] = ['monitoring_basics_missing', 'critical_unmonitored', 'netflow_partial', 'links_without_status', 'all_covered'];
export const isKnownInsight = (code: string): code is NetworkInsightCode => (KNOWN_INSIGHTS as readonly string[]).includes(code);
/** Clave del texto del botón de un hallazgo (o null si no lleva a ningún lado). */
export function actionLabelKey(code: string): 'netview.action.devices' | 'netview.action.critical' | 'netview.action.links' | null {
  const a = actionForInsight(code);
  if (!a) return null;
  return a.tab === 'links' ? 'netview.action.links' : a.devices?.criticality ? 'netview.action.critical' : 'netview.action.devices';
}
/** Clave del nombre de una criticidad (Crítica, Alta, Media); null si no es una de las tres (entonces se muestra el valor tal cual). */
export const critKey = (c: string): 'netview.crit.Crítica' | 'netview.crit.Alta' | 'netview.crit.Media' | null => (c === 'Crítica' || c === 'Alta' || c === 'Media' ? (`netview.crit.${c}` as const) : null);
