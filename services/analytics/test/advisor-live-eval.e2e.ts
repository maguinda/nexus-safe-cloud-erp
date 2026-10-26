import { buildEvidence, buildPrompt, checkAiAdvice, PLAYBOOK_VERSION } from '../src/domain/advisor';
import { GOLDEN } from '../src/domain/advisor-golden';
import { AnthropicAdviceWriter } from '../src/infrastructure/anthropic-advice-writer';

/**
 * Evaluación contra la IA REAL (cuesta unas monedas). No corre sola ni en el CI: se pide con
 *   ADVISOR_LIVE_EVAL=1 ANTHROPIC_API_KEY=… npx jest --config jest.e2e.config.js test/advisor-live-eval.e2e.ts
 * (EVAL_RUNS=n repite cada caso n veces). Para cada caso de oro y cada idioma pregunta al modelo con el playbook y aplica el mismo evaluador que se usa en vivo.
 * Imprime una tarjeta de calificaciones y falla si algún caso no pasa: es la señal de que el playbook o el prompt necesitan ajuste.
 */
const live = process.env.ADVISOR_LIVE_EVAL === '1' && !!process.env.ANTHROPIC_API_KEY;
const RUNS = Number(process.env.EVAL_RUNS ?? 1);

(live ? describe : describe.skip)(`advisor: live evaluation against the real model (playbook ${PLAYBOOK_VERSION})`, () => {
  const writer = new AnthropicAdviceWriter(process.env.ANTHROPIC_API_KEY as string, process.env.ADVISOR_MODEL ?? 'claude-sonnet-5-5');
  const rows: string[] = [];
  let failures = 0;

  afterAll(() => { console.log(`\n=== Tarjeta de calificaciones (playbook ${PLAYBOOK_VERSION}, ${RUNS} corrida(s) por caso) ===\n${rows.join('\n')}\nfallos: ${failures}\n`); });

  for (const g of GOLDEN) {
    for (const lang of ['es', 'en'] as const) {
      it(`${lang}: ${g.name}`, async () => {
        const evidence = buildEvidence(g.sensors, g.network);
        let failed = 0;
        for (let run = 1; run <= RUNS; run++) { // se corren todas y se juzga al final: así la tarjeta muestra todo, no solo el primer fallo
          const raw = await writer.write(buildPrompt(evidence, lang), AbortSignal.timeout(80_000));
          const { items, violations, detail } = checkAiAdvice(raw, evidence);
          const ok = items !== null;
          if (!ok) { failed++; failures++; }
          rows.push(`${ok ? 'PASA ' : 'FALLA'} | ${lang} | corrida ${run} | ${g.name.slice(0, 55)}${ok ? ` | ${items!.length} recomendaciones` : ` | ${violations.join(', ')}${detail ? ` (${detail})` : ''}`}`);
        }
        expect(failed).toBe(0); // g.expect describe lo que se espera de este caso
      }, 90_000 * RUNS);
    }
  }
});
