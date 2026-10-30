import { Severity, severityOf } from './telemetry';

const RANK: Record<Severity, number> = { normal: 0, warning: 1, alert: 2 };

/** Cómo está un dispositivo según la última lectura que ya se contó (`stateAt`); sin lecturas contadas, `stateAt` es null. */
export interface DeviceAlertState { id: string; state: Severity; stateAt: Date | null }
/** Una lectura que ENTRÓ de verdad en este lote (las repetidas no cuentan). */
export interface InsertedReading { deviceId: string; recordedAt: Date; status: string; value: number; unit: string }
export interface Transition {
  deviceId: string;
  /** El estado en que queda el dispositivo: el de su lectura MÁS RECIENTE del lote. */
  newState: Severity;
  newStateAt: Date;
  /** Solo si el dispositivo EMPEORÓ: la lectura más grave del lote (a igual gravedad, la más reciente). */
  breach?: InsertedReading;
}

/**
 * Decide, por dispositivo, si un lote lo hace EMPEORAR (normal→warning, normal→alert, warning→alert) y en qué estado queda.
 * - Mira solo las lecturas MÁS NUEVAS que la última ya contada: un lote viejo que llega tarde no reescribe el estado ni dispara nada.
 * - Una vez por dispositivo y lote, no por lectura: un sensor que manda 50 lecturas de alerta seguidas avisa una vez.
 * - Mejorar (alert→normal) baja el estado SIN avisar; así la próxima vez que empeore vuelve a avisar (no queda «atascado» en alert).
 * - Compara contra el estado guardado, no contra «la lectura anterior de este lote».
 * `now`: un reloj de sensor adelantado (se tolera hasta 5 min) no puede dejar el «último contado» en el futuro, porque las lecturas reales de los
 * minutos siguientes no contarían y no avisarían; por eso el instante del estado nunca pasa de `now`.
 * Debe llamarse con el estado leído DENTRO del bloqueo de cada dispositivo. Salida ordenada por id (el mismo orden en que se bloquea).
 */
export function decideTransitions(devices: readonly DeviceAlertState[], inserted: readonly InsertedReading[], now?: Date): Transition[] {
  const out: Transition[] = [];
  for (const d of [...devices].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const fresh = inserted.filter((r) => r.deviceId === d.id && (d.stateAt === null || r.recordedAt.getTime() > d.stateAt.getTime()));
    if (fresh.length === 0) continue;
    const newest = fresh.reduce((a, b) => (b.recordedAt.getTime() > a.recordedAt.getTime() ? b : a));
    const worst = fresh.reduce((a, b) => {
      const ra = RANK[severityOf(a.status)], rb = RANK[severityOf(b.status)];
      return rb > ra || (rb === ra && b.recordedAt.getTime() > a.recordedAt.getTime()) ? b : a;
    });
    const t: Transition = { deviceId: d.id, newState: severityOf(newest.status), newStateAt: now && newest.recordedAt.getTime() > now.getTime() ? now : newest.recordedAt };
    if (RANK[severityOf(worst.status)] > RANK[d.state]) t.breach = worst;
    out.push(t);
  }
  return out;
}
