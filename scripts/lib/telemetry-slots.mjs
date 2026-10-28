// Lógica pura del simulador de telemetría (sin red ni archivos): se prueba con `node --test scripts/lib/telemetry-slots.test.mjs`.
export const MINUTE = 60_000;

/** Agrupa las lecturas del Excel por instante (un «tramo» = un minuto con todos los dispositivos), en orden cronológico. */
export function buildSlots(readings) {
  const sorted = [...readings].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.deviceId.localeCompare(b.deviceId));
  const slots = [];
  for (const r of sorted) {
    const at = Date.parse(r.recordedAt);
    if (Number.isNaN(at)) throw new Error(`fecha inválida en la lectura ${r.id ?? '?'}: ${r.recordedAt}`);
    const last = slots[slots.length - 1];
    if (last && last.at === at) last.readings.push(r); else slots.push({ at, readings: [r] });
  }
  if (slots.length === 0) throw new Error('no hay lecturas que reproducir');
  return slots;
}

/**
 * Lo que dura un ciclo: la ventana original más UN minuto, para que el ciclo siguiente continúe justo después del último tramo, sin hueco ni
 * solapamiento (los datos traen una lectura por minuto por dispositivo).
 */
export function cycleLength(slots) {
  return slots[slots.length - 1].at - slots[0].at + MINUTE;
}

/** El lote de un tramo en un ciclo (el ciclo 0 son las lecturas originales, que ya están cargadas). Tiempo virtual: solo se desplaza la fecha. */
export function batchFor(slots, cycle, index) {
  const slot = slots[index];
  const shift = cycle * cycleLength(slots);
  return {
    at: slot.at + shift,
    body: { readings: slot.readings.map((r) => ({ deviceId: r.deviceId, recordedAt: new Date(Date.parse(r.recordedAt) + shift).toISOString(), status: r.status, value: r.value, unit: r.unit, note: r.note ?? null })) },
  };
}

/** Siguiente posición: al terminar los tramos de un ciclo sigue el primero del ciclo siguiente. */
export function nextCursor(slots, { cycle, index }) {
  return index + 1 < slots.length ? { cycle, index: index + 1 } : { cycle: cycle + 1, index: 0 };
}

/** Argumentos: --interval ms (5000), --cycles N (1; 0 = sin fin), --start-cycle K (1), --start-index I (0), --max-batches N (0 = sin tope), --url, --dry-run. */
export function parseArgs(argv) {
  const o = { interval: 5000, cycles: 1, startCycle: 1, startIndex: 0, maxBatches: 0, url: 'http://localhost:8080', dryRun: false };
  const num = (name, v, min) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw new Error(`${name} debe ser un entero ≥ ${min} (recibí «${v}»)`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const val = () => { if (i + 1 >= argv.length) throw new Error(`falta el valor de ${a}`); return argv[++i]; };
    if (a === '--interval') o.interval = num('--interval', val(), 0);
    else if (a === '--cycles') o.cycles = num('--cycles', val(), 0);
    else if (a === '--start-cycle') o.startCycle = num('--start-cycle', val(), 1);
    else if (a === '--start-index') o.startIndex = num('--start-index', val(), 0);
    else if (a === '--max-batches') o.maxBatches = num('--max-batches', val(), 0);
    else if (a === '--url') o.url = val().replace(/\/+$/, '');
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  return o;
}
