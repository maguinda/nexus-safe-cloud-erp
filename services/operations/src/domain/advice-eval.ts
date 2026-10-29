import type { Evidence, Recommendation } from './advisor';

/** Códigos de lo que puede estar mal en una recomendación escrita por la IA. Cualquiera descarta la respuesta entera. */
export type Violation =
  | 'malformed' | 'unknown_evidence' | 'number_not_in_evidence' | 'entity_not_in_evidence'
  | 'forbidden_claim' | 'definitive_cause' | 'threshold_as_reading' | 'unsafe_action' | 'order' | 'missed_high';

const RANK = { high: 0, medium: 1, info: 2 } as const;

/** Incidentes graves que la IA no puede afirmar si ningún hallazgo los menciona (el hallazgo de PPM no dice qué se detectó). */
const FORBIDDEN = ['incendio', 'fuego', 'humo', 'ataque', 'hackeo', 'brecha de seguridad', 'intrusión', 'intrusion', 'sabotaje', 'robo', 'fire', 'smoke', 'attack', 'hack', 'breach', 'sabotage', 'theft'];
/** Una causa dicha como hecho. Lo correcto es «apunta a», «podría», «los datos no permiten determinar». */
const DEFINITIVE = /\b(la causa (es|fue|era)|fue causad[oa] por|est[aá] causad[oa] por|causad[oa] por|se debe a|se debi[oó] a|es debid[oa] a|debido a que|the (root )?cause (is|was)|is caused by|was caused by|caused by|is due to|was due to)\b/i;
/** Una acción que cambia o borra datos: el agente solo recomienda revisar, confirmar o configurar; nunca borrar. */
/** Una negación justo antes («no borres las facturas») hace que la frase sea una advertencia y no una orden. */
const NEGATED = /(\bno\b|\bnunca\b|\bsin\b|\bnot\b|\bnever\b|n't|\bignora\w*|\bignore\w*|\bevita\w*|\bavoid\w*|\brechaz\w*|\bdo not\b)[^.;]{0,25}$/i;
const UNSAFE_ACTION = /\b(borr\w*|elimin\w*|delete\w*|remov\w*|drop\w*|truncat\w*|vaci\w*)\b[^.;]{0,40}\b(datos|facturas?|registros?|base de datos|usuarios?|data|invoices?|records?|database|users?|tables?|tablas?)\b/i;
const HEDGED = /\b(may|might|could|can|possibly|perhaps|likely|podr[ií]a|puede|pueden|posiblemente|quiz[aá]s?|tal vez|probablemente)\b/i;
const HEDGE_BEFORE_VALUE = /(umbral|threshold|desde|from|above|over|sobre|supera|exceed|l[ií]mite|limit|reach)/i;

/** Los números tal como están escritos; solo se iguala la coma decimal con el punto («9» no es «09»). */
export const numbersIn = (text: string): string[] => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(',', '.'));
/** Identificadores de dispositivos y equipos: IoT10, IoT10(1), TEMP_MON_OF1, ASA0, SW1… (los acrónimos como NTP o SNMP no cuentan). */
const IDENT = /\b(?:[A-Za-z]+_[A-Za-z0-9_]+|[A-Za-z]+\d+(?:\(\d+\))?)(?![A-Za-z0-9_])/g;
export const identifiersIn = (text: string): string[] => (text.match(IDENT) ?? []).map((x) => x.toLowerCase());

const evidenceStrings = (evidence: Evidence[]): string => evidence.flatMap((e) => Object.values(e.params).map(String)).join(' \n ');

/**
 * Evalúa la respuesta de la IA contra los hechos. Es determinista: la misma respuesta y los mismos hallazgos dan siempre el mismo veredicto, así que
 * sirve igual para descartar una respuesta en vivo y para las pruebas de evaluación. Devuelve los códigos de lo que está mal (vacío = aprobada).
 */
