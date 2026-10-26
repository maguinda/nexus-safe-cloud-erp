import { auth } from './auth';
import { common } from './common';
import { dashboard } from './dashboard';
import { invoices } from './invoices';
import { projects } from './projects';
import { server } from './server';
import { users } from './users';

/** El español es la fuente de las claves: el inglés tiene que tener exactamente las mismas (si falta una, no compila). */
export const es = { ...common, ...auth, ...projects, ...users, ...invoices, ...dashboard, ...server } as const;
