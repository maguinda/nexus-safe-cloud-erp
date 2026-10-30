import { InvalidEventError } from './errors';
import { Fact } from './fact';

export const ENGINEER_ALLOCATED_ROUTING_KEY = 'capacity.engineer.allocated';
export const ALLOCATION_REMOVED_ROUTING_KEY = 'capacity.allocation.removed';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[^<>\u0000-\u001f]{1,120}$/u;
const MAX_DAILY_COST = 50_000_000;

/** Una asignación tal como la anunció Technical Capacity: solo lo necesario para costear el proyecto. */
export interface AllocationFact { allocationId: string; projectName: string; engineerName: string; percent: number; periodStart: string; periodEnd: string; dailyCostCop: number | null; occurredAt: Date }

const day = (v: unknown, f: string): string => {
  if (typeof v !== 'string' || !DAY.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new InvalidEventError(`${f} must be a real date`);
  return v;
};
const text = (v: unknown, f: string): string => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!NAME.test(t)) throw new InvalidEventError(`${f} must be 1 to 120 characters without < > or control characters`);
  return t;
};
function envelope(raw: unknown, type: string): { e: Record<string, any>; d: Record<string, any> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('event must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== type) throw new InvalidEventError('unexpected type');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  if (typeof d.allocationId !== 'string' || !UUID.test(d.allocationId)) throw new InvalidEventError('allocationId must be a UUID');
  return { e, d };
}

export function parseEngineerAllocated(raw: unknown): AllocationFact {
  const { e, d } = envelope(raw, 'EngineerAllocated');
  if (typeof d.percent !== 'number' || !Number.isInteger(d.percent) || d.percent < 1 || d.percent > 100) throw new InvalidEventError('percent must be a whole number from 1 to 100');
  const periodStart = day(d.periodStart, 'periodStart'), periodEnd = day(d.periodEnd, 'periodEnd');
  if (periodEnd < periodStart) throw new InvalidEventError('periodEnd cannot be before periodStart');
  // Un evento anterior a la rentabilidad no trae costo: se toma como «sin costo» (no se inventa un número).
  const c = d.dailyCostCop;
  if (c !== undefined && c !== null && (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > MAX_DAILY_COST)) throw new InvalidEventError('dailyCostCop must be a whole number of pesos or null');
  return { allocationId: d.allocationId.toLowerCase(), projectName: text(d.projectName, 'projectName'), engineerName: text(d.engineerName, 'engineerName'), percent: d.percent, periodStart, periodEnd, dailyCostCop: c ?? null, occurredAt: new Date(e.occurredAt) };
}
export function parseAllocationRemoved(raw: unknown): { allocationId: string } {
  const { d } = envelope(raw, 'AllocationRemoved');
  return { allocationId: d.allocationId.toLowerCase() };
}

/** Días de lunes a viernes entre dos fechas (YYYY-MM-DD), ambas incluidas; 0 si `to` es antes que `from`. Se trabaja en UTC con días enteros. */
export function workingDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (b < a) return 0;
  const total = Math.round((b - a) / 86_400_000) + 1;
  const full = Math.floor(total / 7); let n = full * 5;
  const startDow = new Date(a).getUTCDay(); // 0 domingo
  for (let i = 0; i < total % 7; i++) { const dow = (startDow + i) % 7; if (dow !== 0 && dow !== 6) n++; }
  return n;
}

export interface ProfitabilityRow {
  projectName: string;
  /** Facturas emitidas del proyecto, SIN IVA. */
  revenueCop: number;
  /** Porcentaje × días hábiles transcurridos × costo diario, de cada asignación con costo. */
  laborCostCop: number;
  marginCop: number;
  /** Margen sobre ingresos, en % con un decimal; null si no hay ingresos. */
  marginPct: number | null;
  allocations: number;
  /** Asignaciones sin costo diario: su costo NO está en el total (el margen se ve mejor de lo que es). */
  uncostedAllocations: number;
}
export interface Profitability { asOf: string; projects: ProfitabilityRow[]; totals: { revenueCop: number; laborCostCop: number; marginCop: number; uncostedAllocations: number } }

/**
 * Rentabilidad por proyecto: ingresos (facturas emitidas sin IVA) menos costo laboral (porcentaje × días hábiles transcurridos × costo diario del ingeniero
 * al asignar). Solo cuenta los días ya transcurridos hasta hoy; el costo de lo que viene todavía no existe. El enlace con el proyecto es por nombre.
 */
export function buildProfitability(facts: Fact[], allocations: AllocationFact[], now: Date): Profitability {
  const today = now.toISOString().slice(0, 10);
  const rows = new Map<string, { revenue: number; cost: number; allocs: number; uncosted: number }>();
  const row = (n: string) => { let r = rows.get(n); if (!r) { r = { revenue: 0, cost: 0, allocs: 0, uncosted: 0 }; rows.set(n, r); } return r; };
  for (const f of facts) if (f.invoiceStatus === 'issued') row(f.projectName).revenue += f.amountCop;
  for (const a of allocations) {
    const r = row(a.projectName); r.allocs++;
    if (a.dailyCostCop === null) { r.uncosted++; continue; }
    const days = workingDays(a.periodStart, a.periodEnd < today ? a.periodEnd : today);
    r.cost += (a.percent / 100) * days * a.dailyCostCop;
  }
  const projects: ProfitabilityRow[] = [...rows.entries()].map(([projectName, r]) => {
    const laborCostCop = Math.round(r.cost), marginCop = r.revenue - laborCostCop;
    return { projectName, revenueCop: r.revenue, laborCostCop, marginCop, marginPct: r.revenue > 0 ? Math.round((marginCop / r.revenue) * 1000) / 10 : null, allocations: r.allocs, uncostedAllocations: r.uncosted };
  }).sort((a, b) => b.revenueCop - a.revenueCop || a.projectName.localeCompare(b.projectName));
  const sum = (k: 'revenueCop' | 'laborCostCop' | 'uncostedAllocations') => projects.reduce((s, p) => s + p[k], 0);
  return { asOf: now.toISOString(), projects, totals: { revenueCop: sum('revenueCop'), laborCostCop: sum('laborCostCop'), marginCop: sum('revenueCop') - sum('laborCostCop'), uncostedAllocations: sum('uncostedAllocations') } };
}
