import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatInstant } from '../lib/format';
import type { NetworkDeviceItem, TelemetryDevice } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

const CCTV_CATEGORY = 'CCTV / IoT';
const isCamera = (d: TelemetryDevice) => /webcam|c[aá]mara|camera/i.test(`${d.name} ${d.kind}`);

/**
 * Cámaras (solo gerencia): las cámaras IP que reportan por IoT (WEBCAM_OF*) y los equipos «CCTV / IoT» del inventario de red. NO hay video: solo el estado
 * de los equipos que los datos de Nexus traen. Se arma con las pantallas de Sensores y Red, sin un servicio nuevo.
 */
export function CamerasView() {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [iot, setIot] = useState<TelemetryDevice[] | null>(null);
  const [net, setNet] = useState<NetworkDeviceItem[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.telemetry(), api.networkDevices({ category: CCTV_CATEGORY, limit: 100, sort: 'name' })]);
      if (!alive.current) return;
      setIot(s.devices.filter(isCamera)); setNet(n.items); setError('');
    } catch (e) { if (alive.current) setError(t('cam.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-labelledby="cam-h">
      <h2 id="cam-h" className={ui.h2}>{t('cam.title')}</h2>
      <p className={ui.muted}>{t('cam.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      <h3 className={ui.h2}>{t('cam.iot.title')}</h3>
      {iot === null ? <p className={ui.muted} role="status">…</p> : iot.length === 0 ? <p className={ui.muted}>{t('cam.iot.empty')}</p> : (
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className="sr-only">{t('cam.iot.title')}</caption>
            <thead><tr><th>{t('cam.col.name')}</th><th>{t('cam.col.location')}</th><th>{t('cam.col.connection')}</th><th>{t('cam.col.state')}</th><th>{t('cam.col.last')}</th></tr></thead>
            <tbody>{iot.map((d) => (
              <tr key={d.id} data-camera={d.name}>
                <td>{d.name}</td>
                <td data-label={t('cam.col.location')}>{d.location}</td>
                <td data-label={t('cam.col.connection')}>{d.connection === 'ONLINE' ? t('cam.online') : t('cam.offline')}</td>
                <td data-label={t('cam.col.state')}>{t(`iot.state.${d.state}` as 'iot.state.normal')}</td>
                <td data-label={t('cam.col.last')}>{d.lastAt ? `${d.lastStatus ?? ''} · ${formatInstant(d.lastAt, lang)}` : t('cam.noReading')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <h3 className={ui.h2}>{t('cam.net.title')}</h3>
      {net === null ? <p className={ui.muted} role="status">…</p> : net.length === 0 ? <p className={ui.muted}>{t('cam.net.empty')}</p> : (
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className="sr-only">{t('cam.net.title')}</caption>
            <thead><tr><th>{t('cam.col.name')}</th><th>{t('cam.col.model')}</th><th>{t('cam.col.role')}</th><th>{t('cam.col.criticality')}</th><th>{t('cam.col.monitored')}</th></tr></thead>
            <tbody>{net.map((d) => (
              <tr key={d.id} data-netcam={d.name}>
                <td>{d.name}</td>
                <td data-label={t('cam.col.model')}>{d.model}</td>
                <td data-label={t('cam.col.role')}>{d.role}</td>
                <td data-label={t('cam.col.criticality')}>{d.criticality}</td>
                <td data-label={t('cam.col.monitored')}>{d.monitored ? t('cam.yes') : t('cam.no')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
