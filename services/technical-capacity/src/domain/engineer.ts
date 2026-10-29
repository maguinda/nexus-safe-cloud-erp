import { randomUUID } from 'crypto';
import { ValidationError } from './errors';

export interface Engineer { id: string; name: string; role: string; skills: string[]; certifications: string[] }

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

export function newEngineer(name: unknown, role: unknown, skills: unknown, certifications: unknown): Engineer {
  return { id: randomUUID(), name: text(name, 'name', 2, 80), role: text(role, 'role', 2, 60), skills: tags(skills, 'skills', 40), certifications: tags(certifications, 'certifications', 60) };
}
