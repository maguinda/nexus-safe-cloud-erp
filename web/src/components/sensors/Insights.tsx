import type { FC } from 'react';
import type { MsgKey, TFn } from '../../i18n';
import type { Lang } from '../../i18n/core';
import { insightFilter, insightParams, type SensorFilters } from '../../lib/sensors';
import type { Insight, TelemetryFacets, TrendsInsightCode } from '../../lib/types';
import ui from '../../styles/ui.module.css';
import s from './Sensors.module.css';

/** Los hallazgos que la pantalla sabe contar. Uno que el servidor agregue después y aquí no esté se omite en vez de mostrar un texto vacío. */
export const KNOWN_INSIGHTS: readonly TrendsInsightCode[] = ['simultaneous_alerts', 'periodic_warnings', 'warnings_everywhere', 'office_hotter', 'all_normal'];

const SEV: Record<Insight['severity'], { pill: string; card: string; icon: string; label: MsgKey }> = {
  high: { pill: ui.stateAlert, card: s.sevHigh, icon: '✕', label: 'sensors.sev.high' },
  medium: { pill: ui.stateWarning, card: s.sevMedium, icon: '!', label: 'sensors.sev.medium' },
  info: { pill: ui.stateNoData, card: s.sevInfo, icon: 'i', label: 'sensors.sev.info' },
};
const k = (code: string, part: string) => `sensors.insight.${code}.${part}` as MsgKey;

/** Una tarjeta por hallazgo: la prioridad (con icono Y texto), la frase con sus números, cómo se detectó y el botón que enseña las lecturas que lo respaldan. */
export const Insights: FC<{ insights: Insight<TrendsInsightCode>[]; facets: TelemetryFacets | null; lang: Lang; t: TFn; onView: (filter: Partial<SensorFilters>) => void }> = ({ insights, facets, lang, t, onView }) => {
  const shown = insights.filter((i) => KNOWN_INSIGHTS.includes(i.code));
  return (
    <section aria-labelledby="sensors-findings-h" className={s.section}>
      <div>
        <h2 id="sensors-findings-h" className={ui.h2}>{t('sensors.findings.title')}</h2>
        <p className={s.sub}>{t('sensors.findings.sub')}</p>
      </div>
      <ul className={s.insights}>
        {shown.map((i) => {
          const params = insightParams(i, lang);
          const sev = SEV[i.severity] ?? SEV.info;
          const title = t(k(i.code, 'title'), params);
          const body = t(i.code === 'periodic_warnings' ? k(i.code, Number(i.params.devices) > 1 ? 'bodyMany' : 'bodyOne') : k(i.code, 'body'), params);
          const filter = insightFilter(i, facets);
          return (
            <li key={`${i.code}-${String(i.params.at ?? i.params.location ?? '')}`} className={`${s.insight} ${sev.card}`}>
              <div className={s.insightHead}>
                <span className={sev.pill}><span className={s.icon} aria-hidden>{sev.icon}</span>{t(sev.label)}</span>
              </div>
              <h3 className={s.insightTitle}>{title}</h3>
              <p className={s.insightBody}>{body}</p>
              <p className={s.how}>{t('sensors.insight.how', { rule: t(k(i.code, 'how')) })}</p>
              {filter && <button type="button" className={`${ui.btnGhost} ${s.insightAction}`} onClick={() => onView(filter)} aria-label={t('sensors.insight.viewFor', { title })}>{t('sensors.insight.view')}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
