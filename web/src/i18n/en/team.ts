import type { team as es } from '../es/team';

export const team: Record<keyof typeof es, string> = {
  'team.title': 'Project team',
  'team.empty': 'No engineers are allocated to this project yet in Technical Capacity.',
  'team.col.engineer': 'Engineer',
  'team.col.percent': 'Allocation',
  'team.col.period': 'Period',
};
