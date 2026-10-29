#!/usr/bin/env node
// Simulador de telemetría: reproduce las lecturas del Excel de la docente (PROYECTO_NEXUS) como si los sensores siguieran enviando, por la API de
// ingesta (POST /telemetry/readings, con la clave de servicio). «Tiempo virtual»: el ciclo 1 continúa justo después de la última lectura del Excel
// (13-sep 11:21 UTC) y cada ciclo siguiente va 200 minutos más adelante; los valores se repiten tal cual (también las alertas de las 09:40).
//
//   node scripts/simulate-telemetry.mjs                  # un ciclo (200 lotes de 21 lecturas), un lote cada 5 s: ≈ 17 minutos
//   node scripts/simulate-telemetry.mjs --cycles 0       # sin fin (Ctrl+C para parar)
//   node scripts/simulate-telemetry.mjs --interval 1000 --max-batches 12
//   node scripts/simulate-telemetry.mjs --dry-run        # solo muestra el plan, sin red ni clave
// La clave sale de INGEST_KEY (variable de entorno o el .env de la raíz). Es seguro repetirlo o reiniciarlo: la API es idempotente (lo ya enviado
// cuenta como duplicado). Para seguir donde quedó: --start-cycle C --start-index I (se imprimen al terminar). `./scripts/reset-demo.sh` borra lo ingerido.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MINUTE, batchFor, buildSlots, nextCursor, parseArgs } from './lib/telemetry-slots.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmm = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`✖ ${e.message}\n  Uso: node scripts/simulate-telemetry.mjs [--interval ms] [--cycles N] [--start-cycle K] [--start-index I] [--max-batches N] [--url URL] [--dry-run]`); process.exit(2); }

function ingestKey() {
  if (process.env.INGEST_KEY) return process.env.INGEST_KEY;
  const env = `${root}.env`;
  if (existsSync(env)) { const m = /^INGEST_KEY=(.*)$/m.exec(readFileSync(env, 'utf8')); if (m && m[1].trim()) return m[1].trim(); }
  return '';
}
const key = ingestKey();
if (!opts.dryRun && key.length < 32) { console.error('✖ Falta la clave de servicio (INGEST_KEY, mínimo 32 caracteres).\n  Genérala con: openssl rand -hex 24, ponla en .env (INGEST_KEY=...) y reinicia Operations: docker compose up -d operations'); process.exit(2); }

const slots = buildSlots(JSON.parse(readFileSync(`${root}services/operations/prisma/data/iot-readings.json`, 'utf8')));
if (opts.startIndex >= slots.length) { console.error(`✖ --start-index debe ser menor que ${slots.length}`); process.exit(2); }

async function send(body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try { res = await fetch(`${opts.url}/telemetry/readings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-key': key }, body: JSON.stringify(body) }); }
    catch (e) { if (attempt >= 4) throw new Error(`no pude conectar con ${opts.url}: ${e.cause?.code ?? e.message}`); await sleep(1000 * attempt); continue; }
    if (res.status === 429 && attempt < 6) { await sleep(2000 * attempt); continue; } // el gateway limita las ráfagas: se espera y se reintenta
    let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, json };
  }
}

let stop = false;
process.on('SIGINT', () => { stop = true; });
const total = { batches: 0, accepted: 0, duplicates: 0 };
let cursor = { cycle: opts.startCycle, index: opts.startIndex };
const lastCycle = opts.cycles === 0 ? Infinity : opts.startCycle + opts.cycles - 1;
const first = batchFor(slots, cursor.cycle, cursor.index);
console.log(`${opts.dryRun ? '(simulación en seco: no se envía nada) ' : ''}Reproduciendo el Excel como si siguiera en vivo → ${opts.url}\n  desde ${hhmm(first.at)} (ciclo ${cursor.cycle}, lote ${cursor.index + 1}/${slots.length}), un lote de ${first.body.readings.length} lecturas cada ${opts.interval} ms${opts.cycles === 0 ? ', sin fin' : `, ${opts.cycles} ciclo(s)`}. Ctrl+C para parar.`);

let exitCode = 0;
while (!stop && cursor.cycle <= lastCycle && (opts.maxBatches === 0 || total.batches < opts.maxBatches)) {
  const { at, body } = batchFor(slots, cursor.cycle, cursor.index);
  if (at > Date.now() + 4 * MINUTE) { console.log(`■ El tiempo virtual (${hhmm(at)}) llegó al presente: la API no acepta lecturas del futuro. Se detiene.`); break; }
  const label = `ciclo ${cursor.cycle} · lote ${String(cursor.index + 1).padStart(3)}/${slots.length} · ${hhmm(at)}`;
  if (opts.dryRun) console.log(`  ${label} → ${body.readings.length} lecturas (simulado)`);
  else {
    let r;
    try { r = await send(body); } catch (e) { console.error(`✖ ${label}: ${e.message}`); exitCode = 1; break; }
    if (r.status !== 200) {
      const why = r.status === 401 ? 'la clave no es la que tiene el servidor' : r.status === 503 ? 'el servidor no tiene INGEST_KEY configurada (o es corta)' : r.status === 400 ? (r.json?.message ?? 'lote inválido') : r.status === 429 ? 'el gateway sigue limitando (demasiadas peticiones)' : 'error del servidor';
      console.error(`✖ ${label}: ${r.status} ${why}`); exitCode = 1; break;
    }
    total.accepted += r.json.accepted; total.duplicates += r.json.duplicates;
    console.log(`  ${label} → ${r.json.accepted} nuevas, ${r.json.duplicates} ya existían`);
  }
  total.batches++;
  cursor = nextCursor(slots, cursor);
  const more = !stop && cursor.cycle <= lastCycle && (opts.maxBatches === 0 || total.batches < opts.maxBatches);
  if (more && opts.interval > 0) await sleep(opts.interval);
}
console.log(`\nListo: ${total.batches} lote(s)${opts.dryRun ? ' simulados' : `, ${total.accepted} lecturas nuevas, ${total.duplicates} repetidas`}. Para seguir donde quedó: --start-cycle ${cursor.cycle} --start-index ${cursor.index}`);
process.exit(exitCode);