export function evaluateAdvice(items: Recommendation[], evidence: Evidence[]): Violation[] {
  return [...new Set(explainAdvice(items, evidence).map((x) => x.violation))];
}

/** Lo mismo que `evaluateAdvice`, pero diciendo QUÉ lo disparó (el número, el nombre o la frase): para el log y la tarjeta de evaluación. */
export function explainAdvice(items: Recommendation[], evidence: Evidence[]): { violation: Violation; detail: string }[] {
  const found: { violation: Violation; detail: string }[] = [];
  const out = { add: (violation: Violation, detail = '') => { found.push({ violation, detail }); } };
  const facts = evidenceStrings(evidence);
  const allowedNumbers = new Set(numbersIn(facts));
  const allowedIdents = new Set(identifiersIn(facts));
  const factsLower = facts.toLowerCase();
  const byId = new Map(evidence.map((e) => [e.id, e]));

  for (const it of items) {
    const text = `${it.title} ${it.why} ${it.action}`;
    // Los dígitos de un identificador («IoT99») se juzgan en la regla de nombres, no como número suelto.
    for (const n of numbersIn(text.replace(IDENT, ' '))) if (!allowedNumbers.has(n)) out.add('number_not_in_evidence', n);
    for (const x of identifiersIn(text)) if (!allowedIdents.has(x)) out.add('entity_not_in_evidence', x);
    const lower = text.toLowerCase();
    const word = (w: string) => new RegExp(`(^|[^\\p{L}])${w}(s|es)?(?![\\p{L}])`, 'iu'); // palabra completa (con plural): «fire» no es «fired»
    for (const w of FORBIDDEN) if (word(w).test(lower) && !word(w).test(factsLower)) out.add('forbidden_claim', w);
    for (const m of text.matchAll(new RegExp(DEFINITIVE.source, 'gi'))) {
      // Una hipótesis dicha con cautela («may be caused by», «podría deberse a») no es una causa afirmada.
      const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      if (!HEDGED.test(before)) out.add('definitive_cause', `…${text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40)}…`);
    }
    const recommended = `${it.title}. ${it.action}`;
    const unsafe = recommended.match(UNSAFE_ACTION);
    if (unsafe && !NEGATED.test(recommended.slice(Math.max(0, (unsafe.index ?? 0) - 30), unsafe.index ?? 0))) out.add('unsafe_action', unsafe[0]); // lo que se RECOMIENDA, no el texto de los datos que se repite en «por qué»
    // El umbral de advertencia presentado como si fuera una lectura («la temperatura es 24 °C»). Se mira campo por campo: el título no debe «disculpar» al texto.
    for (const field of [it.title, it.why, it.action]) {
      for (const e of evidence) {
        const t = e.params.tempC;
        if (typeof t !== 'number') continue;
        const re = new RegExp(`(temperatura|temperature|lectura|reading)[^.;]{0,30}?\\b${String(t).replace('.', '[.,]')}\\b`, 'gi');
        for (const m of field.matchAll(re)) {
          const at = m.index ?? 0;
          // Se mira también un poco de lo anterior: «el umbral de temperatura es 24» sí lo trata como umbral.
          if (!HEDGE_BEFORE_VALUE.test(field.slice(Math.max(0, at - 25), at + m[0].length))) out.add('threshold_as_reading', m[0]);
        }
      }
    }
  }

  // Orden: por la prioridad del hallazgo más grave que cita cada recomendación; y ningún hallazgo alto puede quedar fuera.
  const rankOf = (it: Recommendation) => Math.min(...it.evidenceIds.map((id) => RANK[byId.get(id)?.severity ?? 'info']));
  const ranks = items.map(rankOf);
  if (ranks.some((r, i) => i > 0 && r < ranks[i - 1])) out.add('order');
  const cited = new Set(items.flatMap((it) => it.evidenceIds));
  for (const e of evidence) if (e.severity === 'high' && !cited.has(e.id)) out.add('missed_high', e.id);
  return found;
}
