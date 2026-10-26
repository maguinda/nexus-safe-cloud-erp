import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { atLabel, avgLabel, count, readingLabel, STATE_LABEL, windowLabel } from '../lib/telemetry';
import type { DeviceState, TelemetrySummary } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './TelemetryPanel.module.css';

const REFRESH_MS = 30_000;
const CHIP: Record<DeviceState, string> = { normal: ui.stateNormal, warning: ui.stateWarning, alert: ui.stateAlert, no_data: ui.stateNoData };

/** Red y sensores IoT de Nexus (datos de la carpeta PROYECTO_NEXUS cargados en Analytics). Solo lo ve el gerente, igual que el resto del tablero. */
export function TelemetryPanel() {
  const { api } = useSession();
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
      setError(e instanceof ApiError ? e.message : 'We could not load the network data. Check your connection.');
    }
  }, [api]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => clearInterval(poll);
  }, [load]);

  if (!data) {
    return error
      ? <div className={ui.panelError} role="alert"><strong>Network &amp; IoT is not available</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>Try again</button></div>
      : <p className={ui.muted} role="status">Loading network and IoT data…</p>;
  }
  const t = data.totals;
  if (t.devices === 0) {
    return <section aria-labelledby="iot-h"><h3 id="iot-h" className={ui.h2}>Network &amp; IoT</h3><p className={ui.muted}>No Nexus telemetry has been loaded yet. It is loaded by the Analytics seed (SEED_DEMO=true).</p></section>;
  }

  return (
    <section aria-labelledby="iot-h" className={s.wrap}>
      <div className={s.head}>
        <h3 id="iot-h" className={ui.h2}>Network &amp; IoT</h3>
        <p className={s.sub}>Nexus sensor data · {count(t.devices)} devices · {count(t.readings)} readings · {windowLabel(data.window)}</p>
      </div>
      {error && <p className={s.sub} role="status">We could not refresh just now ({error}). Showing the last data.</p>}

      <div className={ui.kpis}>
        <div className={ui.card}><small className={ui.muted}>Devices online</small><strong className={ui.kpi}>{t.online} / {t.devices}</strong><span className={ui.kpiSub}>by the Nexus inventory</span></div>
        <div className={ui.card}><small className={ui.muted}>Readings</small><strong className={ui.kpi}>{count(t.readings)}</strong><span className={ui.kpiSub}>{count(t.normal)} normal</span></div>
        <div className={ui.card}><small className={ui.muted}>Warnings</small><strong className={`${ui.kpi} ${t.warnings > 0 ? s.warnN : ''}`}>{t.warnings}</strong><span className={ui.kpiSub}>readings above a threshold</span></div>
        <div className={ui.card}><small className={ui.muted}>Alerts</small><strong className={`${ui.kpi} ${t.alerts > 0 ? s.alertN : ''}`}>{t.alerts}</strong><span className={ui.kpiSub}>readings in alert</span></div>
      </div>

      <section aria-labelledby="iot-off-h">
        <h4 id="iot-off-h" className={ui.h2}>By office</h4>
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>Devices, average temperature and humidity, warnings and alerts for each office</caption>
            <thead><tr><th>Office</th><th className={ui.num}>Devices</th><th className={ui.num}>Avg temperature</th><th className={ui.num}>Avg humidity</th><th className={ui.num}>Warnings</th><th className={ui.num}>Alerts</th></tr></thead>
            <tbody>
              {data.byLocation.map((l) => (
                <tr key={l.location}>
                  <td>{l.location}</td>
                  <td className={ui.num} data-label="Devices">{l.devices}</td>
                  <td className={ui.num} data-label="Avg temperature">{avgLabel(l.avgTempC, '°C')}</td>
                  <td className={ui.num} data-label="Avg humidity">{avgLabel(l.avgHumidityPct, '%')}</td>
                  <td className={ui.num} data-label="Warnings">{l.warnings}</td>
                  <td className={ui.num} data-label="Alerts">{l.alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={ui.card} aria-labelledby="iot-att-h">
        <h4 id="iot-att-h" className={ui.h2}>Latest warnings and alerts</h4>
        {data.attention.length === 0
          ? <p className={ui.muted}>No warnings or alerts in the loaded data.</p>
          : (
            <ol className={s.attention}>
              {data.attention.map((a) => (
                <li key={`${a.at}-${a.deviceId}`}>
                  <span className={s.attLine}>
                    <span className={a.status === 'ALERT' ? ui.stateAlert : ui.stateWarning}>{a.status === 'ALERT' ? 'Alert' : 'Warning'}</span>
                    <span className={s.msg}><strong>{a.deviceName}</strong> · {a.location}</span>
                  </span>
                  <span className={s.when}>{atLabel(a.at)} · {readingLabel({ unit: a.unit, lastValue: a.value, lastStatus: a.status })}{a.note ? ` · ${a.note}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
      </section>

      <section aria-labelledby="iot-dev-h">
        <h4 id="iot-dev-h" className={ui.h2}>Devices</h4>
        <details className={s.devices} open={devicesOpen} onToggle={(e) => setDevicesOpen(e.currentTarget.open)}>
          <summary className={s.summary}>{count(t.devices)} devices with their latest reading</summary>
        <div className={ui.scrollTall}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>Every IoT device with its latest reading and its warning and alert counts</caption>
            <thead><tr><th>Device</th><th>Office</th><th>Type</th><th>Latest reading</th><th>State</th><th className={ui.num}>Warnings</th><th className={ui.num}>Alerts</th></tr></thead>
            <tbody>
              {data.devices.map((d) => (
                <tr key={d.id}>
                  <td><span className={s.devName}>{d.name}</span><span className={s.devId}>{d.id}</span></td>
                  <td data-label="Office">{d.location}</td>
                  <td data-label="Type">{d.kind}</td>
                  <td data-label="Latest reading">{readingLabel(d)}</td>
                  <td data-label="State"><span className={CHIP[d.state]}>{STATE_LABEL[d.state]}</span></td>
                  <td className={ui.num} data-label="Warnings">{d.warnings}</td>
                  <td className={ui.num} data-label="Alerts">{d.alerts}</td>
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
