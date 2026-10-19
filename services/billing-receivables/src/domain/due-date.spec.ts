import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ModuleKind, transpileModule } from 'typescript';
import { dueDate, MAX_TERM_DAYS } from './due-date';

const iso = (d: Date) => d.toISOString();

describe('dueDate', () => {
  it('adds 30 days to a normal date', () => {
    expect(iso(dueDate(new Date('2026-10-18T10:00:00Z')))).toBe('2026-11-17T10:00:00.000Z');
  });

  it.each([
    ['crosses the end of a month', '2026-10-31T00:00:00Z', '2026-11-30T00:00:00.000Z'],
    ['crosses the end of the year', '2026-12-15T09:30:00Z', '2027-01-14T09:30:00.000Z'],
    ['lands on 29 February in a leap year', '2028-01-30T00:00:00Z', '2028-02-29T00:00:00.000Z'],
    ['skips 29 February in a normal year', '2027-01-30T00:00:00Z', '2027-03-01T00:00:00.000Z'],
    ['crosses a leap-year February', '2028-02-10T00:00:00Z', '2028-03-11T00:00:00.000Z'],
  ])('%s', (_name, from, expected) => {
    expect(iso(dueDate(new Date(from)))).toBe(expected);
  });

  it('keeps the time of day (it counts calendar days, not 24-hour blocks)', () => {
    expect(iso(dueDate(new Date('2026-03-01T23:59:59.999Z')))).toBe('2026-03-31T23:59:59.999Z');
  });

  it.each([[0, '2026-10-18T10:00:00.000Z'], [1, '2026-10-19T10:00:00.000Z'], [15, '2026-11-02T10:00:00.000Z'], [60, '2026-12-17T10:00:00.000Z']])('uses another term: %i days', (days, expected) => {
    expect(iso(dueDate(new Date('2026-10-18T10:00:00Z'), days))).toBe(expected);
  });

  // Se ejecuta la función en un proceso aparte con la zona horaria REAL de cada ciudad: cambiar process.env.TZ dentro de Jest no sirve
  // (Jest trabaja con su propia copia de process.env), y una prueba así parecería proteger algo sin hacerlo.
  const js = transpileModule(readFileSync(join(__dirname, 'due-date.ts'), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const inZone = (tz: string, from: string) => execFileSync(process.execPath, ['-e',
    `const m={exports:{}};(new Function('module','exports',${JSON.stringify(js)}))(m,m.exports);console.log(m.exports.dueDate(new Date(${JSON.stringify(from)})).toISOString())`,
  ], { env: { ...process.env, TZ: tz } }).toString().trim();

  it.each(['UTC', 'America/Bogota', 'Europe/Madrid', 'Pacific/Auckland'])('does not depend on the time zone of the machine (%s)', (tz) => {
    // 25 marzo + 30 días cruza el cambio de horario de Europa (29 marzo): con hora local el resultado se movería una hora.
    expect(inZone(tz, '2026-03-25T12:00:00Z')).toBe('2026-04-24T12:00:00.000Z');
  });

  it('does not change the date it receives', () => {
    const issued = new Date('2026-10-18T10:00:00Z');
    const before = issued.getTime();
    const due = dueDate(issued);
    expect(issued.getTime()).toBe(before);
    expect(due).not.toBe(issued);
  });

  it.each([['an invalid date', new Date('nope')], ['not a Date', '2026-10-18' as any], ['null', null as any], ['undefined', undefined as any], ['a number', 1_700_000_000_000 as any]])('rejects %s', (_n, bad) => {
    expect(() => dueDate(bad)).toThrow(RangeError);
  });

  it.each([[-1], [1.5], [Number.NaN], [Infinity], [MAX_TERM_DAYS + 1], ['30' as any]])('rejects the term %p', (days) => {
    expect(() => dueDate(new Date('2026-10-18T10:00:00Z'), days as number)).toThrow(RangeError);
  });

  it('accepts the largest term allowed', () => {
    expect(() => dueDate(new Date('2026-10-18T10:00:00Z'), MAX_TERM_DAYS)).not.toThrow();
  });
});
