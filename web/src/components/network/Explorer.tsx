import { forwardRef, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatNumber } from '../../charts';
import type { Lang } from '../../i18n/core';
import { errorText } from '../../i18n/server';
import type { MsgKey, TFn } from '../../i18n';
import type { Api } from '../../lib/api';
import {
  activeFilters, ariaSort, clampPage, clearFilters, critKey, type ExplorerState, linksOfDevice, MAX_Q, type NetTab, pageCount, PAGE_SIZES, rangeOf, removeFilter, setPage, setPageSize,
  setSearch, setTab, sortBy, toDevicesQuery, toggleFilter, toLinksQuery,
} from '../../lib/netview';
import type { NetworkDeviceItem, NetworkFacets, NetworkLinkItem, Page } from '../../lib/types';
import ui from '../../styles/ui.module.css';
import { CritChip } from './parts';
import s from './network.module.css';

type Result<T> = { state: 'loading' } | { state: 'error'; cause: unknown } | { state: 'ready'; data: Page<T> };
const critLabel = (c: string, t: TFn) => { const k = critKey(c); return k ? t(k as MsgKey) : c; };

function useQueryResult<T>(load: () => Promise<Page<T>>, key: string, debounceMs: number): { result: Result<T>; reload: () => void } {
  const [result, setResult] = useState<Result<T>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const loader = useRef(load); loader.current = load;
  useEffect(() => {
    const mine = ++seq.current; // si llega una respuesta vieja después de una nueva, se descarta
    setResult((r) => (r.state === 'ready' ? r : { state: 'loading' }));
    const id = setTimeout(() => {
      loader.current().then((data) => { if (mine === seq.current) setResult({ state: 'ready', data }); }, (cause) => { if (mine === seq.current) setResult({ state: 'error', cause }); });
    }, debounceMs);
    return () => clearTimeout(id);
  }, [key, nonce, debounceMs]);
  return { result, reload: () => setNonce((n) => n + 1) };
}

function ChipGroup({ legend, options, value, onToggle }: { legend: string; options: { value: string; label: string }[]; value?: string; onToggle: (v: string) => void }) {
  return (
    <fieldset className={s.group}>
      <legend>{legend}</legend>
      <div className={s.chips}>
        {options.map((o) => <button key={o.value} type="button" className={value === o.value ? s.chipOn : s.chip} aria-pressed={value === o.value} onClick={() => onToggle(o.value)}>{o.label}</button>)}
      </div>
    </fieldset>
  );
}

interface Props { api: Api; state: ExplorerState; setState: (f: (s: ExplorerState) => ExplorerState) => void; facets: NetworkFacets | null; totals: { devices: number; links: number }; lang: Lang; t: TFn }

