import { describe, expect, it } from 'vitest';
import { filterProjects, pageOf, pendingMilestones, PROJECT_PAGE } from './project-table';
import type { Project } from './types';

const proj = (id: string, o: Partial<Project> = {}): Project => ({ id, name: `Proyecto ${id}`, client: 'Banco Andino', milestonesApproved: 1, milestonesTotal: 3, ...o });
const ids = (l: Project[]) => l.map((p) => p.id);

describe('filterProjects', () => {
  const list = [proj('a', { name: 'Branch network upgrade', client: 'Banco Andino' }), proj('b', { name: 'Retail POS', client: 'Retail Norte' }), proj('c', { name: 'SME cloud', client: 'Pyme Sur' })];
  it('sin texto devuelve la misma lista', () => { expect(filterProjects(list, '')).toBe(list); expect(filterProjects(list, '   ')).toBe(list); });
  it('busca en el nombre sin distinguir mayúsculas', () => expect(ids(filterProjects(list, 'POS'))).toEqual(['b']));
  it('busca en el cliente', () => expect(ids(filterProjects(list, 'andino'))).toEqual(['a']));
  it('ignora espacios al borde', () => expect(ids(filterProjects(list, '  pyme  '))).toEqual(['c']));
  it('sin coincidencias devuelve vacío', () => expect(filterProjects(list, 'zzz')).toEqual([]));
  it('no modifica la lista original', () => { const copy = [...list]; filterProjects(list, 'a'); expect(list).toEqual(copy); });
});

describe('pendingMilestones', () => {
  it('suma total - aprobados de cada proyecto', () => expect(pendingMilestones([proj('a'), proj('b', { milestonesApproved: 0, milestonesTotal: 2 })])).toBe(4));
  it('lista vacía = 0', () => expect(pendingMilestones([])).toBe(0));
  it('un conteo incoherente nunca resta', () => expect(pendingMilestones([proj('a', { milestonesApproved: 5, milestonesTotal: 3 })])).toBe(0));
});

describe('pageOf', () => {
  const many = Array.from({ length: 60 }, (_, i) => i);
  it('devuelve la primera tanda y lo que queda', () => expect(pageOf(many, PROJECT_PAGE)).toEqual({ rows: many.slice(0, 25), hidden: 35 }));
  it('si caben todas no queda nada oculto', () => expect(pageOf([1, 2], 25)).toEqual({ rows: [1, 2], hidden: 0 }));
  it('valores raros no rompen', () => { expect(pageOf(many, -3)).toEqual({ rows: [], hidden: 60 }); expect(pageOf(many, 2.9).rows).toEqual([0, 1]); });
});
