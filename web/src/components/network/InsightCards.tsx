import type { MsgKey, TFn } from '../../i18n';
import { actionLabelKey, insightKey, isKnownInsight } from '../../lib/netview';
import type { Insight } from '../../lib/types';
import s from './network.module.css';

const BOX = { high: s.findingHigh, medium: s.findingMedium, info: s.findingInfo } as const;
const SEV = { high: s.sevHigh, medium: s.sevMedium, info: s.sevInfo } as const;
/** La gravedad se dice con icono Y texto, nunca solo con el color del borde. */
const ICON = { high: '✕', medium: '!', info: 'i' } as const;

/** Una tarjeta por hallazgo: qué pasa (frase armada en el idioma de la persona), cómo se detectó y un botón que lleva a los equipos que lo muestran. */
export function InsightCards({ insights, t, onAction }: { insights: Insight[]; t: TFn; onAction: (insight: Insight) => void }) {
  const known = insights.filter((i) => isKnownInsight(i.code)); // un código que esta versión no conoce no se inventa: no se muestra
  if (known.length === 0) return null;
  return (
    <section className={s.section} aria-labelledby="net-findings-h">
      <div>
        <h3 id="net-findings-h" className={s.sectionTitle}>{t('netview.findings.title')}</h3>
        <p className={s.sub}>{t('netview.findings.sub')}</p>
      </div>
      <ul className={s.findings}>
        {known.map((i) => {
          const label = actionLabelKey(i.code);
          return (
            <li key={`${i.code}`} className={BOX[i.severity]}>
              <span className={SEV[i.severity]}><span aria-hidden>{ICON[i.severity]}</span>{t(`netview.severity.${i.severity}` as MsgKey)}</span>
              <p className={s.findingText}>{t(insightKey(i.code, 'text') as MsgKey, i.params)}</p>
              <p className={s.rule}>{t('netview.findings.rule', { rule: t(insightKey(i.code, 'rule') as MsgKey, i.params) })}</p>
              {label && <button type="button" className={s.action} onClick={() => onAction(i)}>{t(label)}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
