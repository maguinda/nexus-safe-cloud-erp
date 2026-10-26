import { ChartCard } from '../../charts';
import type { Lang } from '../../i18n/core';
import type { TFn } from '../../i18n';
import { COVERAGE_COLUMNS, type CoverageColumn, type CoverageRow, coverageTotals } from '../../lib/netview';
import { CritChip } from './parts';
import s from './network.module.css';

const COL_LABEL: Record<CoverageColumn, 'netview.col.syslog' | 'netview.col.snmp' | 'netview.col.ntp' | 'netview.col.netflow'> = { syslog: 'netview.col.syslog', snmp: 'netview.col.snmp', ntp: 'netview.col.ntp', netflow: 'netview.col.netflow' };

/**
 * Matriz de cobertura: una fila por equipo de infraestructura (Crítica primero) y una columna por cosa monitoreable. Cada celda dice ✓ o ✗ con TEXTO oculto
 * además del color; el nombre del equipo es un botón que lleva a sus enlaces. Es una tabla real: ya es su propia alternativa para lectores de pantalla.
 */
export function CoverageGrid({ rows, lang, t, signals, onViewLinks }: { rows: CoverageRow[]; lang: Lang; t: TFn; signals: number; onViewLinks: (name: string) => void }) {
  const tot = coverageTotals(rows);
  return (
    <ChartCard lang={lang} t={t} title={t('netview.coverage.title')} subtitle={t('netview.coverage.sub')} state={rows.length ? 'ready' : 'empty'} footnote={t('netview.coverage.foot', { signals })}>
      <div className={s.coverScroll}>
        <table className={s.cover}>
          <caption className={s.sr}>{t('netview.coverage.caption', { n: rows.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('netview.coverage.device')}</th>
              <th scope="col">{t('netview.col.criticality')}</th>
              {COVERAGE_COLUMNS.map((c) => <th key={c} scope="col" className={s.mid}>{t(COL_LABEL[c])}</th>)}
              <th scope="col">{t('netview.coverage.signals')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">
                  <button type="button" className={s.nameBtn} aria-label={t('netview.coverage.viewLinks', { name: r.name })} onClick={() => onViewLinks(r.name)}>{r.name}</button>
                  <span className={s.model}>{r.model}</span>
                </th>
                <td><CritChip value={r.criticality} t={t} /></td>
                {COVERAGE_COLUMNS.map((c) => (
                  <td key={c} className={s.mid}>
                    {r.cells[c] ? <span className={s.on}><span aria-hidden>✓</span><span className={s.sr}>{t('netview.coverage.on')}</span></span> : <span className={s.off}><span aria-hidden>✗</span><span className={s.sr}>{t('netview.coverage.off')}</span></span>}
                  </td>
                ))}
                <td className={s.na}>{t('netview.coverage.signalsValue', { n: r.signals })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.coverSummary}>{t('netview.coverage.summary', { syslog: tot.syslog, snmp: tot.snmp, ntp: tot.ntp, netflow: tot.netflow, n: tot.equipment })}</p>
    </ChartCard>
  );
}
