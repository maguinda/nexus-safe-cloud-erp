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
/** Costo por día hábil: sueldo mensual ÷ 22, redondeado al peso (mitad hacia arriba). null si no hay sueldo. */
export function dailyCostFromSalary(salary: number | null): number | null {
  return salary === null ? null : Math.floor((salary * 2 + WORKING_DAYS_PER_MONTH) / (WORKING_DAYS_PER_MONTH * 2));
}

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
  return { id: randomUUID(), name: text(name, 'name', 2, 80), role, position: p, kind: POSITIONS[p].kind, skills: tags(skills, 'skills', 40), certifications: tags(certifications, 'certifications', 60), monthlySalaryCop: s, dailyCostCop: dailyCostFromSalary(s) };
}
