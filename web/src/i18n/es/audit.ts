/** Auditoría: bitácora de todos los eventos (solo gerencia). */
export const audit = {
  'nav.audit': 'Auditoría',
  'audit.title': 'Auditoría',
  'audit.intro': 'Todo lo que pasó en el sistema, tomado de los eventos: cuándo, quién y qué. Solo se agrega; nadie puede editarla ni borrarla. «Quién» aparece cuando el evento lo trae (aprobaciones, emisiones y pagos); en el resto el evento no dice quién fue.',
  'audit.filter': 'Tipo de evento',
  'audit.all': 'Todos',
  'audit.refresh': 'Actualizar',
  'audit.empty': 'Aún no hay eventos.',
  'audit.col.when': 'Cuándo',
  'audit.col.who': 'Quién',
  'audit.col.what': 'Qué',
  'audit.col.type': 'Tipo',
  'audit.noActor': 'no lo dice el evento',
  'audit.loadError': 'No se pudo cargar la auditoría: {reason}',
} as const;