/** El explorador: dos pestañas (Dispositivos y Enlaces) con filtros, chips de filtros activos, orden por columna, paginación y estados de carga, vacío y error. El foco y el desplazamiento los maneja quien lo contiene. */
export const Explorer = forwardRef<HTMLElement, Props>(function Explorer({ api, state, setState, facets, totals, lang, t }, ref) {
  const devices = state.tab === 'devices';
  const dq = toDevicesQuery(state), lq = toLinksQuery(state);
  const lastQ = useRef('');
  const q = devices ? state.devices.q : state.links.q;
  const delay = lastQ.current !== q ? 250 : 0; // al escribir se espera un poco; al pulsar un filtro, no
  useEffect(() => { lastQ.current = q; });
  const dev = useQueryResult<NetworkDeviceItem>(() => api.networkDevices(dq), `d${JSON.stringify(dq)}${devices ? '' : '-off'}`, devices ? delay : 1e9);
  const lnk = useQueryResult<NetworkLinkItem>(() => api.networkLinks(lq), `l${JSON.stringify(lq)}${devices ? '-off' : ''}`, devices ? 1e9 : delay);
  const cur = devices ? dev.result : lnk.result;
  const page = devices ? state.devicePage : state.linkPage;
  const total = cur.state === 'ready' ? cur.data.total : 0;

  // Si tras filtrar la página pedida ya no existe, se vuelve a la última que sí.
  useEffect(() => {
    if (cur.state !== 'ready') return;
    const ok = clampPage(page, cur.data.total, state.pageSize);
    if (ok !== page) setState((x) => setPage(x, ok));
  }, [cur, page, state.pageSize, setState]);

  const tabs: { id: NetTab; label: string }[] = [
    { id: 'devices', label: t('netview.tab.devices', { n: formatNumber(totals.devices, lang, 0) }) },
    { id: 'links', label: t('netview.tab.links', { n: formatNumber(totals.links, lang, 0) }) },
  ];
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next: NetTab = e.key === 'Home' ? 'devices' : e.key === 'End' ? 'links' : devices ? 'links' : 'devices';
    setState((x) => setTab(x, next));
    requestAnimationFrame(() => document.getElementById(`net-tab-${next}`)?.focus());
  };

  const active = activeFilters(state);
  const catOpts = (facets?.categories ?? []).map((c) => ({ value: c, label: c }));
  const critOpts = (facets?.criticalities ?? []).map((c) => ({ value: c, label: critLabel(c, t) }));
  const typeOpts = (facets?.linkTypes ?? []).map((c) => ({ value: c, label: c }));
  const chipLabel = (key: string): string => ({ category: t('netview.filter.category'), criticality: t('netview.filter.criticality'), monitored: t('netview.filter.monitoring'), q: t('netview.filter.search'), linkType: t('netview.filter.linkType'), functional: t('netview.filter.functional'), device: t('netview.filter.device') }[key] ?? key);
  const chipValue = (key: string, v: string): string => key === 'criticality' ? critLabel(v, t) : key === 'monitored' ? t(`netview.filter.monitored.${v}` as MsgKey) : key === 'functional' ? t(`netview.filter.functional.${v}` as MsgKey) : v;

  const range = cur.state === 'ready' ? rangeOf(cur.data.total, page, state.pageSize, cur.data.items.length) : { from: 0, to: 0 };
  const pages = pageCount(total, state.pageSize);
  const retry = devices ? dev.reload : lnk.reload;

  const th = (label: string, key?: string, cls?: string) => {
    const cursor = devices ? state.deviceSort : state.linkSort;
    return (
      <th scope="col" className={cls} aria-sort={key ? ariaSort(cursor, key) : undefined}>
        {key ? <button type="button" className={ui.sortBtn} aria-label={t('netview.table.sortBy', { label })} onClick={() => setState((x) => sortBy(x, key))}>{label}<span aria-hidden>{cursor.key === key ? (cursor.dir === 'asc' ? '▲' : '▼') : ''}</span></button> : label}
      </th>
    );
  };
  const config = (d: NetworkDeviceItem, v: boolean | null) => (v === null || !d.monitored
    ? <span className={s.na}><span aria-hidden>—</span><span className={s.sr}>{t('netview.cell.notApplicable')}</span></span>
    : v ? <span className={s.on}><span aria-hidden>✓</span><span className={s.sr}>{t('netview.coverage.on')}</span></span> : <span className={s.off}><span aria-hidden>✗</span><span className={s.sr}>{t('netview.coverage.off')}</span></span>);

  return (
    <section ref={ref} className={s.explorer} tabIndex={-1} aria-labelledby="net-exp-h" id="net-explorer">
      <div>
        <h3 id="net-exp-h" className={s.sectionTitle}>{t('netview.explorer.title')}</h3>
        <p className={s.sub}>{t('netview.explorer.sub', { devices: formatNumber(totals.devices, lang, 0), links: formatNumber(totals.links, lang, 0) })}</p>
      </div>

      <div className={s.tabs} role="tablist" aria-label={t('netview.tabs.label')}>
        {tabs.map((x) => (
          <button key={x.id} id={`net-tab-${x.id}`} type="button" role="tab" className={state.tab === x.id ? s.tabOn : s.tab} aria-selected={state.tab === x.id} aria-controls="net-panel" tabIndex={state.tab === x.id ? 0 : -1}
            onClick={() => setState((st) => setTab(st, x.id))} onKeyDown={onTabKey}>{x.label}</button>
        ))}
      </div>

      <div id="net-panel" role="tabpanel" aria-labelledby={`net-tab-${state.tab}`} className={s.filters}>
        <div className={s.filters} role="group" aria-label={t('netview.filters.label')}>
          {devices ? (
            <>
              <ChipGroup legend={t('netview.filter.category')} options={catOpts} value={state.devices.category} onToggle={(v) => setState((x) => toggleFilter(x, 'category', v))} />
              <ChipGroup legend={t('netview.filter.criticality')} options={critOpts} value={state.devices.criticality} onToggle={(v) => setState((x) => toggleFilter(x, 'criticality', v))} />
              <ChipGroup legend={t('netview.filter.monitoring')} options={[{ value: 'yes', label: t('netview.filter.monitored.yes') }, { value: 'no', label: t('netview.filter.monitored.no') }]} value={state.devices.monitored} onToggle={(v) => setState((x) => toggleFilter(x, 'monitored', v))} />
            </>
          ) : (
            <>
              <ChipGroup legend={t('netview.filter.linkType')} options={typeOpts} value={state.links.linkType} onToggle={(v) => setState((x) => toggleFilter(x, 'linkType', v))} />
              <ChipGroup legend={t('netview.filter.criticality')} options={critOpts} value={state.links.criticality} onToggle={(v) => setState((x) => toggleFilter(x, 'criticality', v))} />
              <ChipGroup legend={t('netview.filter.functional')} options={(['yes', 'no', 'unknown'] as const).map((v) => ({ value: v, label: t(`netview.filter.functional.${v}` as MsgKey) }))} value={state.links.functional} onToggle={(v) => setState((x) => toggleFilter(x, 'functional', v))} />
            </>
          )}
          <label className={s.search}>
            <span>{t('netview.filter.search')} <span className={s.hint}>· {t('netview.filter.searchHint')}</span></span>
            <input type="search" value={q} maxLength={MAX_Q} placeholder={devices ? t('netview.filter.searchDevices') : t('netview.filter.searchLinks')} autoComplete="off" onChange={(e) => setState((x) => setSearch(x, e.target.value))} />
          </label>
        </div>

        {active.length > 0 && (
          <div className={s.activeRow} role="group" aria-label={t('netview.active.title')}>
            {active.map((f) => (
              <button key={f.key} type="button" className={s.activeChip} aria-label={t('netview.active.remove', { label: chipLabel(f.key), value: chipValue(f.key, f.value) })} onClick={() => setState((x) => removeFilter(x, f.key))}>
                {chipLabel(f.key)}: {chipValue(f.key, f.value)} <span aria-hidden>×</span>
              </button>
            ))}
            <button type="button" className={s.clear} onClick={() => setState(clearFilters)}>{t('netview.clear')}</button>
          </div>
        )}

        <div className={s.meta}>
          <span role="status" aria-live="polite">{cur.state === 'ready' ? t('netview.range', { from: formatNumber(range.from, lang, 0), to: formatNumber(range.to, lang, 0), total: formatNumber(cur.data.total, lang, 0) }) : cur.state === 'loading' ? t('netview.table.loading') : ''}</span>
          <span className={s.sizes}>
            {t('netview.pageSize')}
            {PAGE_SIZES.map((n) => <button key={n} type="button" className={state.pageSize === n ? s.chipOn : s.chip} aria-pressed={state.pageSize === n} onClick={() => setState((x) => setPageSize(x, n))}>{n}</button>)}
          </span>
        </div>

        {cur.state === 'error' ? (
          <p className={s.errorBox} role="alert"><span>{errorText(cur.cause, t, 'netview.table.error')}</span><button type="button" className={ui.btnGhost} onClick={retry}>{t('netview.retry')}</button></p>
        ) : cur.state === 'ready' && cur.data.items.length === 0 ? (
          <p className={s.empty}>{t('netview.noMatch')} {active.length > 0 && <button type="button" className={s.clear} onClick={() => setState(clearFilters)}>{t('netview.clear')}</button>}</p>
        ) : (
          <div className={ui.scrollTall} aria-busy={cur.state === 'loading'}>
            {devices ? (
              <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                <caption className={s.sr}>{t('netview.devices.caption')}</caption>
                <thead><tr>{th(t('netview.col.name'), 'name')}{th(t('netview.col.category'), 'category')}{th(t('netview.col.model'), 'model')}{th(t('netview.col.criticality'), 'criticality')}{th(t('netview.col.ip'))}{th(t('netview.col.syslog'))}{th(t('netview.col.snmp'))}{th(t('netview.col.ntp'))}{th(t('netview.col.netflow'))}{th(t('netview.col.links'), undefined, ui.num)}{th(t('netview.col.actions'))}</tr></thead>
                <tbody>
                  {cur.state === 'ready' && (cur.data as Page<NetworkDeviceItem>).items.map((d) => (
                    <tr key={d.id}>
                      <td><strong>{d.name}</strong><span className={s.roleText}>{d.role}</span></td>
                      <td data-label={t('netview.col.category')}>{d.category}</td>
                      <td data-label={t('netview.col.model')}>{d.model}</td>
                      <td data-label={t('netview.col.criticality')}><CritChip value={d.criticality} t={t} /></td>
                      <td data-label={t('netview.col.ip')} className={s.ip}>{d.ips ?? '—'}</td>
                      <td data-label={t('netview.col.syslog')}>{config(d, d.syslog)}</td>
                      <td data-label={t('netview.col.snmp')}>{config(d, d.snmp)}</td>
                      <td data-label={t('netview.col.ntp')}>{config(d, d.ntp)}</td>
                      <td data-label={t('netview.col.netflow')}>{config(d, d.netflow)}</td>
                      <td data-label={t('netview.col.links')} className={ui.num}>{d.links}</td>
                      <td data-label={t('netview.col.actions')}><button type="button" className={s.rowBtn} disabled={d.links === 0} aria-label={t('netview.viewLinksOf', { name: d.name })} onClick={() => setState((x) => linksOfDevice(x, d.name))}>{t('netview.viewLinks')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                <caption className={s.sr}>{t('netview.links.caption')}</caption>
                <thead><tr>{th(t('netview.col.id'), 'id')}{th(t('netview.col.origin'), 'origin')}{th(t('netview.col.destination'), 'destination')}{th(t('netview.col.type'))}{th(t('netview.col.functional'))}{th(t('netview.col.length'), 'length', ui.num)}{th(t('netview.col.criticality'), 'criticality')}</tr></thead>
                <tbody>
                  {cur.state === 'ready' && (cur.data as Page<NetworkLinkItem>).items.map((l) => (
                    <tr key={l.id}>
                      <td>#{l.id}</td>
                      <td data-label={t('netview.col.origin')}><span>{l.origin}</span><span className={`${s.small} ${s.ip}`}>{l.originPort}</span></td>
                      <td data-label={t('netview.col.destination')}><span>{l.destination}</span><span className={`${s.small} ${s.ip}`}>{l.destinationPort}</span></td>
                      <td data-label={t('netview.col.type')}><span>{l.linkType}</span>{l.cableType && <span className={s.small}>{l.cableType}</span>}</td>
                      <td data-label={t('netview.col.functional')}>{l.functional === null ? <span className={s.na}><span aria-hidden>— </span>{t('netview.cell.noData')}</span> : l.functional ? <span className={s.on}><span aria-hidden>✓</span> {t('netview.cell.yes')}</span> : <span className={s.off}><span aria-hidden>✗</span> {t('netview.cell.no')}</span>}</td>
                      <td data-label={t('netview.col.length')} className={ui.num}>{l.length === null ? '—' : formatNumber(l.length, lang, 1)}</td>
                      <td data-label={t('netview.col.criticality')}><CritChip value={l.criticality} t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {cur.state === 'ready' && pages > 1 && (
          <nav className={s.pager} aria-label={t('netview.pager.label')}>
            <span>{t('netview.pager.of', { page: page + 1, pages })}</span>
            <span className={s.pagerBtns}>
              <button type="button" className={s.pagerBtn} disabled={page === 0} onClick={() => setState((x) => setPage(x, page - 1))}>{t('netview.pager.prev')}</button>
              <button type="button" className={s.pagerBtn} disabled={page >= pages - 1} onClick={() => setState((x) => setPage(x, page + 1))}>{t('netview.pager.next')}</button>
            </span>
          </nav>
        )}
      </div>
    </section>
  );
});
