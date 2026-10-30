import type { audit as es } from '../es/audit';

export const audit: Record<keyof typeof es, string> = {
  'nav.audit': 'Audit',
  'audit.title': 'Audit',
  'audit.intro': 'Everything that happened in the system, taken from the events: when, who and what. It is append-only; nobody can edit or delete it. “Who” appears when the event carries it (approvals, issuing and payments); for the rest the event does not say who did it.',
  'audit.filter': 'Event type',
  'audit.all': 'All',
  'audit.refresh': 'Refresh',
  'audit.empty': 'There are no events yet.',
  'audit.col.when': 'When',
  'audit.col.who': 'Who',
  'audit.col.what': 'What',
  'audit.col.type': 'Type',
  'audit.noActor': 'the event does not say',
  'audit.loadError': 'Could not load the audit log: {reason}',
};
