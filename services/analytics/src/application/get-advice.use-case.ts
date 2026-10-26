import { actionable, adviceByRules, buildEvidence, buildPrompt, evidenceLabel, Lang, parseAiAdvice, Recommendation } from '../domain/advisor';
import { AdviceWriter } from '../domain/ports';
import { GetNetworkUseCase } from './get-network.use-case';
import { GetTrendsUseCase } from './explore.use-cases';

export interface AdviceResponse {
  /** «ai» = redactada por el modelo y validada contra los hechos; «rules» = plantillas sobre los mismos hechos. */
  source: 'ai' | 'rules';
  language: Lang;
  generatedAt: string;
  /** Hay llave configurada (si no, el botón de IA no sirve). */
  aiAvailable: boolean;
  /** Si se pidió IA y no se usó: por qué. */
  fallbackReason: 'unavailable' | 'error' | 'invalid' | 'limit' | null;
  evidence: { id: string; source: string; severity: string; code: string; label: string }[];
  items: Recommendation[];
}

const TIMEOUT_MS = 25_000;
/** Tope de llamadas a la IA por minuto (de todo el servicio): cada una cuesta, y un clic repetido no debe vaciar la cuenta. */
const AI_PER_MINUTE = 6;

export class GetAdviceUseCase {
  constructor(
    private readonly trends: GetTrendsUseCase,
    private readonly network: GetNetworkUseCase,
    private readonly writer: AdviceWriter | null,
    private readonly clock: () => Date = () => new Date(),
    private readonly timeoutMs: number = TIMEOUT_MS,
    private readonly aiPerMinute: number = AI_PER_MINUTE,
  ) {}

  private readonly aiCalls: number[] = [];

  /** true si todavía hay cupo (y lo gasta). Ventana deslizante de un minuto. */
  private takeAiSlot(now: number): boolean {
    while (this.aiCalls.length && now - this.aiCalls[0] >= 60_000) this.aiCalls.shift();
    if (this.aiCalls.length >= this.aiPerMinute) return false;
    this.aiCalls.push(now);
    return true;
  }

  async execute(lang: Lang, useAi: boolean): Promise<AdviceResponse> {
    const [t, n] = await Promise.all([this.trends.execute(), this.network.execute()]);
    const evidence = buildEvidence(t.insights, n.insights);
    const base = { language: lang, generatedAt: this.clock().toISOString(), aiAvailable: this.writer !== null, evidence: actionable(evidence).map((e) => ({ id: e.id, source: e.source, severity: e.severity, code: e.code, label: evidenceLabel(e, lang) })) };
    const rules = (fallbackReason: AdviceResponse['fallbackReason']): AdviceResponse => ({ ...base, source: 'rules', fallbackReason, items: adviceByRules(evidence, lang) });
    if (!useAi) return rules(null);
    if (!this.writer) return rules('unavailable');
    if (base.evidence.length === 0) return rules(null); // nada que decidir: no se gasta una llamada
    if (!this.takeAiSlot(this.clock().getTime())) return rules('limit');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const raw = await this.writer.write(buildPrompt(evidence, lang), ctrl.signal);
      const items = parseAiAdvice(raw, evidence);
      return items ? { ...base, source: 'ai', fallbackReason: null, items } : rules('invalid');
    } catch {
      return rules('error');
    } finally {
      clearTimeout(timer);
    }
  }
}
