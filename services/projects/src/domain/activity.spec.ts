import { InvalidInputError } from './errors';
import { canProgress, cleanDay, cleanLine, cleanNote, newActivity, progressOf } from './activity';

const STAFF = '11111111-1111-4111-8111-111111111107';
const base = { title: 'Instalar el switch', assignedToId: STAFF, assignedTo: 'Hugo Salazar' };

describe('newActivity', () => {
  it('limpia el texto y deja opcionales en null', () => {
    expect(newActivity({ ...base, title: '  Instalar   el switch ' }, '2026-11-01')).toEqual({ title: 'Instalar el switch', description: null, assignedToId: STAFF, assignedTo: 'Hugo Salazar', dueDate: null });
  });
  it('pasa el id a minúsculas y acepta fecha de hoy o futura', () => {
    expect(newActivity({ ...base, assignedToId: STAFF.toUpperCase(), dueDate: '2026-11-01' }, '2026-11-01').assignedToId).toBe(STAFF);
  });
  it.each([
    ['título corto', { title: 'ab' }], ['título vacío', { title: '   ' }], ['título largo', { title: 'x'.repeat(121) }], ['título con control', { title: 'hola\u0000mundo' }], ['título no texto', { title: 7 }],
    ['persona sin id', { assignedToId: undefined }], ['id mal formado', { assignedToId: 'no-es-uuid' }], ['nombre de 1 letra', { assignedTo: 'H' }],
    ['fecha pasada', { dueDate: '2026-10-31' }], ['fecha inexistente', { dueDate: '2026-02-31' }], ['fecha con formato raro', { dueDate: '1/11/2026' }],
    ['descripción con <', { description: '<script>x</script>' }], ['descripción larga', { description: 'x'.repeat(301) }],
  ])('rechaza %s', (_n, over) => { expect(() => newActivity({ ...base, ...over }, '2026-11-01')).toThrow(InvalidInputError); });
  it('la descripción vacía es null y la de 300 caracteres pasa', () => {
    expect(newActivity({ ...base, description: '   ' }, '2026-11-01').description).toBeNull();
    expect(newActivity({ ...base, description: 'x'.repeat(300) }, '2026-11-01').description).toHaveLength(300);
  });
});

describe('cleanDay', () => {
  it('rechaza 31 de febrero y acepta el 29 de febrero de un año bisiesto', () => {
    expect(() => cleanDay('2026-02-31', 'd')).toThrow(InvalidInputError);
    expect(cleanDay('2028-02-29', 'd')).toBe('2028-02-29');
    expect(() => cleanDay('2027-02-29', 'd')).toThrow(InvalidInputError);
  });
});
describe('cleanNote / cleanLine', () => {
  it('una nota opcional vacía es null', () => { expect(cleanNote(undefined, 'n')).toBeNull(); expect(cleanNote('  ', 'n')).toBeNull(); expect(cleanNote('Hecho', 'n')).toBe('Hecho'); });
  it('una nota con < o > se rechaza', () => { expect(() => cleanNote('a<b', 'n')).toThrow(InvalidInputError); expect(() => cleanNote('a>b', 'n')).toThrow(InvalidInputError); });
  it('cleanLine cuenta los caracteres ya limpios', () => { expect(cleanLine('  ab  ', 'x', 2, 5)).toBe('ab'); expect(() => cleanLine('a', 'x', 2, 5)).toThrow(InvalidInputError); });
});

describe('canProgress', () => {
  it.each([['open', 'in_progress', true], ['open', 'done', true], ['in_progress', 'done', true], ['in_progress', 'in_progress', false], ['done', 'done', false], ['done', 'in_progress', false], ['cancelled', 'done', false], ['cancelled', 'in_progress', false], ['in_progress', 'open', false], ['open', 'cancelled', false]] as const)('%s → %s = %s', (a, b, ok) => { expect(canProgress(a, b)).toBe(ok); });
});

describe('progressOf', () => {
  it('cuenta por estado y no cuenta las canceladas', () => {
    expect(progressOf([{ status: 'done' }, { status: 'done' }, { status: 'in_progress' }, { status: 'open' }, { status: 'cancelled' }])).toEqual({ total: 4, done: 2, inProgress: 1, open: 1, pct: 50 });
  });
  it('sin actividades es 0 de 0 y 0 %, y todo cancelado también', () => {
    expect(progressOf([])).toEqual({ total: 0, done: 0, inProgress: 0, open: 0, pct: 0 });
    expect(progressOf([{ status: 'cancelled' }]).pct).toBe(0);
  });
  it('redondea el porcentaje', () => { expect(progressOf([{ status: 'done' }, { status: 'open' }, { status: 'open' }]).pct).toBe(33); });
});
