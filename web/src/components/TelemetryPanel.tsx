import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import { formatCount, formatInstant } from '../lib/format';
import { avgLabel, readingLabel, STATE_KEY, windowLabel } from '../lib/telemetry';
import type { DeviceState, TelemetrySummary } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { KpiCard } from './KpiCard';
import s from './TelemetryPanel.module.css';

const REFRESH_MS = 30_000;
const CHIP: Record<DeviceState, string> = { normal: ui.stateNormal, warning: ui.stateWarning, alert: ui.stateAlert, no_data: ui.stateNoData };

/** Red y sensores IoT de Nexus (datos de la carpeta PROYECTO_NEXUS cargados en Analytics). Solo lo ve el gerente, igual que el resto del tablero. */
export function TelemetryPanel() {
  const { api, t, lang } = useSession();
  const [data, setData] = useState<TelemetrySummary | null>(null);
  const [error, setError] = useState('');
  // En un celular la lista de 21 dispositivos (una tarjeta cada uno) mide miles de píxeles: allí empieza plegada, con un botón a la vista.
  const [devicesOpen, setDevicesOpen] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 641px)').matches);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const d = await api.telemetry();
      if (!alive.current) return;
      setData(d); setError('');
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e, t, 'iot.loadError'));
    }
  }, [api, t]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => clearInterval(poll);
  }, [load]);

  if (!data) {
    return error
      ? <div className={ui.panelError} role="alert"><strong>{t('iot.unavailable')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('iot.retry')}</button></div>
      : <p className={ui.muted} role="status">{t('iot.loading')}</p>;
  }
  const tot = data.totals;
  if (tot.devices === 0) {
    return <section aria-labelledby="iot-h"><h3 id="iot-h" className={ui.h2}>{t('iot.title')}</h3><p className={ui.muted}>{t('iot.empty')}</p></section>;
  }

  return (
    <section aria-labelledby="iot-h" className={s.wrap}>
      <div className={s.head}>
        <h3 id="iot-h" className={ui.h2}>{t('iot.title')}</h3>
        <p className={s.sub}>{t('iot.sub', { devices: formatCount(tot.devices, lang), readings: formatCount(tot.readings, lang), window: windowLabel(data.window, lang) })}</p>
      </div>
      {error && <p className={s.sub} role="status">{t('iot.stale', { error })}</p>}

      <div className={ui.kpis}>
        <KpiCard icon="signal" tone={tot.online === tot.devices ? 'ok' : 'warn'} label={t('iot.kpi.online')} value={<>{tot.online} / {tot.devices}</>} sub={t('iot.kpi.onlineSub')} />
        <KpiCard icon="pulse" label={t('iot.kpi.readings')} value={formatCount(tot.readings, lang)} sub={t('iot.kpi.readingsSub', { n: formatCount(tot.normal, lang) })} />
        <KpiCard icon="warning" tone={tot.warnings > 0 ? 'warn' : undefined} valueClass={tot.warnings > 0 ? s.warnN : undefined} label={t('iot.kpi.warnings')} value={tot.warnings} sub={t('iot.kpi.warningsSub')} />
        <KpiCard icon="alert" tone={tot.alerts > 0 ? 'bad' : undefined} valueClass={tot.alerts > 0 ? s.alertN : undefined} label={t('iot.kpi.alerts')} value={tot.alerts} sub={t('iot.kpi.alertsSub')} />
      </div>

      <section aria-labelledby="iot-off-h">
        <h4 id="iot-off-h" className={ui.h2}>{t('iot.byOffice')}</h4>
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('iot.officeCaption')}</caption>
            <thead><tr><th>{t('iot.col.office')}</th><th className={ui.num}>{t('iot.col.devices')}</th><th className={ui.num}>{t('iot.col.avgTemp')}</th><th className={ui.num}>{t('iot.col.avgHumidity')}</th><th className={ui.num}>{t('iot.col.warnings')}</th><th className={ui.num}>{t('iot.col.alerts')}</th></tr></thead>
            <tbody>
              {data.byLocation.map((l) => (
                <tr key={l.location}>
                  <td>{l.location}</td>
                  <td className={ui.num} data-label={t('iot.col.devices')}>{l.devices}</td>
                  <td className={ui.num} data-label={t('iot.col.avgTemp')}>{avgLabel(l.avgTempC, '°C', lang)}</td>
                  <td className={ui.num} data-label={t('iot.col.avgHumidity')}>{avgLabel(l.avgHumidityPct, '%', lang)}</td>
                  <td className={ui.num} data-label={t('iot.col.warnings')}>{l.warnings}</td>
                  <td className={ui.num} data-label={t('iot.col.alerts')}>{l.alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={ui.card} aria-labelledby="iot-att-h">
        <h4 id="iot-att-h" className={ui.h2}>{t('iot.attention')}</h4>
        {data.attention.length === 0
          ? <p className={ui.muted}>{t('iot.attentionEmpty')}</p>
          : (
            <ol className={s.attention}>
              {data.attention.map((a) => (
                <li key={`${a.at}-${a.deviceId}`}>
                  <span className={s.attLine}>
                    <span className={a.status === 'ALERT' ? ui.stateAlert : ui.stateWarning}>{a.status === 'ALERT' ? t('iot.state.alert') : t('iot.state.warning')}</span>
                    <span className={s.msg}><strong>{a.deviceName}</strong> · {a.location}</span>
                  </span>
                  <span className={s.when}>{formatInstant(a.at, lang)} · {readingLabel({ unit: a.unit, lastValue: a.value, lastStatus: a.status }, lang)}{a.note ? ` · ${a.note}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
      </section>

      <section aria-labelledby="iot-dev-h">
        <h4 id="iot-dev-h" className={ui.h2}>{t('iot.devices')}</h4>
        <details className={s.devices} open={devicesOpen} onToggle={(e) => setDevicesOpen(e.currentTarget.open)}>
          <summary className={s.summary}>{t('iot.devicesSummary', { n: formatCount(tot.devices, lang) })}</summary>
        <div className={ui.scrollTall}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('iot.devicesCaption')}</caption>
            <thead><tr><th>{t('iot.col.device')}</th><th>{t('iot.col.office')}</th><th>{t('iot.col.type')}</th><th>{t('iot.col.latest')}</th><th>{t('iot.col.state')}</th><th className={ui.num}>{t('iot.col.warnings')}</th><th className={ui.num}>{t('iot.col.alerts')}</th></tr></thead>
            <tbody>
              {data.devices.map((d) => (
                <tr key={d.id}>
                  <td><span className={s.devName}>{d.name}</span><span className={s.devId}>{d.id}</span></td>
                  <td data-label={t('iot.col.office')}>{d.location}</td>
                  <td data-label={t('iot.col.type')}>{d.kind}</td>
                  <td data-label={t('iot.col.latest')}>{readingLabel(d, lang)}</td>
                  <td data-label={t('iot.col.state')}><span className={CHIP[d.state]}>{t(STATE_KEY[d.state])}</span></td>
                  <td className={ui.num} data-label={t('iot.col.warnings')}>{d.warnings}</td>
                  <td className={ui.num} data-label={t('iot.col.alerts')}>{d.alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
      </section>
    </section>
  );
}
