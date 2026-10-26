import { useAdvice } from '../../hooks/useAdvice';
import { useSession } from '../../session';
import type { Advice, AdviceItem } from '../../lib/types';
import ui from '../../styles/ui.module.css';
import s from './advisor.module.css';

type Target = AdviceItem['target'];

/** La nota de por qué no se usó la IA (si se pidió). */
const FALLBACK = { unavailable: 'advisor.fallback.unavailable', error: 'advisor.fallback.error', limit: 'advisor.fallback.limit', invalid: 'advisor.fallback.invalid' } as const;

/**
 * «Qué hacer primero»: los hallazgos de Sensores y Red ordenados por urgencia, cada uno con qué hacer y la evidencia que lo respalda.
 * Por defecto sale de reglas; con «Redactar con IA» lo redacta el modelo y el servidor lo revisa contra los datos (si no cuadra, se muestran las reglas).
 */
export function AdvisorPanel({ onOpen }: { onOpen: (target: Target) => void }) {
  const { api, lang, t } = useSession();
  const { state, asking, ask } = useAdvice(api, lang);

  return (
    <section className={s.panel} aria-labelledby="advisor-h">
      <div className={s.head}>
        <div>
          <h2 id="advisor-h" className={s.title}>{t('advisor.title')}</h2>
          <p className={s.sub}>{t('advisor.subtitle')}</p>
        </div>
        {state.status === 'ready' && (
          <button type="button" className={s.aiBtn} disabled={asking || !state.advice.aiAvailable} onClick={() => ask(true)} aria-describedby="advisor-ai-hint">
            {asking ? t('advisor.ai.asking') : t('advisor.ai.ask')}
          </button>
        )}
      </div>
      {state.status === 'ready' && !state.advice.aiAvailable && <p id="advisor-ai-hint" className={s.hint}>{t('advisor.fallback.unavailable')}</p>}
      <div role="status" aria-live="polite">
        {state.status === 'loading' && <p className={s.hint}>{t('advisor.loading')}</p>}
        {state.status === 'error' && (
          <div className={ui.panelError} role="alert"><strong>{t('advisor.error')}</strong><button type="button" className={ui.btnGhost} onClick={() => ask(false)}>{t('advisor.retry')}</button></div>
        )}
        {state.status === 'ready' && <Result advice={state.advice} onOpen={onOpen} />}
      </div>
    </section>
  );
}

function Result({ advice, onOpen }: { advice: Advice; onOpen: (target: Target) => void }) {
  const { t } = useSession();
  const label = new Map(advice.evidence.map((e) => [e.id, e.label]));
  return (
    <>
      <p className={advice.source === 'ai' ? s.badgeAi : s.badge}>{t(advice.source === 'ai' ? 'advisor.source.ai' : 'advisor.source.rules')}</p>
      {advice.fallbackReason && advice.fallbackReason !== 'unavailable' && <p className={s.warn}>{t(FALLBACK[advice.fallbackReason])}</p>}
      {advice.items.length === 0 ? <p className={s.hint}>{t('advisor.empty')}</p> : (
        <ol className={s.list}>
          {advice.items.map((it, i) => (
            <li key={it.evidenceIds.join('|')} className={s.item}>
              <span className={s.num} aria-hidden>{i + 1}</span>
              <div className={s.body}>
                <h3 className={s.itemTitle}>{it.title}</h3>
                <p className={s.line}><strong>{t('advisor.item.why')}</strong> {it.why}</p>
                <p className={s.line}><strong>{t('advisor.item.action')}</strong> {it.action}</p>
                <p className={s.evidence}><strong>{t('advisor.item.evidence')}</strong> {it.evidenceIds.map((id) => label.get(id) ?? id).join(' · ')}</p>
                <button type="button" className={s.open} onClick={() => onOpen(it.target)}>{t(it.target === 'sensors' ? 'advisor.open.sensors' : 'advisor.open.network')}</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {advice.items.length > 0 && <p className={s.note}>{t('advisor.note')}</p>}
    </>
  );
}
