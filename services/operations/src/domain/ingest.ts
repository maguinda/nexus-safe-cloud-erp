/** Lectura nueva que llega por la API de ingesta (los sensores o el simulador). Las del seed del Excel no pasan por aquí. */
export interface NewReading { deviceId: string; recordedAt: Date; status: string; value: number; unit: string; note: string | null }
export interface IngestProblem { path: string; message: string }

/** Máximo de lecturas por petición: 50 caben en el límite de 10 KB del cuerpo con holgura. */
export const INGEST_MAX_BATCH = 50;
/** Estados que trae la fuente (Packet Tracer): ALERT y WARNING piden atención; el resto describe el estado del dispositivo. */
export const READING_STATUSES = ['ACTIVE', 'ALERT', 'CLEAR', 'DETECTED', 'LOCKED', 'NORMAL', 'OFF', 'ON', 'UNLOCKED', 'WARNING'] as const;
/** Un reloj de sensor puede ir un poco adelantado, pero no horas: una lectura del futuro es un error del emisor. */
export const MAX_FUTURE_MS = 5 * 60_000;
export const NOTE_MAX = 200;
/** Una medida fuera de este rango no es de un sensor real; además el servicio de avisos no acepta valores mayores y el aviso se perdería. */
export const VALUE_LIMIT = 1_000_000_000;
const OLDEST = Date.UTC(2000, 0, 1);

const FIELDS = ['deviceId', 'recordedAt', 'status', 'value', 'unit', 'note'] as const;
// Con zona horaria explícita: una hora sin zona se leería según el servidor y no habría dos lecturas iguales para dos equipos.
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * `new Date('2026-02-31T10:00:00Z')` NO falla: JavaScript lo corre al 3 de marzo y se guardaría otro día sin avisar. Por eso se comprueba el
 * calendario de verdad (días del mes, año bisiesto, hora, minuto, segundo y desfase) antes de convertir.
 */
function isRealDateTime(m: RegExpExecArray): boolean {
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // día 0 del mes siguiente = último día de este mes
  const offsetOk = m[7] === undefined || (Number(m[7]) <= 23 && Number(m[8]) <= 59);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days && h <= 23 && mi <= 59 && se <= 59 && offsetOk;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valida un lote COMPLETO antes de guardar nada («todo o nada»): si una sola lectura es mala, no entra ninguna. Devuelve todos los
 * problemas encontrados (no solo el primero) para que quien envía corrija el lote de una vez.
 * `units` es el catálogo de dispositivos: id → unidad. Una lectura de un dispositivo desconocido, o en otra unidad, se rechaza.
 */
export function validateBatch(body: unknown, units: ReadonlyMap<string, string>, now: Date): { readings: NewReading[]; problems: IngestProblem[] } {
  const problems: IngestProblem[] = [];
  const add = (path: string, message: string) => { problems.push({ path, message }); };
  if (!isRecord(body)) return { readings: [], problems: [{ path: 'body', message: 'must be a JSON object with a "readings" array' }] };
  for (const k of Object.keys(body)) if (k !== 'readings') add(k, 'unknown field');
  const list = body.readings;
  if (!Array.isArray(list)) { add('readings', 'must be an array'); return { readings: [], problems }; }
  if (list.length === 0) add('readings', 'must have at least 1 reading');
  if (list.length > INGEST_MAX_BATCH) { add('readings', `must have at most ${INGEST_MAX_BATCH} readings`); return { readings: [], problems }; }

  const out: NewReading[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const at = (f: string) => `readings[${i}].${f}`;
    if (!isRecord(raw)) { add(`readings[${i}]`, 'must be an object'); return; }
    for (const k of Object.keys(raw)) if (!(FIELDS as readonly string[]).includes(k)) add(at(k), 'unknown field');
    const { deviceId, recordedAt, status, value, unit, note } = raw;
    let ok = true;
    const bad = (f: string, m: string) => { add(at(f), m); ok = false; };

    const deviceUnit = typeof deviceId === 'string' ? units.get(deviceId) : undefined;
    if (typeof deviceId !== 'string') bad('deviceId', 'must be a string');
    else if (deviceUnit === undefined) bad('deviceId', 'unknown device');

    let when: Date | null = null;
    const parts = typeof recordedAt === 'string' ? ISO_WITH_ZONE.exec(recordedAt) : null;
    if (typeof recordedAt !== 'string' || parts === null) bad('recordedAt', 'must be an ISO 8601 date-time with a time zone, e.g. 2026-09-13T11:21:00Z');
    else {
      when = new Date(recordedAt);
      if (!isRealDateTime(parts) || Number.isNaN(when.getTime())) { bad('recordedAt', 'is not a real date'); when = null; }
      else if (when.getTime() > now.getTime() + MAX_FUTURE_MS) { bad('recordedAt', 'is in the future'); when = null; }
      else if (when.getTime() < OLDEST) { bad('recordedAt', 'is before the year 2000'); when = null; }
    }

    if (typeof status !== 'string' || !(READING_STATUSES as readonly string[]).includes(status)) bad('status', `must be one of ${READING_STATUSES.join(', ')}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) bad('value', 'must be a finite number');
    else if (Math.abs(value) > VALUE_LIMIT) bad('value', `must be between -${VALUE_LIMIT} and ${VALUE_LIMIT}`);
    if (typeof unit !== 'string') bad('unit', 'must be a string');
    else if (deviceUnit !== undefined && unit !== deviceUnit) bad('unit', `must be "${deviceUnit}" for this device`);
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) bad('note', `must be a string of at most ${NOTE_MAX} characters`);

    if (ok && when !== null) {
      const key = `${deviceId as string}|${when.getTime()}`;
      if (seen.has(key)) add(at('recordedAt'), 'repeats a device and instant already in this batch');
      else { seen.add(key); out.push({ deviceId: deviceId as string, recordedAt: when, status: status as string, value: value as number, unit: unit as string, note: typeof note === 'string' ? note : null }); }
    }
  });
  return { readings: problems.length === 0 ? out : [], problems };
}
