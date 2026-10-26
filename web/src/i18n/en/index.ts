import { auth } from './auth';
import { common } from './common';
import { dashboard } from './dashboard';
import { invoices } from './invoices';
import { projects } from './projects';
import { server } from './server';
import { users } from './users';

export const en = { ...common, ...auth, ...projects, ...users, ...invoices, ...dashboard, ...server };
