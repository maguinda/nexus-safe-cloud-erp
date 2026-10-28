import type { FC } from 'react';
import { Sparkline } from '../../charts';
import { formatNumber } from '../../charts/format';
import type { TFn } from '../../i18n';
import type { Lang } from '../../i18n/core';
import { cardFilter, rangeSpanLabel, slotName, type SensorCards, type SensorFilters } from '../../lib/sensors';
import type { TelemetryFacets, Trends } from '../../lib/types';
import ui from '../../styles/ui.module.css';
import s from './Sensors.module.css';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Las cifras clave, cada una con su contexto (de dónde sale y frente a qué se compara) y un «Ver detalle» que filtra la tabla cuando hay algo que ver. */
export const Cards: FC<{ cards: SensorCards; facets: TelemetryFacets | null; location: string; range: Trends['range']; window: { from: string; to: string } | null; bucketMinutes: number; lang: Lang; t: TFn; onDetail: (f: Partial<SensorFilters>) => void }> = ({ cards, facets, location, range, window, bucketMinutes, lang, t, onDetail }) => {
  const n0 = (n: number) => formatNumber(n, lang, 0);
  const n1 = (n: number | null) => (n === null ? '—' : formatNumber(n, lang, 1));
  const detail = (id: Parameters<typeof cardFilter>[0], label: string) => {
    const f = cardFilter(id, facets);
    return f ? <button type="button" className={s.cardAction} onClick={() => onDetail(f)} aria-label={t('sensors.cards.detailFor', { card: label })}>{t('sensors.cards.detail')}</button> : null;
  };
  const temp = mean(cards.meanTemp);
  const tempLabel = t('sensors.cards.temperature');
  return (
    <section aria-labelledby="sensors-cards-h" className={s.section}>
      <h2 id="sensors-cards-h" className={ui.h2}>{t('sensors.cards.title')}</h2>
      <div className={s.cards}>
        <div className={`${ui.card} ${s.card}`}>
          <span className={s.cardLabel}>{t('sensors.cards.readings')}</span>
          <strong className={s.cardValue}>{n0(cards.readings)}</strong>
          <span className={s.cardSub}>{t('sensors.cards.readingsSub', { n: n0(cards.normal) })}</span>
          {detail('readings', t('sensors.cards.readings'))}
        </div>
        <div className={`${ui.card} ${s.card}`}>
          <span className={s.cardLabel}>{t('sensors.cards.warnings')}</span>
          <strong className={`${s.cardValue} ${cards.warnings > 0 ? s.valueWarn : ''}`}>{n0(cards.warnings)}</strong>
          <span className={s.cardSub}>{cards.warningSharePct === null ? t('sensors.cards.warningsSubNone') : t('sensors.cards.warningsSub', { pct: n1(cards.warningSharePct) })}</span>
          {detail('warnings', t('sensors.cards.warnings'))}
        </div>
        <div className={`${ui.card} ${s.card}`}>
          <span className={s.cardLabel}>{t('sensors.cards.alerts')}</span>
          <strong className={`${s.cardValue} ${cards.alerts > 0 ? s.valueBad : ''}`}>{n0(cards.alerts)}</strong>
          <span className={s.cardSub}>{t('sensors.cards.alertsSub')}</span>
          {detail('alerts', t('sensors.cards.alerts'))}
        </div>
        <div className={`${ui.card} ${s.card}`}>
          <span className={s.cardLabel}>{tempLabel}</span>
          <div className={s.cardRow}>
            <strong className={s.cardValue}>{temp === null ? '—' : `${n1(temp)} °C`}</strong>
          </div>
          {cards.meanTemp.length >= 2 && <Sparkline values={cards.meanTemp} ariaLabel={t('sensors.cards.temperatureSpark', { slot: slotName(bucketMinutes, t), min: n1(Math.min(...cards.meanTemp)), max: n1(Math.max(...cards.meanTemp)) })} />}
          <span className={s.cardSub}>
            {cards.tempPeak === null ? '—' : cards.threshold === null ? t('sensors.cards.temperatureSubPeak', { peak: n1(cards.tempPeak) }) : t('sensors.cards.temperatureSub', { peak: n1(cards.tempPeak), threshold: n1(cards.threshold) })}
          </span>
          {detail('temperature', tempLabel)}
        </div>
        <div className={`${ui.card} ${s.card}`}>
          <span className={s.cardLabel}>{t('sensors.cards.heater')}</span>
          <strong className={s.cardValue}>{cards.heater === null ? '—' : `${n0(Math.round(cards.heater))} %`}</strong>
          <span className={s.cardSub}>{t('sensors.cards.heaterSub', { scope: location || t('sensors.cards.scopeAll') })}</span>
          {detail('heater', t('sensors.cards.heater'))}
        </div>
        <div className={`${ui.card} ${s.card}`}>
          <span className={s.cardLabel}>{t('sensors.cards.window')}</span>
          <strong className={s.cardValue}>{rangeSpanLabel(range, window, lang)}</strong>
          <span className={s.cardSub}>{t('sensors.cards.windowSub', { slot: slotName(bucketMinutes, t) })}</span>
        </div>
      </div>
    </section>
  );
};
