import type { Dispatch, FC, RefObject } from 'react';
import { formatNumber } from '../../charts/format';
import type { MsgKey, TFn } from '../../i18n';
import type { Lang } from '../../i18n/core';
import { formatInstant } from '../../lib/format';
import { pageInfo, PAGE_SIZES, type ExplorerAction, type ExplorerState, type SortKey } from '../../lib/sensors';
import type { Page, ReadingItem } from '../../lib/types';
import ui from '../../styles/ui.module.css';
import s from './Sensors.module.css';

export type ReadingsLoad = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; page: Page<ReadingItem> };

const SEV_PILL = { normal: ui.stateNormal, warning: ui.stateWarning, alert: ui.stateAlert } as const;

/** El valor de una lectura: con su unidad; las señales de sí/no (unidad BOOL) llevan solo el 0 o el 1, porque su significado ya está en el estado. */
export const readingValue = (r: Pick<ReadingItem, 'value' | 'unit'>, lang: Lang): string => (r.unit === 'BOOL' ? formatNumber(r.value, lang, 1) : `${formatNumber(r.value, lang, 1)} ${r.unit}`);

/** Tabla explorable de lecturas: orden por columna, paginación y estados cargando/vacío/error. Las notas, los dispositivos y los estados son de la fuente y NO se traducen. */
export const ReadingsTable: FC<{ load: ReadingsLoad; state: ExplorerState; dispatch: Dispatch<ExplorerAction>; headingRef: RefObject<HTMLHeadingElement | null>; onRetry: () => void; lang: Lang; t: TFn }> = ({ load, state, dispatch, headingRef, onRetry, lang, t }) => {
  const info = load.status === 'ready' ? pageInfo(load.page.total, load.page.offset, load.page.limit, load.page.items.length) : null;
  const sortHead = (key: SortKey, label: string, num = false) => (
    <th className={num ? ui.num : undefined} aria-sort={state.sort === key ? (state.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={ui.sortBtn} onClick={() => dispatch({ type: 'sort', key })} aria-label={t('sensors.table.sortBy', { label })}>
        {label}<span aria-hidden>{state.sort === key ? (state.order === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  );
  return (
    <section aria-labelledby="sensors-table-h" className={s.section}>
      <div className={s.tableHead}>
        <div>
          <h2 id="sensors-table-h" ref={headingRef} tabIndex={-1} className={`${ui.h2} ${s.focusable}`}>{t('sensors.table.title')}</h2>
          <p className={s.sub}>{t('sensors.table.sub')}</p>
        </div>
        <span className={s.count} role="status" aria-live="polite">
          {info && load.status === 'ready' ? (load.page.total === 0 ? t('sensors.table.empty') : t('sensors.table.count', { first: formatNumber(info.first, lang, 0), last: formatNumber(info.last, lang, 0), total: formatNumber(load.page.total, lang, 0) })) : ''}
        </span>
      </div>

      {load.status === 'error' && <div className={ui.panelError} role="alert"><strong>{t('sensors.table.error')}</strong><span>{load.message}</span><button type="button" className={ui.btnGhost} onClick={onRetry}>{t('sensors.retry')}</button></div>}
      {load.status === 'loading' && <p className={s.loading} role="status">{t('sensors.table.loading')}</p>}
      {load.status === 'ready' && load.page.total === 0 && <div className={s.empty}><strong>{t('sensors.table.empty')}</strong><span className={s.sub}>{t('sensors.table.emptyHint')}</span></div>}

      {load.status === 'ready' && load.page.items.length > 0 && (
        <div className={ui.scrollTall}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('sensors.table.caption')}</caption>
            <thead>
              <tr>
                {sortHead('at', t('sensors.col.time'))}
                <th>{t('sensors.col.office')}</th>
                {sortHead('device', t('sensors.col.device'))}
                <th>{t('sensors.col.kind')}</th>
                {sortHead('status', t('sensors.col.status'))}
                {sortHead('value', t('sensors.col.value'), true)}
                <th>{t('sensors.col.note')}</th>
              </tr>
            </thead>
            <tbody>
              {load.page.items.map((r) => (
                <tr key={r.id}>
                  <td>{formatInstant(r.at, lang)}</td>
                  <td data-label={t('sensors.col.office')}>{r.location}</td>
                  <td data-label={t('sensors.col.device')}><span className={s.deviceName}>{r.deviceName}</span><span className={s.deviceId}>{r.deviceId}</span></td>
                  <td data-label={t('sensors.col.kind')}>{r.deviceKind}</td>
                  <td data-label={t('sensors.col.status')}><span><span className={SEV_PILL[r.severity]}>{t(`sensors.severity.${r.severity}` as MsgKey)}</span><span className={s.rawStatus}>{r.status}</span></span></td>
                  <td className={ui.num} data-label={t('sensors.col.value')}>{readingValue(r, lang)}</td>
                  <td className={s.note} data-label={t('sensors.col.note')}>{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {info && load.status === 'ready' && load.page.total > 0 && (
        <div className={s.pager}>
          <div className={s.pagerGroup} role="group" aria-label={t('sensors.table.pageSize')}>
            <span className={s.sub}>{t('sensors.table.pageSize')}</span>
            {PAGE_SIZES.map((n) => <button key={n} type="button" className={s.pageBtn} aria-pressed={state.pageSize === n} onClick={() => dispatch({ type: 'pageSize', size: n })}>{n}</button>)}
          </div>
          <div className={s.pagerGroup}>
            <button type="button" className={s.pageBtn} disabled={info.page <= 1} onClick={() => dispatch({ type: 'page', page: state.page - 1 })}>{t('sensors.table.prev')}</button>
            <span className={s.sub} aria-live="polite">{t('sensors.table.page', { page: formatNumber(info.page, lang, 0), pages: formatNumber(info.pages, lang, 0) })}</span>
            <button type="button" className={s.pageBtn} disabled={info.page >= info.pages} onClick={() => dispatch({ type: 'page', page: state.page + 1 })}>{t('sensors.table.next')}</button>
          </div>
        </div>
      )}
    </section>
  );
};
