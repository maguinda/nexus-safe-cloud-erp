import type { Project } from './types';

/** Filas que se muestran de una vez en la tabla de proyectos; «Mostrar más» agrega otra tanda. */
export const PROJECT_PAGE = 25;

/** Filtra en el navegador (el listado ya viene completo del servidor): por texto en el nombre o el cliente. */
export function filterProjects(list: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  return q === '' ? list : list.filter((p) => `${p.name} ${p.client}`.toLowerCase().includes(q));
}

/** Hitos sin aprobar de todos los proyectos, sacados de los conteos del listado (no hace falta pedir los hitos uno por uno). */
export function pendingMilestones(list: Project[]): number {
  return list.reduce((sum, p) => sum + Math.max(0, p.milestonesTotal - p.milestonesApproved), 0);
}
