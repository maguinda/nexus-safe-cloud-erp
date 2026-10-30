import { randomUUID } from 'crypto';
import { ValidationError } from './errors';

export type StaffKind = 'engineer' | 'technician';
/** Catálogo fijo de cargos del personal técnico y su tipo. */
export const POSITIONS = {
  software_engineer: { kind: 'engineer', label: 'Software engineer' },
  cloud_devops_engineer: { kind: 'engineer', label: 'Cloud / DevOps engineer' },
  security_engineer: { kind: 'engineer', label: 'Cybersecurity engineer' },
  network_engineer: { kind: 'engineer', label: 'Network engineer' },
  tech_lead: { kind: 'engineer', label: 'Tech lead / architect' },
  field_technician: { kind: 'technician', label: 'Field / installation technician' },
  support_technician: { kind: 'technician', label: 'Support / maintenance technician' },
} as const;
export type Position = keyof typeof POSITIONS;

export interface Engineer {
  id: string; name: string; role: string; position: Position; kind: StaffKind; skills: string[]; certifications: string[];
  /** Sueldo mensual de nómina (solo lo ve gerencia). */ monthlySalaryCop: number | null;
  /** Costo por día hábil, derivado del sueldo. */ dailyCostCop: number | null;
}

export function position(v: unknown): Position {
  if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(POSITIONS, v)) throw new ValidationError(`position must be one of: ${Object.keys(POSITIONS).join(', ')}`);
  return v as Position;
}

export const WORKING_DAYS_PER_MONTH = 22;
export const MAX_MONTHLY_SALARY_COP = 200_000_000;
/** Sueldo mensual en pesos enteros de 1 a 200.000.000; vacío o null = todavía sin sueldo. */
export function monthlySalary(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_MONTHLY_SALARY_COP) throw new ValidationError(`monthlySalaryCop must be a whole number of pesos from 1 to ${MAX_MONTHLY_SALARY_COP}`);
  return v;
}

// ---- Costo para la empresa (octubre de 2026). Los MISMOS números y la MISMA aritmética entera que las funciones SQL de la migración 0006: la base lo comprueba (CHECK). ----
/** Salario mínimo y auxilio de transporte de 2026: hay que actualizarlos cada año (aquí y en la función SQL). */
export const SMMLV_COP = 1_750_905;
export const TRANSPORT_AID_COP = 249_095;
/** Por cien mil (100.000 = 100 %): prima, cesantías e intereses 17,66 % sobre sueldo + auxilio; vacaciones 4,17 %; pensión 12 %; caja 4 %. */
const PPM = { PRESTACIONES_ON_AID_BASE: 17_660, VACATIONS: 4_170, PENSION: 12_000, CAJA: 4_000 };
const SCALE = 100_000;
/** ARL por riesgo del cargo: clase I (oficina) 0,522 %, III (soporte en sitio) 2,436 %, V (instalación, alturas) 6,96 %. */
export function arlPpm(pos: Position): number { return pos === 'field_technician' ? 6_960 : pos === 'support_technician' ? 2_436 : 522; }
export const transportAid = (salary: number): number => (salary <= 2 * SMMLV_COP ? TRANSPORT_AID_COP : 0);

export interface EmployerCost {
  salaryCop: number; transportAidCop: number; prestacionesCop: number; pensionCop: number; cajaCop: number; arlCop: number;
  /** Lo que le cuesta a la empresa al mes (suma exacta, redondeada una sola vez). */ monthlyCop: number;
  /** Costo por día hábil: monthlyCop ÷ 22, redondeado al peso (mitad hacia arriba). */ dailyCop: number;
}
/** Desglose del costo mensual del empleador. Cada concepto se redondea para MOSTRARLO; el total y el costo diario salen de la cuenta exacta. */
export function employerCost(salary: number, pos: Position): EmployerCost {
  const aid = transportAid(salary);
  const base = salary + aid;
  const scaled = base * SCALE + base * PPM.PRESTACIONES_ON_AID_BASE + salary * (PPM.VACATIONS + PPM.PENSION + PPM.CAJA + arlPpm(pos));
  const r = (n: number) => Math.floor((2 * n + SCALE) / (2 * SCALE));
  return {
    salaryCop: salary, transportAidCop: aid,
    prestacionesCop: r(base * PPM.PRESTACIONES_ON_AID_BASE + salary * PPM.VACATIONS), pensionCop: r(salary * PPM.PENSION), cajaCop: r(salary * PPM.CAJA), arlCop: r(salary * arlPpm(pos)),
    monthlyCop: r(scaled), dailyCop: Math.floor((2 * scaled + 22 * SCALE) / (44 * SCALE)),
  };
}
/** Costo por día hábil de una persona con ese sueldo y cargo; null si no hay sueldo. */
export const employerDailyCost = (salary: number | null, pos: Position): number | null => (salary === null ? null : employerCost(salary, pos).dailyCop);

function text(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < min || t.length > max) throw new ValidationError(`${field} must be ${min} to ${max} characters`);
  if (/[\u0000-\u001f<>]/.test(t)) throw new ValidationError(`${field} has characters that are not allowed`);
  return t;
}

/** Una lista de etiquetas (habilidades, certificaciones): hasta 20, cada una 2 a `max` caracteres, sin repetidas (sin importar mayúsculas). */
function tags(v: unknown, field: string, max: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 20) throw new ValidationError(`${field} must be a list of up to 20 items`);
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of v) { const t = text(x, field, 2, max); const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

export function newEngineer(name: unknown, roleText: unknown, skills: unknown, certifications: unknown, salary?: unknown, pos?: unknown): Engineer {
  const p = position(pos);
  const s = monthlySalary(salary);
  // Sin título propio, el título es el nombre del cargo.
  const role = roleText === undefined || roleText === null || roleText === '' ? POSITIONS[p].label : text(roleText, 'role', 2, 60);
  return { id: randomUUID(), name: text(name, 'name', 2, 80), role, position: p, kind: POSITIONS[p].kind, skills: tags(skills, 'skills', 40), certifications: tags(certifications, 'certifications', 60), monthlySalaryCop: s, dailyCostCop: employerDailyCost(s, p) };
}
