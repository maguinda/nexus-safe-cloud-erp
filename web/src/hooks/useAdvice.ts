import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '../i18n/core';
import type { Api } from '../lib/api';
import type { Advice } from '../lib/types';
import { useAlive } from './useAlive';

export type AdviceState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; advice: Advice };

/** Las recomendaciones: las de reglas se piden solas (son gratis y rápidas); la redacción con IA solo cuando la persona la pide. */
export function useAdvice(api: Api, lang: Lang): { state: AdviceState; asking: boolean; ask: (ai: boolean) => void } {
  const alive = useAlive();
  const [state, setState] = useState<AdviceState>({ status: 'loading' });
  const [asking, setAsking] = useState(false);
  const ask = useCallback((ai: boolean) => {
    setAsking(true);
    api.advisorBrief(lang, ai).then(
      (advice) => { if (alive.current) setState({ status: 'ready', advice }); },
      () => { if (alive.current) setState((s) => (s.status === 'ready' ? s : { status: 'error' })); },
    ).finally(() => { if (alive.current) setAsking(false); });
  }, [api, lang, alive]);
  useEffect(() => { setState({ status: 'loading' }); ask(false); }, [ask]);
  return { state, asking, ask };
}
